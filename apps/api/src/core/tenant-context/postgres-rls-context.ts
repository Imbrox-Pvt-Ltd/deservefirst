/**
 * Core · tenant-context/postgres-rls-context.ts
 * Injects the resolved request context into Postgres session variables so
 * row-level-security policies can enforce the store boundary in the database
 * itself (§20.1). Application-level scoping can be forgotten; RLS cannot.
 *
 * Ported from the donor codebase and adapted to store-first terminology and the
 * platform's own context store.
 * Layer: core/infrastructure (type-only dependency on TypeORM).
 */

import type { DataSource, QueryRunner } from 'typeorm';

import { getRequestContext } from './request-context.store';

const DATA_SOURCE_PATCHED = Symbol('platform.rlsContextInstalled');
const QUERY_RUNNER_PATCHED = Symbol('platform.rlsQueryRunnerInstalled');
const APPLYING_CONTEXT = Symbol('platform.rlsApplyingContext');
const LAST_CONTEXT_SIGNATURE = Symbol('platform.rlsLastContextSignature');

/**
 * `set_config(..., false)` sets the value for the session rather than the
 * transaction, so it survives across statements on a pooled connection — and is
 * re-applied whenever the context signature changes.
 */
const SET_CONTEXT_SQL = `
  SELECT
    set_config('app.current_organization_id', $1, false),
    set_config('app.current_store_id', $2, false),
    set_config('app.current_actor_user_id', $3, false),
    set_config('app.current_actor_type', $4, false),
    set_config('app.current_access_type', $5, false),
    set_config('app.current_request_id', $6, false)
`;

type PatchedQueryRunner = QueryRunner & {
  [QUERY_RUNNER_PATCHED]?: boolean;
  [APPLYING_CONTEXT]?: boolean;
  [LAST_CONTEXT_SIGNATURE]?: string | null;
};

interface ContextSnapshot {
  readonly organizationId: string;
  readonly storeId: string;
  readonly actorUserId: string;
  readonly actorType: string;
  readonly accessType: string;
  readonly requestId: string;
}

export function isPostgresDataSource(dataSource: Pick<DataSource, 'options'>): boolean {
  return dataSource.options.type === 'postgres';
}

/**
 * Wraps `createQueryRunner` so every runner the pool hands out applies the
 * current context before its first real statement. Idempotent — installing twice
 * is a no-op rather than a double-patch.
 */
export function installPostgresRlsContext(dataSource: DataSource): DataSource {
  if (!isPostgresDataSource(dataSource)) return dataSource;

  const marked = dataSource as DataSource & { [DATA_SOURCE_PATCHED]?: boolean };
  if (marked[DATA_SOURCE_PATCHED]) return dataSource;

  const originalCreateQueryRunner = dataSource.createQueryRunner.bind(dataSource);
  dataSource.createQueryRunner = ((mode?: 'master' | 'slave') =>
    patchQueryRunner(originalCreateQueryRunner(mode))) as DataSource['createQueryRunner'];

  marked[DATA_SOURCE_PATCHED] = true;
  return dataSource;
}

function patchQueryRunner<T extends QueryRunner>(queryRunner: T): T {
  const runner = queryRunner as PatchedQueryRunner;
  if (runner[QUERY_RUNNER_PATCHED]) return queryRunner;

  const originalQuery = queryRunner.query.bind(queryRunner);
  const originalRelease = queryRunner.release.bind(queryRunner);

  queryRunner.query = (async (query: string, parameters?: unknown[]) => {
    // Skip re-entry while we are ourselves setting the context.
    if (!runner[APPLYING_CONTEXT] && !query.includes("set_config('app.current_")) {
      await applyContext(runner, originalQuery);
    }
    return originalQuery(query, parameters);
  }) as QueryRunner['query'];

  // A released connection returns to the pool; forget the signature so the next
  // borrower re-applies its own context rather than inheriting ours.
  queryRunner.release = (async () => {
    runner[LAST_CONTEXT_SIGNATURE] = null;
    return originalRelease();
  }) as QueryRunner['release'];

  runner[QUERY_RUNNER_PATCHED] = true;
  return queryRunner;
}

async function applyContext(
  runner: PatchedQueryRunner,
  executeQuery: QueryRunner['query'],
): Promise<void> {
  const snapshot = snapshotContext();
  const signature = JSON.stringify(snapshot);
  if (runner[LAST_CONTEXT_SIGNATURE] === signature) return;

  runner[APPLYING_CONTEXT] = true;
  try {
    await executeQuery(SET_CONTEXT_SQL, [
      snapshot.organizationId,
      snapshot.storeId,
      snapshot.actorUserId,
      snapshot.actorType,
      snapshot.accessType,
      snapshot.requestId,
    ]);
    runner[LAST_CONTEXT_SIGNATURE] = signature;
  } finally {
    runner[APPLYING_CONTEXT] = false;
  }
}

/**
 * Absent context yields empty strings, which no policy will match — so the
 * failure mode of a missing context is "sees nothing", never "sees everything".
 * There is deliberately no bypass flag: a production escape hatch would become
 * the hole this whole mechanism exists to close.
 */
function snapshotContext(): ContextSnapshot {
  const context = getRequestContext();
  return {
    organizationId: context?.organizationId ?? '',
    storeId: context?.storeId ?? '',
    actorUserId: context?.userId ?? '',
    actorType: context?.actorType ?? '',
    accessType: context?.accessType ?? '',
    requestId: context?.requestId ?? '',
  };
}

/** Exposed for the isolation tests, which assert the failure-closed behaviour. */
export const __testing = { snapshotContext, SET_CONTEXT_SQL };

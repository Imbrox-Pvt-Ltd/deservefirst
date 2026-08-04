/**
 * Core · tenant-context/query-guard.ts
 * The compensating control for databases without row-level security.
 *
 * On Postgres the tenant boundary is enforced by RLS policies: even a query that
 * forgets `store_id` returns nothing. MySQL has no equivalent, so on that
 * dialect a forgotten predicate silently returns every tenant's rows — the exact
 * failure this platform is built to make impossible.
 *
 * This guard inspects every statement before it executes and refuses any that
 * touches a store-scoped table without a store predicate. It fails CLOSED: a
 * statement it cannot prove safe is rejected, not allowed. That is deliberate —
 * a false positive is a loud developer error, a false negative is a data breach.
 *
 * It is not a substitute for RLS and does not pretend to be. See docs/adr/0002.
 * Layer: core.
 */

import { getRequestContext } from './request-context.store';

export class UnscopedQueryError extends Error {
  readonly status = 500;
  constructor(
    readonly table: string,
    readonly sql: string,
  ) {
    super(
      `Refusing to run a query against store-scoped table "${table}" without a store predicate. ` +
        'Without row-level security this would read across tenants. ' +
        `Statement: ${sql.slice(0, 200)}`,
    );
    this.name = 'UnscopedQueryError';
  }
}

/** Statements that only ever touch platform-owned data. */
const PLATFORM_STATEMENT = /^\s*(SET|SHOW|BEGIN|COMMIT|ROLLBACK|EXPLAIN|SELECT\s+1\b|SELECT\s+VERSION|SELECT\s+DATABASE)/i;

const TABLE_REFERENCE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?([a-z_][a-z0-9_]*)[`"]?/gi;

export interface QueryGuardOptions {
  /** Tables that carry `store_id`, collected from the module registry. */
  readonly storeScopedTables: readonly string[];
  /**
   * When the dialect enforces RLS the guard still runs, but only reports rather
   * than throwing — the database is already the backstop, and a noisy false
   * positive there would block correct code for no safety gain.
   */
  readonly enforce: boolean;
  readonly onViolation?: (error: UnscopedQueryError) => void;
}

export class QueryGuard {
  private readonly scoped: ReadonlySet<string>;

  constructor(private readonly options: QueryGuardOptions) {
    this.scoped = new Set(options.storeScopedTables.map((table) => table.toLowerCase()));
  }

  /**
   * Throws when `sql` touches a store-scoped table without constraining
   * `store_id`. Called by the executor for every statement.
   */
  assertScoped(sql: string): void {
    if (PLATFORM_STATEMENT.test(sql)) return;

    const touched = this.storeScopedTablesIn(sql);
    if (touched.length === 0) return;

    if (this.hasStorePredicate(sql)) return;

    // A platform-scoped context (no store) may legitimately run cross-store
    // maintenance, but only when it says so explicitly rather than by omission.
    const context = getRequestContext();
    if (context && context.storeId === null && context.accessType === 'platform') return;

    const error = new UnscopedQueryError(touched[0] ?? 'unknown', sql);
    this.options.onViolation?.(error);
    if (this.options.enforce) throw error;
  }

  private storeScopedTablesIn(sql: string): string[] {
    const found: string[] = [];
    for (const match of sql.matchAll(TABLE_REFERENCE)) {
      const table = match[1]?.toLowerCase();
      if (table && this.scoped.has(table)) found.push(table);
    }
    return found;
  }

  /**
   * Looks for `store_id` used as a constraint. INSERT is treated as scoped when
   * the column list names `store_id`, since that is how the value is supplied.
   */
  private hasStorePredicate(sql: string): boolean {
    if (/^\s*INSERT\b/i.test(sql)) {
      return /\bstore_id\b/i.test(sql.slice(0, sql.indexOf('VALUES') === -1 ? sql.length : sql.indexOf('VALUES')));
    }

    const whereIndex = sql.search(/\bWHERE\b/i);
    if (whereIndex === -1) return false;
    return /\bstore_id\b\s*(=|IN\b)/i.test(sql.slice(whereIndex));
  }
}

/**
 * Wraps an executor so every statement passes the guard. Applying it at the
 * executor rather than in each repository is what makes the control structural:
 * there is no way to issue a query that skips it.
 */
export interface GuardableExecutor {
  query<T = Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<T[]>;
}

export function guardExecutor<T extends GuardableExecutor>(executor: T, guard: QueryGuard): T {
  const original = executor.query.bind(executor);
  const wrapped = {
    ...executor,
    query: async (sql: string, parameters: readonly unknown[] = []) => {
      guard.assertScoped(sql);
      return original(sql, parameters);
    },
  };
  return wrapped as T;
}

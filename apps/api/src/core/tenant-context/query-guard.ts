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

const TABLE_REFERENCE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/gi;

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
    for (const match of sql.replace(/[`"\[\]]/g, '').matchAll(TABLE_REFERENCE)) {
      const table = match[1]?.toLowerCase();
      if (table && this.scoped.has(table)) found.push(table);
    }
    return found;
  }

  /**
   * Looks for `store_id` used as a constraint. INSERT is treated as scoped when
   * the column list names `store_id`, since that is how the value is supplied.
   *
   * Identifiers are stripped of quoting first. The compiler emits `` `store_id` ``
   * on MySQL and `"store_id"` on Postgres, and an earlier version of this check
   * matched neither — it refused a correctly scoped query. Failing closed made
   * that a loud 500 rather than a silent leak, which is the behaviour we want,
   * but the pattern still has to be right.
   */
  private hasStorePredicate(sql: string): boolean {
    const unquoted = sql.replace(/[`"\[\]]/g, '');

    if (/^\s*INSERT\b/i.test(unquoted)) {
      const valuesAt = unquoted.search(/\bVALUES\b/i);
      return /\bstore_id\b/i.test(valuesAt === -1 ? unquoted : unquoted.slice(0, valuesAt));
    }

    const whereIndex = unquoted.search(/\bWHERE\b/i);
    if (whereIndex === -1) return false;
    return /\bstore_id\b\s*(=|IN\b)/i.test(unquoted.slice(whereIndex));
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

/**
 * A Proxy, not an object spread. Spreading copies only own enumerable
 * properties, so every prototype method other than the one being replaced is
 * silently dropped — which is exactly what happened to `execute()`, taking
 * optimistic concurrency with it and surfacing as a 500 rather than a conflict.
 * A Proxy intercepts `query` and forwards everything else untouched, so the
 * wrapper cannot narrow the interface it wraps.
 */
export function guardExecutor<T extends GuardableExecutor>(executor: T, guard: QueryGuard): T {
  return new Proxy(executor, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (property === 'query' && typeof value === 'function') {
        return async (sql: string, parameters: readonly unknown[] = []) => {
          guard.assertScoped(sql);
          return (value as GuardableExecutor['query']).call(target, sql, parameters);
        };
      }

      // Guard writes too: `execute` runs UPDATE and DELETE statements, which is
      // precisely where a forgotten predicate does the most damage.
      if (property === 'execute' && typeof value === 'function') {
        return async (sql: string, parameters: readonly unknown[] = []) => {
          guard.assertScoped(sql);
          return (value as (sql: string, parameters: readonly unknown[]) => unknown).call(
            target,
            sql,
            parameters,
          );
        };
      }

      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

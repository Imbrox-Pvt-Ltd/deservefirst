/**
 * Core · dashboard/counting.ts
 * Counting rows for a dashboard card, store-scoped and dialect-correct.
 *
 * Offered as a helper rather than left to each module to hand-roll, because a
 * count that forgets `store_id` or `deleted_at` is a number that looks plausible
 * and is wrong — and on a dashboard nobody checks it against anything.
 * Layer: core.
 */

import type { QueryExecutor } from '../list-engine';
import type { SqlDialect } from '../list-engine/dialect';
import { requireStoreContext } from '../tenant-context';

export interface CountOptions {
  /** Extra conditions, as `column` → value. Compared with `=`. */
  readonly where?: Readonly<Record<string, string | number | boolean>>;
  /** Raw predicate for the things equality cannot say, e.g. `on_hand <= 0`. */
  readonly predicate?: string;
}

/**
 * Counts live rows of one table for the active store.
 *
 * Soft-deleted rows are always excluded and the store scope is always applied —
 * neither is a caller's decision, because a dashboard is exactly where a
 * missing tenant filter would go unnoticed.
 */
export function countRows(
  executor: QueryExecutor,
  dialect: SqlDialect,
  table: string,
  options: CountOptions = {},
): () => Promise<number> {
  return async () => {
    const q = (name: string) => dialect.quoteIdentifier(name);
    const storeId = requireStoreContext(`dashboard.${table}`).storeId;

    const entries = Object.entries(options.where ?? {});
    const parameters: unknown[] = [storeId, ...entries.map(([, value]) => value)];
    const conditions = entries.map(
      ([column], index) => `${q(column)} = ${dialect.placeholder(index + 2)}`,
    );

    if (options.predicate) conditions.push(options.predicate);

    const rows = await executor.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM ${q(table)}
        WHERE ${q('store_id')} = ${dialect.placeholder(1)}
          AND ${q('deleted_at')} IS NULL
          ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}`,
      parameters,
    );

    return Number(rows[0]?.total ?? 0);
  };
}

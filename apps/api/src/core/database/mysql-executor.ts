/**
 * Core · database/mysql-executor.ts
 * MySQL / MariaDB executor. Interim database while Postgres is stood up
 * (ADR 0002) — every statement still runs through the query guard, because
 * without row-level security the guard is the only thing standing between a
 * forgotten predicate and a cross-tenant read.
 * Layer: core/infrastructure.
 */

import type { GuardableExecutor } from '../tenant-context/query-guard';

/** The subset of the mysql2 pool we depend on, so the driver stays swappable. */
export interface MysqlPool {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

export interface MysqlExecutorOptions {
  readonly pool: MysqlPool;
  /** Emitted for every statement so slow-query detection has something to read. */
  readonly onQuery?: (event: { sql: string; durationMs: number; rowCount: number }) => void;
}

/** Result of a write: how many rows the statement actually changed. */
export interface WriteResult {
  readonly affectedRows: number;
}

export class MysqlExecutor implements GuardableExecutor {
  constructor(private readonly options: MysqlExecutorOptions) {}

  /**
   * Runs a write and reports the affected-row count. Optimistic concurrency
   * depends on this: "did my versioned UPDATE match a row" cannot be answered by
   * re-reading, because by then the winning writer has already stored the value
   * the loser expected to see.
   */
  async execute(sql: string, parameters: readonly unknown[] = []): Promise<WriteResult> {
    const [result] = await this.options.pool.query(sql, parameters);
    const header = result as { affectedRows?: number } | undefined;
    return { affectedRows: Number(header?.affectedRows ?? 0) };
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<T[]> {
    const startedAt = Date.now();
    const [rows] = await this.options.pool.query(sql, parameters);
    const result = Array.isArray(rows) ? (rows as T[]) : [];

    this.options.onQuery?.({
      sql,
      durationMs: Date.now() - startedAt,
      rowCount: result.length,
    });

    return result;
  }
}

/**
 * Builds a pool from a connection URL. `namedPlaceholders` stays off: the
 * compiler emits positional `?` and mixing the two silently changes how
 * parameters bind.
 */
export async function createMysqlPool(url: string): Promise<MysqlPool> {
  // Imported lazily so the Postgres path never pays for the MySQL driver.
  const mysql = (await import('mysql2/promise')) as unknown as {
    createPool(config: Record<string, unknown>): MysqlPool;
  };

  const parsed = new URL(url);
  return mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    waitForConnections: true,
    connectionLimit: 10,
    // Money is stored as an exact integer string; letting the driver coerce
    // BIGINT to a JS number would silently lose precision above 2^53.
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: false,
    timezone: 'Z',
  });
}

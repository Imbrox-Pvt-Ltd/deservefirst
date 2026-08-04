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
  /** Fires for each new physical connection, so per-session state can be set. */
  on(event: 'connection', listener: (connection: { query(sql: string): unknown }) => void): void;
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
  const pool = mysql.createPool({
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
    // Every Date the driver writes is converted to UTC, and every DATETIME it
    // reads is interpreted as UTC. That round-trips correctly on its own — see
    // the session time zone below for the half it does NOT cover.
    timezone: 'Z',
  });

  /**
   * Forces the SERVER's clock into UTC too, per connection.
   *
   * `timezone: 'Z'` only governs values the driver marshals. Columns defaulted
   * to CURRENT_TIMESTAMP are filled in by the server, in the server's local
   * zone — so on any host that is not UTC, `created_at` was written in local
   * time and then read back as though it were UTC. The two kinds of timestamp
   * silently disagreed by the offset, which matters most where they are
   * compared: keyset pagination pages on `created_at` against a cursor the
   * driver supplied, so a non-UTC host skipped or repeated a page's worth of
   * rows at the boundary. Pinning the session makes both halves UTC.
   */
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  return pool;
}

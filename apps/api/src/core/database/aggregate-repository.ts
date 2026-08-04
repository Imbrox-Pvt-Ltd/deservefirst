/**
 * Core · database/aggregate-repository.ts
 * The persistence mechanics every aggregate repository repeats: store scoping,
 * dialect-correct placeholders and quoting, keyset listing, and — the one worth
 * centralising — an optimistic-concurrency update that decides success from the
 * driver's affected-row count.
 *
 * That last part is why this exists. Re-reading the version to decide whether an
 * UPDATE matched is unsound: by the time the loser reads it, the winner has
 * already stored the value it expected, so a lost update reports success. That
 * bug was written once, found once, and would have been copied into every new
 * repository — this file is what stops the sixth author from getting it wrong.
 *
 * A subclass says what its table is and how a row maps to and from the domain.
 * It does not restate any of the above.
 * Layer: core/database.
 */

import {
  type Connection,
  type ListQuery,
  type ResourceDefinition,
  type StoreId,
} from '@deservefirst/contracts';

import { StaleWriteError } from '../entity-toolkit';
import { ListEngine, type QueryExecutor } from '../list-engine';
import { type SqlDialect } from '../list-engine/dialect';
import { requireStoreContext } from '../tenant-context';

/** The shape every aggregate exposes to the repository base. */
export interface VersionedAggregate {
  readonly id: string;
  readonly version: number;
}

/** An executor that can report how many rows a write touched. */
interface AffectedRowsExecutor extends QueryExecutor {
  execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
}

export abstract class SqlAggregateRepository<
  TDomain extends VersionedAggregate,
  TRow extends Record<string, unknown>,
> {
  private readonly listEngine: ListEngine;

  constructor(
    protected readonly executor: QueryExecutor,
    protected readonly dialect: SqlDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  /** The physical table. */
  protected abstract readonly tableName: string;
  /** Used for listing, and for the field/column mapping the engine applies. */
  protected abstract readonly resource: ResourceDefinition;
  /** Names the operation in tenant-context errors, e.g. "inventory.transfers". */
  protected abstract readonly operation: string;

  protected abstract toDomain(row: TRow): TDomain;
  /** Column values for insert and update, excluding id, store_id and version. */
  protected abstract toColumns(entity: TDomain): Record<string, unknown>;

  protected storeId(): StoreId {
    return requireStoreContext(this.operation).storeId;
  }

  protected q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  protected args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  async findById(id: string): Promise<TDomain | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<TRow>(
      `SELECT * FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('id')} = ${p2}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async list(query: ListQuery): Promise<Connection<TDomain>> {
    const connection = await this.listEngine.list<TRow>({
      resource: this.resource,
      tableName: this.tableName,
      query,
      dialect: this.dialect,
    });
    return { ...connection, nodes: connection.nodes.map((row) => this.toDomain(row)) };
  }

  async insert(entity: TDomain): Promise<TDomain> {
    const values: Record<string, unknown> = {
      id: entity.id,
      store_id: this.storeId(),
      ...this.toColumns(entity),
      version: entity.version,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q(this.tableName)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      Object.values(values),
    );
    return entity;
  }

  /**
   * Writes only if the stored version still matches, and decides that from the
   * rows the driver reports as changed — never by reading the version back.
   */
  async update(entity: TDomain, expectedVersion: number): Promise<TDomain> {
    const values: Record<string, unknown> = { ...this.toColumns(entity), version: entity.version };
    const columns = Object.keys(values);
    const parameters = [...Object.values(values), this.storeId(), entity.id, expectedVersion];
    const placeholders = this.args(parameters.length);

    const setClause = columns
      .map((column, index) => `${this.q(column)} = ${placeholders[index]}`)
      .join(', ');
    const [storeParam, idParam, versionParam] = placeholders.slice(columns.length);

    const sql = `UPDATE ${this.q(this.tableName)}
        SET ${setClause}, ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
      WHERE ${this.q('store_id')} = ${storeParam}
        AND ${this.q('id')} = ${idParam}
        AND ${this.q('version')} = ${versionParam}
        AND ${this.q('deleted_at')} IS NULL`;

    const affected = await this.runWrite(sql, parameters);

    if (affected === 0) {
      throw new StaleWriteError(this.resource.name, entity.id, expectedVersion, entity.version);
    }
    return entity;
  }

  async softDelete(id: string): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q(this.tableName)}
          SET ${this.q('deleted_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2}`,
      [this.storeId(), id],
    );
  }

  /** Rows actually changed. Postgres reports it via RETURNING, MySQL via the driver. */
  protected async runWrite(sql: string, parameters: readonly unknown[]): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(
        `${sql} RETURNING ${this.q('id')}`,
        parameters,
      );
      return rows.length;
    }

    const writable = this.executor as AffectedRowsExecutor;
    if (typeof writable.execute !== 'function') {
      throw new Error(
        'This executor cannot report affected rows, so optimistic concurrency cannot be enforced.',
      );
    }
    return (await writable.execute(sql, parameters)).affectedRows;
  }
}

/** Parses a JSON column, whether the driver hands back an object or a string. */
export function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

/** A JSON column that must be an array, defaulting to empty rather than throwing. */
export function parseJsonArray<T>(value: unknown): T[] {
  const parsed = parseJsonColumn(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

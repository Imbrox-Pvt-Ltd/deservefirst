/**
 * Catalog · infrastructure/collection.repository.ts
 * Persistence for the Collection aggregate. Conditions and exclusions are stored
 * as JSON rather than rows: they are read and written only as a whole set, and a
 * table would add joins and ordering concerns for no query we intend to run.
 * Layer: infrastructure.
 */

import { type Connection, type ListQuery, type StoreId } from '@deservefirst/contracts';

import { StaleWriteError } from '../../../core/entity-toolkit';
import { ListEngine, type QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import { collectionResource } from '../contracts';
import type { Collection, Condition } from '../domain';
import type { CollectionRepository } from '../application';

const TABLE = 'collections';

interface CollectionRow extends Record<string, unknown> {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  type: string;
  match: string;
  conditions: unknown;
  exclusions: unknown;
  product_ids: unknown;
  sort_order: string;
  version: number;
}

export class CollectionRepositoryImpl implements CollectionRepository {
  private readonly listEngine: ListEngine;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  private storeId(): StoreId {
    return requireStoreContext('catalog.collections').storeId;
  }

  private args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async findById(id: string): Promise<Collection | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<CollectionRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async takenHandles(prefix: string): Promise<ReadonlySet<string>> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<{ handle: string }>(
      `SELECT ${this.q('handle')} FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('handle')} LIKE ${p2}`,
      [this.storeId(), `${prefix}%`],
    );
    return new Set(rows.map((row) => row.handle));
  }

  async list(query: ListQuery): Promise<Connection<Collection>> {
    const connection = await this.listEngine.list<CollectionRow>({
      resource: collectionResource,
      tableName: TABLE,
      query,
      dialect: this.dialect,
    });
    return { ...connection, nodes: connection.nodes.map(toDomain) };
  }

  async insert(collection: Collection): Promise<Collection> {
    const columns = [
      'id', 'store_id', 'handle', 'title', 'description', 'type', 'match',
      'conditions', 'exclusions', 'product_ids', 'sort_order', 'version',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q(TABLE)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        collection.id, this.storeId(), collection.handle, collection.title, collection.description,
        collection.type, collection.match,
        JSON.stringify(collection.conditions), JSON.stringify(collection.exclusions),
        JSON.stringify(collection.productIds), collection.sortOrder, collection.version,
      ],
    );
    return collection;
  }

  async update(collection: Collection, expectedVersion: number): Promise<Collection> {
    const assignments = [
      'handle', 'title', 'description', 'type', 'match',
      'conditions', 'exclusions', 'product_ids', 'sort_order', 'version',
    ];
    const parameters: unknown[] = [
      collection.handle, collection.title, collection.description, collection.type, collection.match,
      JSON.stringify(collection.conditions), JSON.stringify(collection.exclusions),
      JSON.stringify(collection.productIds), collection.sortOrder, collection.version,
      this.storeId(), collection.id, expectedVersion,
    ];

    const placeholders = this.args(parameters.length);
    const setClause = assignments
      .map((column, index) => `${this.q(column)} = ${placeholders[index]}`)
      .join(', ');
    const [storeParam, idParam, versionParam] = placeholders.slice(assignments.length);

    const sql = `UPDATE ${this.q(TABLE)}
        SET ${setClause}, ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
      WHERE ${this.q('store_id')} = ${storeParam}
        AND ${this.q('id')} = ${idParam}
        AND ${this.q('version')} = ${versionParam}
        AND ${this.q('deleted_at')} IS NULL`;

    let affected: number;
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(`${sql} RETURNING ${this.q('id')}`, parameters);
      affected = rows.length;
    } else {
      const writable = this.executor as QueryExecutor & {
        execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
      };
      if (typeof writable.execute !== 'function') {
        throw new Error('This executor cannot report affected rows, so optimistic concurrency cannot be enforced.');
      }
      affected = (await writable.execute(sql, parameters)).affectedRows;
    }

    if (affected === 0) {
      throw new StaleWriteError('Collection', collection.id, expectedVersion, collection.version);
    }
    return collection;
  }

  async softDelete(id: string): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q(TABLE)} SET ${this.q('deleted_at')} = CURRENT_TIMESTAMP(3) WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2}`,
      [this.storeId(), id],
    );
  }
}

function toDomain(row: CollectionRow): Collection {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description ?? '',
    type: row.type as Collection['type'],
    match: row.match as Collection['match'],
    conditions: parseConditions(row.conditions),
    exclusions: parseConditions(row.exclusions),
    productIds: parseStrings(row.product_ids),
    sortOrder: row.sort_order as Collection['sortOrder'],
    version: Number(row.version),
  };
}

function parseConditions(value: unknown): Condition[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed as Condition[]) : [];
}

function parseStrings(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseJson(value: unknown): unknown {
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

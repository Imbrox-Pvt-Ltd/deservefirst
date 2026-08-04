/**
 * Orders · infrastructure/request.repository.ts
 * Persistence for the Request aggregate. Lines are loaded and written with their
 * request, never independently — the aggregate boundary is enforced here as well
 * as in the domain, because a repository that exposes lines separately makes the
 * boundary advisory (§14.3).
 * Layer: infrastructure.
 */

import { type Connection, type ListQuery, money, type StoreId } from '@deservefirst/contracts';

import { StaleWriteError } from '../../../core/entity-toolkit';
import { ListEngine, type QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import { requestResource } from '../contracts';
import { subtotal, type Request, type RequestLine } from '../domain';
import type { RequestRepository } from '../application';

const TABLE = 'requests';
const LINES = 'request_lines';

interface RequestRow extends Record<string, unknown> {
  id: string;
  reference: string;
  customer_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  status: string;
  currency: string;
  note: string | null;
  internal_note: string | null;
  quote_expires_at: Date | null;
  submitted_at: Date | null;
  responded_at: Date | null;
  version: number;
}

interface LineRow extends Record<string, unknown> {
  id: string;
  request_id: string;
  product_id: string;
  variant_id: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  list_price_amount_minor: string | null;
  list_price_currency: string | null;
  quoted_price_amount_minor: string | null;
  quoted_price_currency: string | null;
  position: number;
  note: string | null;
}

export class SqlRequestRepository implements RequestRepository {
  private readonly listEngine: ListEngine;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  private storeId(): StoreId {
    return requireStoreContext('orders.requests').storeId;
  }

  private args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async findById(id: string): Promise<Request | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<RequestRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    if (!row) return null;

    // Lines always travel with their request. Loading them separately is how a
    // caller ends up holding a line with no currency and no status.
    const lineRows = await this.executor.query<LineRow>(
      `SELECT * FROM ${this.q(LINES)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('request_id')} = ${p2} ORDER BY ${this.q('position')} ASC`,
      [this.storeId(), id],
    );

    return toDomain(row, lineRows);
  }

  async list(query: ListQuery): Promise<Connection<Request>> {
    const connection = await this.listEngine.list<RequestRow>({
      resource: requestResource,
      tableName: TABLE,
      query,
      dialect: this.dialect,
    });
    // The list does not load lines: a page of 50 requests would issue 50 extra
    // queries, and no list column needs them.
    return { ...connection, nodes: connection.nodes.map((row) => toDomain(row, [])) };
  }

  /**
   * Next sequence number for a human-facing reference. Derived from the highest
   * existing reference rather than a counter table, so the two cannot drift.
   */
  async nextSequence(): Promise<number> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<{ reference: string }>(
      `SELECT ${this.q('reference')} FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1}
       ORDER BY ${this.q('created_at')} DESC LIMIT 50`,
      [this.storeId()],
    );

    const highest = rows.reduce((max, row) => {
      const digits = /(\d+)\s*$/.exec(row.reference ?? '');
      const value = digits ? Number(digits[1]) : 0;
      return value > max ? value : max;
    }, 1000);

    return highest + 1;
  }

  async insert(request: Request): Promise<Request> {
    await this.writeRequestRow(request, 'insert');
    await this.replaceLines(request);
    return request;
  }

  async update(request: Request, expectedVersion: number): Promise<Request> {
    const affected = await this.writeRequestRow(request, 'update', expectedVersion);
    if (affected === 0) {
      throw new StaleWriteError('Request', request.id, expectedVersion, request.version);
    }
    await this.replaceLines(request);
    return request;
  }

  private async writeRequestRow(
    request: Request,
    mode: 'insert' | 'update',
    expectedVersion?: number,
  ): Promise<number> {
    const total = subtotal(request);
    const values = [
      request.reference,
      request.customerId,
      request.contactEmail,
      request.contactName,
      request.status,
      request.currency,
      request.lines.length,
      total.amountMinor.toString(),
      total.currency,
      request.note,
      request.internalNote,
      request.quoteExpiresAt,
      request.submittedAt,
      request.respondedAt,
      request.version,
    ];

    const columns = [
      'reference', 'customer_id', 'contact_email', 'contact_name', 'status', 'currency',
      'line_count', 'subtotal_amount_minor', 'subtotal_currency', 'note', 'internal_note',
      'quote_expires_at', 'submitted_at', 'responded_at', 'version',
    ];

    if (mode === 'insert') {
      const all = ['id', 'store_id', 'handle', ...columns];
      await this.executor.query(
        `INSERT INTO ${this.q(TABLE)} (${all.map((column) => this.q(column)).join(', ')})
         VALUES (${this.args(all.length).join(', ')})`,
        [request.id, this.storeId(), request.id, ...values],
      );
      return 1;
    }

    const parameters = [...values, this.storeId(), request.id, expectedVersion];
    const placeholders = this.args(parameters.length);
    const setClause = columns
      .map((column, index) => `${this.q(column)} = ${placeholders[index]}`)
      .join(', ');
    const [storeParam, idParam, versionParam] = placeholders.slice(columns.length);

    const sql = `UPDATE ${this.q(TABLE)}
        SET ${setClause}, ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
      WHERE ${this.q('store_id')} = ${storeParam}
        AND ${this.q('id')} = ${idParam}
        AND ${this.q('version')} = ${versionParam}
        AND ${this.q('deleted_at')} IS NULL`;

    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(`${sql} RETURNING ${this.q('id')}`, parameters);
      return rows.length;
    }

    const writable = this.executor as QueryExecutor & {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };
    if (typeof writable.execute !== 'function') {
      throw new Error('This executor cannot report affected rows, so optimistic concurrency cannot be enforced.');
    }
    return (await writable.execute(sql, parameters)).affectedRows;
  }

  /**
   * Lines are replaced wholesale rather than diffed. The set is small and bounded
   * (250), and a diff would have to reason about reordering, which is where
   * line-level merge bugs live.
   */
  private async replaceLines(request: Request): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `DELETE FROM ${this.q(LINES)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('request_id')} = ${p2}`,
      [this.storeId(), request.id],
    );

    const columns = [
      'id', 'store_id', 'handle', 'request_id', 'product_id', 'variant_id', 'title', 'sku',
      'quantity', 'list_price_amount_minor', 'list_price_currency',
      'quoted_price_amount_minor', 'quoted_price_currency', 'position', 'note', 'version',
    ];

    let position = 0;
    for (const line of request.lines) {
      await this.executor.query(
        `INSERT INTO ${this.q(LINES)} (${columns.map((column) => this.q(column)).join(', ')})
         VALUES (${this.args(columns.length).join(', ')})`,
        [
          line.id, this.storeId(), line.id, request.id, line.productId, line.variantId,
          line.title, line.sku, line.quantity,
          line.listPrice.amountMinor.toString(), line.listPrice.currency,
          line.quotedPrice?.amountMinor.toString() ?? null, line.quotedPrice?.currency ?? null,
          position, line.note, 1,
        ],
      );
      position += 1;
    }
  }
}

function toDomain(row: RequestRow, lines: readonly LineRow[]): Request {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    status: row.status as Request['status'],
    currency: row.currency,
    lines: lines.map(toLine),
    note: row.note,
    internalNote: row.internal_note,
    quoteExpiresAt: row.quote_expires_at,
    submittedAt: row.submitted_at,
    respondedAt: row.responded_at,
    version: Number(row.version),
  };
}

function toLine(row: LineRow): RequestLine {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    title: row.title,
    sku: row.sku,
    quantity: Number(row.quantity),
    listPrice: money(BigInt(row.list_price_amount_minor ?? '0'), row.list_price_currency ?? 'USD'),
    quotedPrice:
      row.quoted_price_amount_minor === null || row.quoted_price_amount_minor === undefined
        ? null
        : money(BigInt(row.quoted_price_amount_minor), row.quoted_price_currency ?? 'USD'),
    note: row.note,
  };
}

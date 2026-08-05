/**
 * Storefront · infrastructure/message-status.ts
 * Marking a contact message read, replied or spam.
 *
 * Small enough to sit here rather than behind a service: there is one field, no
 * invariant beyond the enum the controller already checks, and no event worth
 * emitting — nobody subscribes to "a merchant clicked read".
 * Layer: infrastructure.
 */

import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';

export class SqlMessageStatus {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  async setStatus(id: string, status: string): Promise<{ id: string; status: string }> {
    /**
     * The store comes from the context and is part of the WHERE clause.
     *
     * Without it, an id from another tenant would update their row — an id is
     * not a permission, and this endpoint takes one straight from a URL.
     */
    const storeId = requireStoreContext('storefront.message.status').storeId;

    /**
     * `execute`, not `query`, because only one of them can count.
     *
     * `query` returns rows, and MySQL answers an UPDATE with a header rather
     * than an array — so reading `affectedRows` off its result was always
     * `undefined`, the zero-row check never fired, and triaging a message that
     * belonged to another store reported SUCCESS while changing nothing. The
     * row was safe; the answer was a lie, which is its own kind of bug.
     *
     * The aggregate repository refuses to run at all on an executor that cannot
     * report this, and for the same reason: a write you cannot count is a write
     * you cannot verify.
     */
    const writable = this.executor as QueryExecutor & {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };

    if (!writable.execute) {
      throw new Error(
        'This executor cannot report affected rows, so a message status change cannot be verified.',
      );
    }

    const { affectedRows } = await writable.execute(
      `UPDATE ${this.q('contact_messages')}
          SET ${this.q('status')} = ${this.p(1)},
              ${this.q('updated_at')} = ${this.p(2)},
              ${this.q('version')} = ${this.q('version')} + 1
        WHERE ${this.q('id')} = ${this.p(3)} AND ${this.q('store_id')} = ${this.p(4)}`,
      [status, new Date(), id, storeId],
    );

    /**
     * Nothing matched: either no such message, or one belonging to another
     * store. Answered identically and vaguely on purpose — telling a caller
     * which would let them probe for ids that exist elsewhere.
     */
    if (affectedRows === 0) {
      throw Object.assign(new Error('No message with that id in this store.'), { statusCode: 404 });
    }

    return { id, status };
  }
}

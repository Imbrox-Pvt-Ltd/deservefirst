/**
 * Storefront · tests/messages.test.mjs
 * Triaging a contact message, and the write that could not be verified.
 *
 * The test that earns its place is the last one. A cross-tenant status change
 * never touched the row — the `store_id` in the WHERE clause saw to that — but
 * it REPORTED SUCCESS, because `query` returns rows and MySQL answers an UPDATE
 * with a header. Reading `affectedRows` off an array is `undefined`, so the
 * zero-row check never fired.
 *
 * Nothing leaked. The answer was simply a lie, which is its own kind of bug: a
 * caller marks a message spam, is told it worked, and it is still in the inbox.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqlMessageStatus } from '../../../dist/storefront/infrastructure/index.js';
import { storefrontContext, withRequestContext } from '../../../dist/core/tenant-context/index.js';

/** An executor shaped like the real one: `query` returns rows, `execute` counts. */
function executor({ affectedRows }) {
  const calls = [];
  return {
    calls,
    query: async () => [],
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return { affectedRows };
    },
  };
}

const inStore = (storeId, work) => withRequestContext(storefrontContext(storeId), work);

test('a status change scopes to the store from the context', async () => {
  /**
   * An id arrives straight from a URL and is not a permission. The store comes
   * from the context, which the transport set from the resolved host.
   */
  const db = executor({ affectedRows: 1 });
  const service = new SqlMessageStatus(db);

  const result = await inStore('store_1', () => service.setStatus('msg_1', 'read'));

  assert.deepEqual(result, { id: 'msg_1', status: 'read' });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /store_id/, 'the update must be store-scoped');
  assert.deepEqual(db.calls[0].params.slice(2), ['msg_1', 'store_1']);
});

test('a change that matched nothing is reported, not swallowed', async () => {
  /**
   * The bug this pins. Zero rows means either no such message or one belonging
   * to another store — and reporting success for either tells a merchant they
   * filed something they did not.
   */
  const service = new SqlMessageStatus(executor({ affectedRows: 0 }));

  await assert.rejects(
    () => inStore('store_1', () => service.setStatus('msg_from_elsewhere', 'spam')),
    (error) => error.statusCode === 404 && /No message with that id/.test(error.message),
  );
});

test('the refusal does not say which of the two reasons it was', async () => {
  // Distinguishing them would let a caller probe for ids that exist elsewhere.
  const service = new SqlMessageStatus(executor({ affectedRows: 0 }));
  const error = await inStore('store_1', () => service.setStatus('x', 'read')).catch((e) => e);

  assert.ok(!/other store|another/i.test(error.message), error.message);
});

test('an executor that cannot count is refused outright', async () => {
  /**
   * The same stance the aggregate repository takes: a write you cannot count is
   * a write you cannot verify, so it does not run at all rather than running
   * and guessing.
   */
  const service = new SqlMessageStatus({ query: async () => [] });

  await assert.rejects(
    () => inStore('store_1', () => service.setStatus('msg_1', 'read')),
    /cannot report affected rows/,
  );
});

test('a status change outside a store context is refused by the guard', async () => {
  // There is no storeId to fall back on, and inventing one would be the whole
  // tenant boundary undone.
  const service = new SqlMessageStatus(executor({ affectedRows: 1 }));
  await assert.rejects(() => service.setStatus('msg_1', 'read'));
});

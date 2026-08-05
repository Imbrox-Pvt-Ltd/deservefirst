/**
 * Apps · tests/monitoring.test.mjs
 * What a health page says, and what the buffer does under pressure.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMITTED_LOG_TYPES, LOG_TYPES, headline, summarise } from '../../../dist/apps/domain/index.js';
import { AppRequestLogger } from '../../../dist/apps/application/request-log.js';

const call = (over = {}) => ({
  id: 'l-1', appId: 'app-1', storeId: 'sto-1', type: 'rest_request',
  method: 'GET', path: '/2026-01/catalog/products', status: 200, durationMs: 10,
  apiVersion: '2026-01', deprecation: null, at: new Date('2026-01-01'), ...over,
});

test('the taxonomy matches the reference product, including what we cannot emit', () => {
  // Copied exactly on purpose: a vocabulary that is 80% the same is worse than
  // one that is identical or obviously different.
  assert.deepEqual([...LOG_TYPES], [
    'webhook', 'function', 'app_event', 'billing_event',
    'graphql_request', 'rest_request', 'ui_extension_error', 'assistant_event',
  ]);
  // Declared but not producible yet — there are no functions or billing.
  assert.deepEqual([...EMITTED_LOG_TYPES], ['webhook', 'app_event', 'rest_request']);
});

test("the app's errors and ours are counted separately", () => {
  const summary = summarise([
    call(), call({ status: 404 }), call({ status: 403 }), call({ status: 500 }),
  ]);

  // One "error rate" hides which conversation the author is about to have.
  assert.equal(summary.clientErrors, 2);
  assert.equal(summary.serverErrors, 1);
  assert.equal(summary.total, 4);
});

test('slow endpoints are ranked, averaged per path', () => {
  const summary = summarise([
    call({ path: '/fast', durationMs: 5 }),
    call({ path: '/slow', durationMs: 300 }),
    call({ path: '/slow', durationMs: 100 }),
  ]);

  assert.equal(summary.slowest[0].path, '/slow');
  assert.equal(summary.slowest[0].averageMs, 200);
  assert.equal(summary.slowest[0].calls, 2);
});

test('deprecated calls lead, however few there are', () => {
  const noisy = summarise([call({ status: 404 }), call({ status: 404 }), call({ status: 500 })]);
  const oneDeprecated = summarise([call({ deprecation: 'Use /v2/products before 2027-01' })]);

  // A thousand 404s is an app already broken, whose author knows. A single call
  // to something being removed is a release that WILL break, and does not.
  assert.match(headline(oneDeprecated), /being removed/);
  assert.match(headline(noisy), /failed on our side/);
  assert.equal(headline(summarise([call()])), null);
});

test('the logger batches, and never makes the caller wait', () => {
  const written = [];
  const logger = new AppRequestLogger({
    batchSize: 3,
    write: async (logs) => {
      written.push(logs.length);
    },
  });

  // `record` returns void so it cannot be awaited onto the hot path by accident.
  assert.equal(logger.record({ ...call(), id: undefined }), undefined);
  logger.record(call());
  assert.equal(logger.pending(), 2);

  logger.record(call());
  assert.equal(logger.pending(), 0, 'flushed at the batch size');
});

test('a failed flush drops the batch rather than failing anything', async () => {
  const reported = [];
  const logger = new AppRequestLogger({
    write: async () => {
      throw new Error('database is down');
    },
    onError: (error) => reported.push(error.message),
  });

  logger.record(call());
  // Does not reject. A log write that fails must not take an app request with
  // it, and a retry queue for observability is a second outbox to operate.
  assert.equal(await logger.flush(), 0);
  assert.deepEqual(reported, ['database is down']);
  assert.equal(logger.pending(), 0);
});

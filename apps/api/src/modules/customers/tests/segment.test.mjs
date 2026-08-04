/**
 * Customers · tests/segment.test.mjs
 * Segments translate to the SAME filter tokens the customer list uses.
 *
 * That is the property worth pinning: if a segment ever evaluated through its
 * own path, it would eventually disagree with the customer screen showing the
 * identical filter, and nobody could tell which was lying.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertSegmentValid,
  conditionToToken,
  segmentQueries,
} from '../../../../dist/modules/customers/domain/index.js';

const segment = (over = {}) => ({
  id: 's-1',
  name: 'Subscribed',
  match: 'all',
  conditions: [{ field: 'emailConsent', operator: 'equals', value: 'subscribed' }],
  version: 1,
  ...over,
});

test('a segment needs a name and at least one condition', () => {
  assert.throws(() => assertSegmentValid(segment({ name: '  ' })), /needs a name/);
  // No conditions is every customer, which is the customer list — saving that as
  // a "segment" guarantees somebody is later surprised by one meaning everyone.
  assert.throws(() => assertSegmentValid(segment({ conditions: [] })), /at least one condition/);
});

test('comparison operators only apply to numeric fields', () => {
  assert.throws(
    () =>
      assertSegmentValid(
        segment({ conditions: [{ field: 'emailConsent', operator: 'greaterThan', value: '2' }] }),
      ),
    /only applies to numeric fields/,
  );
  assert.doesNotThrow(() =>
    assertSegmentValid(
      segment({ conditions: [{ field: 'ordersCount', operator: 'greaterThan', value: '2' }] }),
    ),
  );
});

test('conditions become the filter tokens the list engine already parses', () => {
  assert.equal(
    conditionToToken({ field: 'emailConsent', operator: 'equals', value: 'subscribed' }),
    'emailConsent:subscribed',
  );
  assert.equal(
    conditionToToken({ field: 'ordersCount', operator: 'greaterThan', value: '3' }),
    'ordersCount:>3',
  );
  assert.equal(
    conditionToToken({ field: 'state', operator: 'notEquals', value: 'disabled' }),
    'state:!disabled',
  );
  // A value with a space is quoted, or the engine reads it as two tokens.
  assert.equal(
    conditionToToken({ field: 'tag', operator: 'equals', value: 'trade only' }),
    'tag:"trade only"',
  );
});

test('"all" is one query, because the engine ANDs its tokens', () => {
  const queries = segmentQueries(
    segment({
      conditions: [
        { field: 'emailConsent', operator: 'equals', value: 'subscribed' },
        { field: 'state', operator: 'equals', value: 'enabled' },
      ],
    }),
  );

  assert.deepEqual(queries, ['emailConsent:subscribed state:enabled']);
});

test('"any" is one query PER condition, because the engine has no OR', () => {
  const queries = segmentQueries(
    segment({
      match: 'any',
      conditions: [
        { field: 'emailConsent', operator: 'equals', value: 'subscribed' },
        { field: 'state', operator: 'equals', value: 'disabled' },
      ],
    }),
  );

  // Concatenating them would quietly return the INTERSECTION — the wrong people,
  // delivered confidently.
  assert.deepEqual(queries, ['emailConsent:subscribed', 'state:disabled']);
});

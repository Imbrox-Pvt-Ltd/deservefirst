/**
 * Catalog · tests/collection.test.mjs
 * The collection rule engine. Exclusions are the part most likely to be subtly
 * wrong, because "any" match mode and exclusions interact in a way that is easy
 * to get backwards.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCollectionValid,
  CollectionInvariantError,
  isMember,
  matchesCondition,
} from '../../../../dist/modules/catalog/domain/index.js';

const product = (overrides = {}) => ({
  title: 'Blue Wool Sweater',
  handle: 'blue-wool-sweater',
  productType: 'Apparel',
  vendor: 'Acme',
  tags: ['Sale', 'Winter'],
  price: { amountMinor: 4999n, currency: 'USD' },
  compareAtPrice: { amountMinor: 7999n, currency: 'USD' },
  inventoryQuantity: 12,
  ...overrides,
});

const collection = (overrides = {}) => ({
  id: 'c1',
  handle: 'sale',
  title: 'Sale',
  description: '',
  type: 'automated',
  match: 'all',
  conditions: [],
  exclusions: [],
  productIds: [],
  sortOrder: 'manual',
  version: 1,
  ...overrides,
});

// --- conditions -------------------------------------------------------------

test('text conditions are case-insensitive and support substrings', () => {
  const p = product();
  assert.equal(matchesCondition(p, { field: 'title', operator: 'contains', value: 'wool' }), true);
  assert.equal(matchesCondition(p, { field: 'title', operator: 'startsWith', value: 'BLUE' }), true);
  assert.equal(matchesCondition(p, { field: 'title', operator: 'endsWith', value: 'sweater' }), true);
  assert.equal(matchesCondition(p, { field: 'vendor', operator: 'equals', value: 'acme' }), true);
  assert.equal(matchesCondition(p, { field: 'vendor', operator: 'notEquals', value: 'acme' }), false);
});

test('tags are a set, not a concatenated string', () => {
  const p = product({ tags: ['Sale', 'Winter'] });
  assert.equal(matchesCondition(p, { field: 'tag', operator: 'equals', value: 'sale' }), true);
  assert.equal(matchesCondition(p, { field: 'tag', operator: 'contains', value: 'winter' }), true);
  // "salewinter" would match if tags were joined into one string. They are not.
  assert.equal(matchesCondition(p, { field: 'tag', operator: 'contains', value: 'salewinter' }), false);
  // Nor does a partial tag match.
  assert.equal(matchesCondition(p, { field: 'tag', operator: 'contains', value: 'sal' }), false);
});

test('money compares on exact minor units, not a formatted string', () => {
  const p = product({ price: { amountMinor: 4999n, currency: 'USD' } });
  assert.equal(matchesCondition(p, { field: 'price', operator: 'greaterThan', value: '4000' }), true);
  assert.equal(matchesCondition(p, { field: 'price', operator: 'lessThan', value: '4999' }), false);
  assert.equal(matchesCondition(p, { field: 'price', operator: 'equals', value: '4999' }), true);
});

test('a missing compare-at price is zero, not a match for everything', () => {
  const p = product({ compareAtPrice: null });
  assert.equal(matchesCondition(p, { field: 'compareAtPrice', operator: 'greaterThan', value: '0' }), false);
});

// --- membership -------------------------------------------------------------

test('match "all" requires every condition', () => {
  const c = collection({
    match: 'all',
    conditions: [
      { field: 'tag', operator: 'equals', value: 'Sale' },
      { field: 'vendor', operator: 'equals', value: 'Acme' },
    ],
  });
  assert.equal(isMember(c, product(), 'p1'), true);
  assert.equal(isMember(c, product({ vendor: 'Other' }), 'p1'), false);
});

test('match "any" requires only one', () => {
  const c = collection({
    match: 'any',
    conditions: [
      { field: 'tag', operator: 'equals', value: 'Clearance' },
      { field: 'vendor', operator: 'equals', value: 'Acme' },
    ],
  });
  assert.equal(isMember(c, product(), 'p1'), true);
  assert.equal(isMember(c, product({ vendor: 'Other' }), 'p1'), false);
});

test('an exclusion removes a product that would otherwise match', () => {
  const c = collection({
    conditions: [{ field: 'tag', operator: 'equals', value: 'Sale' }],
    exclusions: [{ field: 'tag', operator: 'equals', value: 'Clearance' }],
  });

  assert.equal(isMember(c, product({ tags: ['Sale'] }), 'p1'), true);
  assert.equal(isMember(c, product({ tags: ['Sale', 'Clearance'] }), 'p1'), false);
});

test('one exclusion is enough even when the match mode is "any"', () => {
  // The match mode governs inclusion only. An exclusion is absolute — reading it
  // the other way would let a product with two inclusion matches survive an
  // exclusion, which is the opposite of what a merchant means by "except".
  const c = collection({
    match: 'any',
    conditions: [
      { field: 'tag', operator: 'equals', value: 'Sale' },
      { field: 'vendor', operator: 'equals', value: 'Acme' },
    ],
    exclusions: [{ field: 'tag', operator: 'equals', value: 'Clearance' }],
  });

  assert.equal(isMember(c, product({ tags: ['Sale', 'Clearance'] }), 'p1'), false);
});

test('a manual collection ignores conditions entirely', () => {
  const c = collection({ type: 'manual', conditions: [], productIds: ['p1', 'p2'] });
  assert.equal(isMember(c, product(), 'p1'), true);
  assert.equal(isMember(c, product(), 'p3'), false);
});

// --- invariants -------------------------------------------------------------

test('membership cannot have two sources of truth', () => {
  assert.throws(
    () =>
      assertCollectionValid(
        collection({
          type: 'automated',
          conditions: [{ field: 'tag', operator: 'equals', value: 'Sale' }],
          productIds: ['p1'],
        }),
      ),
    /cannot also have manual members/,
  );

  assert.throws(
    () =>
      assertCollectionValid(
        collection({ type: 'manual', conditions: [{ field: 'tag', operator: 'equals', value: 'Sale' }] }),
      ),
    /manual collection cannot have conditions/,
  );
});

test('an automated collection with no conditions is refused', () => {
  assert.throws(
    () => assertCollectionValid(collection({ type: 'automated', conditions: [] })),
    /needs at least one condition/,
  );
});

test('numeric operators are refused on text fields', () => {
  assert.throws(
    () =>
      assertCollectionValid(
        collection({ conditions: [{ field: 'title', operator: 'greaterThan', value: '5' }] }),
      ),
    /only applies to numeric fields/,
  );
});

test('a numeric field needs a number', () => {
  assert.throws(
    () =>
      assertCollectionValid(
        collection({ conditions: [{ field: 'price', operator: 'greaterThan', value: 'cheap' }] }),
      ),
    /needs a number/,
  );
});

test('an empty condition value is refused', () => {
  assert.throws(
    () =>
      assertCollectionValid(
        collection({ conditions: [{ field: 'tag', operator: 'equals', value: '  ' }] }),
      ),
    /needs a value/,
  );
  assert.throws(() => assertCollectionValid(collection({ title: '' })), CollectionInvariantError);
});

test('exclusions count toward the rule limit', () => {
  const many = Array.from({ length: 31 }, () => ({ field: 'tag', operator: 'equals', value: 'x' }));
  assert.throws(
    () => assertCollectionValid(collection({ conditions: many, exclusions: many })),
    /at most 60 rules/,
  );
});

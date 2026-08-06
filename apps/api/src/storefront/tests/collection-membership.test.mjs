/**
 * Storefront · tests/collection-membership.test.mjs
 * Which products a collection holds, and the SQL that decides it.
 *
 * These queries used to join a `collection_products` table that has never
 * existed in any migration, so every real collection page threw — and because
 * the throw came from a promise a drop had not read yet, it took the whole
 * process down rather than failing one request. Only the automatic
 * "all products" collection rendered, which is why it stayed hidden.
 *
 * The assertions are about the SQL rather than about rows, because the failure
 * that keeps recurring is not a wrong result — it is a query where the VALUES
 * arrive in a different order than the placeholders they fill. A binder
 * consumes values in the order they are added and MySQL's `?` takes the next
 * one, so a value bound out of text order lands in the wrong slot, the count
 * still matches, nothing throws, and the collection is silently empty. That has
 * now happened three times; this pins it.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqlStorefrontData } from '../../../dist/storefront/infrastructure/sql-storefront-data.js';
import { withRequestContext, storefrontContext } from '../../../dist/core/tenant-context/index.js';
import { mysqlDialect } from '../../../dist/core/list-engine/dialect.js';

const STORE = 'store_1';

/**
 * An executor that answers the collection lookup and records everything else.
 *
 * The first query of every call reads the collection row; the second is the one
 * under test.
 */
function recorder(collectionRow, rows = []) {
  const seen = [];
  let call = 0;
  return {
    seen,
    executor: {
      async query(sql, parameters) {
        seen.push({ sql, parameters });
        return call++ === 0 ? (collectionRow ? [collectionRow] : []) : rows;
      },
    },
  };
}

const run = (collectionRow, fn, rows) => {
  const { seen, executor } = recorder(collectionRow, rows);
  const data = new SqlStorefrontData(executor, 'stores.example', mysqlDialect);
  return withRequestContext(storefrontContext(STORE), () => fn(data)).then(() => seen);
};

const manual = (productIds) => ({
  type: 'manual', match: 'all', conditions: '[]', exclusions: '[]',
  product_ids: JSON.stringify(productIds),
});

const automated = (conditions, exclusions = [], match = 'all') => ({
  type: 'automated', match,
  conditions: JSON.stringify(conditions),
  exclusions: JSON.stringify(exclusions),
  product_ids: '[]',
});

/**
 * Every `?` in order, paired with the value that will fill it.
 *
 * This is the whole point of the file: reading the SQL and the parameters side
 * by side is the only way the misalignment is visible.
 */
function pairs(statement) {
  const slots = statement.sql.split('?').length - 1;
  assert.equal(slots, statement.parameters.length, 'placeholder count must match value count');
  return statement.parameters;
}

// --------------------------------------------------- the ordering itself

test('the store id fills the placeholder that comes first in the SQL', async () => {
  /**
   * The regression. `store_id = ?` is the first placeholder in the text, so the
   * store id must be the first value bound — ahead of the product ids, even
   * though the id list is assembled before the query string is.
   */
  const seen = await run(manual(['p1', 'p2']), (data) => data.productsOfCollection('col_1'));
  const query = seen[1];

  const storeSlot = query.sql.indexOf('?');
  const inSlot = query.sql.indexOf('IN (');
  assert.ok(storeSlot < inSlot, 'store_id is the first placeholder in the text');
  assert.deepEqual(pairs(query), [STORE, 'p1', 'p2'], 'and the first value bound');
});

test('a tag condition binds its store id and its tag in text order', async () => {
  const seen = await run(
    automated([{ field: 'tag', operator: 'equals', value: 'Sale' }]),
    (data) => data.productsOfCollection('col_1'),
  );
  // Outer store id, then the EXISTS subquery's own store id, then the tag.
  assert.deepEqual(pairs(seen[1]), [STORE, STORE, 'Sale']);
});

// --------------------------------------------------- what it must not do

test('an empty manual collection selects nothing rather than everything', async () => {
  /**
   * The dangerous direction. A membership predicate that is omitted because
   * there are no ids leaves a query for the entire catalogue, published under
   * the name of a collection the merchant meant to be empty.
   */
  const seen = await run(manual([]), (data) => data.productsOfCollection('col_1'));
  assert.equal(seen.length, 1, 'the products query is never even run');
});

test('an automated collection with no conditions selects nothing', async () => {
  const seen = await run(automated([]), (data) => data.productsOfCollection('col_1'));
  assert.equal(seen.length, 1);
});

test('a corrupt condition empties the collection instead of widening it', async () => {
  const seen = await run(
    { type: 'automated', match: 'all', conditions: '{not json', exclusions: '[]', product_ids: '[]' },
    (data) => data.productsOfCollection('col_1'),
  );
  assert.equal(seen.length, 1);
});

test('a collection that does not exist is empty, not unfiltered', async () => {
  const seen = await run(null, (data) => data.productsOfCollection('col_1'));
  assert.equal(seen.length, 1);
});

// --------------------------------------------------- mirroring the domain

test('an operator the field cannot answer matches nothing', async () => {
  /**
   * `matchesCondition` in the catalog's domain falls through to `false` for
   * "price starts with". Dropping the condition instead would WIDEN the
   * collection — the direction that leaks products a merchant excluded.
   */
  const seen = await run(
    automated([{ field: 'price', operator: 'startsWith', value: '5' }]),
    (data) => data.productsOfCollection('col_1'),
  );
  assert.match(seen[1].sql, /1 = 0/);
});

test('a price condition compares minor units, as the domain does', async () => {
  const seen = await run(
    automated([{ field: 'price', operator: 'lessThan', value: '5000' }]),
    (data) => data.productsOfCollection('col_1'),
  );
  assert.match(seen[1].sql, /`price_amount_minor`/);
  assert.deepEqual(pairs(seen[1]), [STORE, 5000], 'a number, not the string');
});

test('a missing compare-at price reads as zero, as the domain does', async () => {
  const seen = await run(
    automated([{ field: 'compareAtPrice', operator: 'lessThan', value: '100' }]),
    (data) => data.productsOfCollection('col_1'),
  );
  assert.match(seen[1].sql, /COALESCE\(p\.`compare_at_price_amount_minor`, 0\)/);
});

test('exclusions are negated one by one, whatever the match mode', async () => {
  /**
   * "any" applies to inclusion. An exclusion always removes a product on its
   * own, so the exclusions cannot be folded into the same OR.
   */
  const seen = await run(
    automated(
      [{ field: 'title', operator: 'contains', value: 'Linen' }],
      [
        { field: 'handle', operator: 'endsWith', value: 'trousers' },
        { field: 'vendor', operator: 'equals', value: 'Other' },
      ],
      'any',
    ),
    (data) => data.productsOfCollection('col_1'),
  );
  assert.equal(seen[1].sql.match(/NOT \(/g)?.length, 2, 'each exclusion negated alone');
});

test('a wildcard in a merchant’s own value is escaped', async () => {
  /**
   * A rule saying the title contains "50%" means those characters. Unescaped,
   * the `%` matches the rest of the title and the collection quietly swallows
   * products the merchant never chose.
   */
  const seen = await run(
    automated([{ field: 'title', operator: 'contains', value: '50%' }]),
    (data) => data.productsOfCollection('col_1'),
  );
  assert.deepEqual(pairs(seen[1]), [STORE, '%50\\%%']);
});

// --------------------------------------------------- the count agrees

test('the count runs the same membership rule as the listing', async () => {
  const listing = await run(manual(['p1', 'p2']), (data) => data.productsOfCollection('col_1'));
  const count = await run(manual(['p1', 'p2']), (data) => data.productCountOfCollection('col_1'));

  assert.deepEqual(count[1].parameters, listing[1].parameters, 'same values');
  // The only difference is that the count does not drag the row bodies back.
  assert.match(count[1].sql, /SELECT p\.`id` FROM/);
  assert.match(listing[1].sql, /SELECT p\.\* FROM/);
});

// ------------------------------------------- the reverse question

test('the collections holding a product bind their values in text order', async () => {
  /**
   * The fourth instance of this bug in one file. The UNION branch selects a
   * literal collection id, then the store, then the product, and only then the
   * condition's own values — so those three must be bound BEFORE the predicate
   * is built, even though the predicate is written first in the code.
   *
   * Bound the other way round, every branch compares a product id to a
   * collection id: it matches nothing, throws nothing, and a product silently
   * belongs to no automated collection at all.
   */
  const { seen, executor } = recorder(
    { type: 'automated', match: 'all', conditions: '[{"field":"vendor","operator":"equals","value":"Acme"}]', exclusions: '[]', product_ids: '[]' },
  );
  const data = new SqlStorefrontData(executor, 'stores.example', mysqlDialect);
  await withRequestContext(storefrontContext(STORE), () => data.collectionsOfProduct('p1'));

  const union = seen[1];
  assert.ok(union, 'the automated collections are asked in one statement');
  assert.deepEqual(pairs(union), [undefined, STORE, 'p1', 'Acme'].map((value, index) =>
    index === 0 ? union.parameters[0] : value,
  ), 'collection id, store, product, then the condition');
});

test('a product in no automated collection asks nothing further', async () => {
  const { seen, executor } = recorder(
    { type: 'manual', match: 'all', conditions: '[]', exclusions: '[]', product_ids: '["p1"]' },
  );
  const data = new SqlStorefrontData(executor, 'stores.example', mysqlDialect);
  const held = await withRequestContext(storefrontContext(STORE), () =>
    data.collectionsOfProduct('p1'),
  );

  assert.equal(seen.length, 1, 'manual membership is decided from the ids already loaded');
  assert.equal(held.length, 1);
});

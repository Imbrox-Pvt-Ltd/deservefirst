/**
 * Storefront · tests/catalogue-counts.test.mjs
 * How much catalogue there is, as the shop and collection objects report it.
 *
 * These are read by anonymous visitors, so the interesting assertion is not the
 * arithmetic — it is that a draft product is never counted. A count that
 * included unpublished rows would tell a shopper how many products they are not
 * allowed to see, which is a leak dressed up as a number.
 *
 * Assertions are on the generated SQL for the same reason as the collection
 * membership tests: the failure that keeps recurring is values bound out of
 * placeholder order, which produces a plausible-looking empty result and throws
 * nothing.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqlStorefrontData } from '../../../dist/storefront/infrastructure/sql-storefront-data.js';
import { withRequestContext, storefrontContext } from '../../../dist/core/tenant-context/index.js';
import { mysqlDialect } from '../../../dist/core/list-engine/dialect.js';
import { createDropContext, shopDrop } from '../../../dist/storefront/domain/index.js';

const STORE = 'store_1';

function recorder(rows = []) {
  const seen = [];
  return {
    seen,
    executor: {
      async query(sql, parameters) {
        seen.push({ sql, parameters });
        return rows;
      },
    },
  };
}

const run = (fn, rows) => {
  const { seen, executor } = recorder(rows);
  const data = new SqlStorefrontData(executor, 'stores.example', mysqlDialect);
  return withRequestContext(storefrontContext(STORE), () => fn(data)).then((value) => ({
    seen,
    value,
  }));
};

test('a draft product is never counted', async () => {
  const { seen } = await run((data) => data.productCount(), [{ n: 3 }]);
  assert.match(seen[0].sql, /`status` = 'active'/);
  assert.match(seen[0].sql, /`deleted_at` IS NULL/);
  assert.deepEqual(seen[0].parameters, [STORE], 'and it is scoped to one store');
});

test('collections are counted without inventing a publication rule', async () => {
  /**
   * There is no `status` column on a collection — a collection is visible
   * because it exists. Filtering on a status the admin does not have would
   * hide every collection ever made.
   */
  const { seen } = await run((data) => data.collectionCount(), [{ n: 7 }]);
  assert.ok(!seen[0].sql.includes('status'), seen[0].sql);
  assert.match(seen[0].sql, /`deleted_at` IS NULL/);
});

test('a product with no vendor is not a vendor called ""', async () => {
  /**
   * Themes render these as links. A blank entry draws one that points nowhere
   * and matches nothing.
   */
  const { seen, value } = await run((data) => data.productVendors(), [
    { value: 'Atelier' },
    { value: 'Other Co' },
  ]);
  assert.match(seen[0].sql, /`vendor` IS NOT NULL/);
  assert.match(seen[0].sql, /`vendor` <> ''/);
  assert.deepEqual(value, ['Atelier', 'Other Co']);
});

test('types and vendors are only ever taken from published products', async () => {
  for (const call of [(data) => data.productTypes(), (data) => data.productVendors()]) {
    const { seen } = await run(call, []);
    assert.match(seen[0].sql, /`status` = 'active'/);
  }
});

test('a collection’s vendors come from its membership, not the whole store', async () => {
  /**
   * Two queries: the collection's rule, then the products inside it. A single
   * query over `products` would list every vendor in the store under the name
   * of one collection.
   */
  const { seen } = await run(
    (data) => data.productVendorsOfCollection('col_1'),
    [{ type: 'manual', match: 'all', conditions: '[]', exclusions: '[]', product_ids: '["p1"]' }],
  );
  assert.equal(seen.length, 2);
  assert.match(seen[1].sql, /`id` IN \(/, 'narrowed to the collection’s members');
  assert.deepEqual(seen[1].parameters, [STORE, 'p1'], 'store first, as the SQL reads');
});

test('a collection that does not exist has no vendors rather than all of them', async () => {
  const { seen, value } = await run((data) => data.productVendorsOfCollection('missing'), []);
  assert.equal(seen.length, 1, 'the product query is never run');
  assert.deepEqual(value, []);
});

test('the shop object reports the counts it is given', async () => {
  const context = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      productCount: async () => 4,
      collectionCount: async () => 7,
      productTypes: async () => ['Shirts'],
      productVendors: async () => ['Atelier'],
    },
  });

  const shop = shopDrop({ id: 's', handle: 'demo', name: 'Demo', domain: 'x.test', currency: 'USD' }, context);
  assert.equal(await shop.products_count, 4);
  assert.equal(await shop.collections_count, 7);
  assert.deepEqual(await shop.types, ['Shirts']);
  assert.deepEqual(await shop.vendors, ['Atelier']);
});

test('a shop with no loaders reports nothing rather than throwing', async () => {
  /**
   * The theme editor renders without a database behind it, and a missing
   * loader has to mean "nothing" rather than an accessor that takes the
   * surrounding section down with it.
   */
  const bare = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test', load: {},
  });
  const shop = shopDrop({ id: 's', handle: 'demo', name: 'Demo', domain: 'x.test', currency: 'USD' }, bare);
  assert.equal(await shop.products_count, 0);
  assert.equal(await shop.collections_count, 0);
  assert.deepEqual(await shop.types, []);
  assert.deepEqual(await shop.vendors, []);
});

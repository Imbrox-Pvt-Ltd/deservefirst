/**
 * Storefront · tests/all-products.test.mjs
 * The collection every store has without anybody creating it.
 *
 * `/collections/all` is not a merchant's collection — it is the automatic one
 * holding everything they sell, and themes link to it constantly as "Shop all".
 * We answered 404, so a store with products had a navigation item leading
 * nowhere: worse than a missing link, because the menu promises a page that
 * does not exist.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_PRODUCTS_HANDLE,
  allProductsCollection,
  collectionDrop,
  createDropContext,
  isAllProducts,
} from '../../../dist/storefront/domain/index.js';

test('only the reserved handle is the automatic collection', () => {
  assert.equal(isAllProducts(ALL_PRODUCTS_HANDLE), true);
  for (const handle of ['sale', 'all-products', 'ALL', '', 'all/', 'allsorts']) {
    assert.equal(isAllProducts(handle), false, handle);
  }
});

test('it is titled in the merchant’s own words', () => {
  /**
   * A theme renders `{{ collection.title }}` as the page heading. A hardcoded
   * "All products" is English on a French storefront and a bug the merchant
   * cannot fix; the shop's own name localises itself.
   */
  const collection = allProductsCollection('Boutique Léa');
  assert.equal(collection.title, 'Boutique Léa');
  assert.equal(collection.handle, ALL_PRODUCTS_HANDLE);
  assert.equal(collection.id, ALL_PRODUCTS_HANDLE, 'the id is the handle — there is no row');
});

test('the drop asks the loader for everything, keyed on the handle', async () => {
  const asked = [];
  const products = [
    { id: 'p1', title: 'Linen Shirt', handle: 'linen-shirt', priceAmountMinor: '4500', inventoryQuantity: 7 },
    { id: 'p2', title: 'Wool Coat', handle: 'wool-coat', priceAmountMinor: '19900', inventoryQuantity: 2 },
  ];

  const context = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: (id) => { asked.push(id); return products; },
      productCountOfCollection: () => products.length,
    },
  });

  const collection = collectionDrop(allProductsCollection('Demo Store'), context);

  assert.equal((await collection.products).length, 2);
  assert.equal(await collection.products_count, 2, 'the theme gates its grid on this');
  assert.deepEqual(asked, [ALL_PRODUCTS_HANDLE], 'and the loader recognises it by that id');
});

test('a store with nothing to sell gets an empty collection, not a 404', () => {
  // The page must exist even when the catalogue does not: a theme renders its
  // own "nothing here" copy, which is a better answer than a missing page.
  const collection = allProductsCollection('Demo Store');
  assert.ok(collection);
  assert.equal(collection.description, null);
});

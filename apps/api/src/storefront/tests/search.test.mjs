/**
 * Storefront · tests/search.test.mjs
 * What a shopper is probably looking for, while they are still typing.
 *
 * The theme's search field was already wired to fetch this on every keystroke;
 * nothing answered it. The section counts all five kinds of result before it
 * renders anything, so a missing kind is not a smaller dropdown — it is
 * arithmetic on `undefined` and a blank panel.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDropContext,
  normaliseSearchTerms,
  NO_SEARCH,
  predictiveSearchDrop,
} from '../../../dist/storefront/domain/index.js';

const context = () =>
  createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: () => [], productCountOfCollection: () => 0,
    },
  });

const results = {
  products: [{ id: 'tee', title: 'Cotton Tee', handle: 'cotton-tee', priceAmountMinor: '1000' }],
  collections: [{ id: 'c1', title: 'Cotton', handle: 'cotton' }],
  pages: [{ id: 'p1', title: 'Cotton care', handle: 'cotton-care' }],
  articles: [{ id: 'a1', blogId: 'b1', title: 'On cotton', handle: 'on-cotton' }],
  queries: [{ text: 'cotton tee', url: '/search?q=cotton+tee' }],
};

// ------------------------------------------------------------- the object

test('nothing typed is not the same as nothing found', async () => {
  /**
   * The distinction the section turns on. `performed: false` makes the theme
   * render its default panel; `performed: true` with no results makes it say
   * so. Collapsing them shows "no results for ''" to somebody who has just
   * cleared the field.
   */
  const untyped = predictiveSearchDrop(NO_SEARCH, context());
  assert.equal(untyped.performed, false);
  assert.equal(untyped.terms, '');

  const emptyAnswer = predictiveSearchDrop(
    { performed: true, terms: 'zzz', results: { products: [], collections: [], pages: [], articles: [], queries: [] } },
    context(),
  );
  assert.equal(emptyAnswer.performed, true, 'asked');
  assert.equal(await emptyAnswer.resources.products.size, 0, 'and there were none');
});

test('every kind of result is countable, because the section counts all five', async () => {
  /**
   * `.size` on each, exactly as `sections/predictive-search.liquid` reads it
   * before deciding how many columns to draw. A kind that is absent rather
   * than empty makes that arithmetic produce nothing at all — the bug that hid
   * the product gallery once already.
   */
  const search = predictiveSearchDrop({ performed: true, terms: 'cotton', results }, context());
  const resources = search.resources;

  for (const kind of ['products', 'collections', 'pages', 'articles', 'queries']) {
    assert.equal(await resources[kind].size, 1, `${kind} must be countable`);
  }
});

test('the results come back as drops a theme can render', async () => {
  const search = predictiveSearchDrop({ performed: true, terms: 'cotton', results }, context());

  assert.equal(await search.resources.products[0].title, 'Cotton Tee');
  assert.equal(await search.resources.collections[0].handle, 'cotton');
  assert.equal(await search.resources.pages[0].title, 'Cotton care');
  assert.equal(await search.resources.articles[0].title, 'On cotton');
  assert.equal(await search.resources.queries[0].text, 'cotton tee');
});

// ------------------------------------------------------------- the terms

test('a wildcard is escaped rather than stripped', async () => {
  /**
   * Somebody searching for "50%" means those characters. Left alone, `%`
   * matches the whole catalogue — a search box that ignores what you typed.
   * Stripped, it silently searches for something else.
   */
  assert.equal(normaliseSearchTerms('50%'), '50\\%');
  assert.equal(normaliseSearchTerms('a_b'), 'a\\_b');
  assert.equal(normaliseSearchTerms('back\\slash'), 'back\\\\slash');
});

test('the term is bounded and trimmed, because it arrives on every keystroke', async () => {
  assert.equal(normaliseSearchTerms('  tee  '), 'tee');
  assert.equal(normaliseSearchTerms(null), '');
  assert.equal(normaliseSearchTerms(undefined), '');
  assert.equal(normaliseSearchTerms('x'.repeat(500)).length, 100);
});

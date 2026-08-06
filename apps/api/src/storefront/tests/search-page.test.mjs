/**
 * Storefront · tests/search-page.test.mjs
 * The search results page, and the properties a mixed result list needs.
 *
 * `searchDrop` existed from the beginning and was never placed in a scope, so
 * `/search?q=…` answered 200 with its layout and no results — a shop that
 * looked empty rather than broken. The same shape of gap as the faceting
 * layer: built, tested, and never wired.
 *
 * `object_type` is what makes one loop over three kinds of record possible.
 * Without it a search page renders a page and an article with the product
 * template, which is a worse failure than showing nothing.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  articleDrop,
  collectionDrop,
  createDropContext,
  pageDrop,
  productDrop,
  searchDrop,
  cacheKeyFor,
} from '../../../dist/storefront/domain/index.js';

const context = () =>
  createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: () => [], productCountOfCollection: () => 0,
      blogOfArticle: async () => ({ id: 'b1', handle: 'news', title: 'News' }),
    },
  });

test('a result knows what kind of thing it is', async () => {
  const drops = context();
  assert.equal(
    await productDrop({ id: 'p', handle: 'tee', title: 'Tee', priceAmountMinor: '1' }, drops).object_type,
    'product',
  );
  assert.equal(await pageDrop({ id: 'g', handle: 'about', title: 'About' }, drops).object_type, 'page');
  assert.equal(
    await articleDrop({ id: 'a', blogId: 'b1', handle: 'x', title: 'X' }, drops).object_type,
    'article',
  );
  assert.equal(
    await collectionDrop({ id: 'c', handle: 'all', title: 'All' }, drops).object_type,
    'collection',
  );
});

test('an article’s author is a record, because themes read user.name', async () => {
  /**
   * A bare string answers `.name` with nothing and the byline vanishes. The
   * same trap as the price range reading `min_value.value`.
   */
  const article = articleDrop(
    { id: 'a', blogId: 'b1', handle: 'x', title: 'X', author: 'Ada Lovelace' },
    context(),
  );
  const user = await article.user;
  assert.equal(user.name, 'Ada Lovelace');
  assert.equal(user.first_name, 'Ada');
  assert.equal(user.last_name, 'Lovelace');
  // The string stays too, because themes read that as well.
  assert.equal(await article.author, 'Ada Lovelace');
});

test('nothing typed is not the same as nothing found', async () => {
  const empty = searchDrop({ terms: '', performed: false, resultsCount: 0, results: [] }, context());
  assert.equal(await empty.performed, false);

  const nothing = searchDrop({ terms: 'zzz', performed: true, resultsCount: 0, results: [] }, context());
  assert.equal(await nothing.performed, true, 'asked');
  assert.equal(await nothing.results_count, 0, 'and there were none');
});

test('the count is the whole result set, not the page', async () => {
  /**
   * Themes print "24 results" beside a paginated list of twelve, so this comes
   * from a count rather than from the length of what one page holds.
   */
  const search = searchDrop(
    { terms: 'linen', performed: true, resultsCount: 24, results: [{}, {}] },
    context(),
  );
  assert.equal(await search.results_count, 24);
});

test('two different searches are two different cache entries', async () => {
  /**
   * The term is read by the platform, not by the theme, so the mechanism that
   * learns a page's parameters could not see it — and `?q=cotton` was answered
   * with the cached results for `?q=linen`.
   */
  const linen = cacheKeyFor('/search', 'q=linen', ['q']);
  const cotton = cacheKeyFor('/search', 'q=cotton', ['q']);
  assert.notEqual(linen, cotton);
  assert.equal(cacheKeyFor('/search', 'q=linen', []), '/search', 'and without the key they collide');
});

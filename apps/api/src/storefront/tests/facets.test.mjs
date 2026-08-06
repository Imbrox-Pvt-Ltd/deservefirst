/**
 * Storefront · tests/facets.test.mjs
 * Reading a shopper's filter and sort choices out of a URL.
 *
 * A query string is the least trustworthy input a storefront takes: public,
 * guessable, and pasted into links by people who edit it on the way. So every
 * assertion here is about narrowing — nothing a visitor can type may widen a
 * result set, reach an ORDER BY, or turn into a comparison against NaN.
 *
 * The cache assertions are the other half. Filters are read by the platform
 * rather than by the theme, so the mechanism that learns which parameters a
 * page depends on could not see them: the filtered page was stored under the
 * unfiltered key and served to everyone.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cacheKeyFor,
  DEFAULT_SORT,
  FACET_PARAM_KEYS,
  facetsAreActive,
  NO_FILTERS,
  parseFilterCriteria,
  parseSort,
  sortOptionsFor,
  filterDrop,
  createDropContext,
} from '../../../dist/storefront/domain/index.js';

const context = () =>
  createDropContext({ currency: 'USD', locale: 'en', baseUrl: 'https://x.test', load: {} });

// ------------------------------------------------------------- narrowing

test('a filter takes every value it was given, not just the first', async () => {
  const criteria = parseFilterCriteria('filter.p.tag=sale&filter.p.tag=new');
  assert.deepEqual(criteria.tags, ['sale', 'new']);
});

test('repeated identical values are one value', async () => {
  assert.deepEqual(parseFilterCriteria('filter.p.vendor=a&filter.p.vendor=a').vendors, ['a']);
});

test('a price that is not a number is dropped rather than compared', async () => {
  /**
   * `Number('abc')` is NaN, and NaN loses every comparison — so passing it on
   * empties the catalogue, which reads as a broken shop rather than as an
   * impossible request.
   */
  const criteria = parseFilterCriteria('filter.v.price.gte=abc&filter.v.price.lte=-5');
  assert.equal(criteria.priceMin, null);
  assert.equal(criteria.priceMax, null);
});

test('a reversed range is read as no range at all', async () => {
  const criteria = parseFilterCriteria('filter.v.price.gte=10000&filter.v.price.lte=5000');
  assert.equal(criteria.priceMin, null);
  assert.equal(criteria.priceMax, null);
});

test('a sort key nobody offers becomes the default, never SQL', async () => {
  assert.equal(parseSort('sort_by=price-ascending'), 'price-ascending');
  assert.equal(parseSort('sort_by=; DROP TABLE products'), DEFAULT_SORT);
  assert.equal(parseSort(''), DEFAULT_SORT);
});

test('the number of values one facet may carry is bounded', async () => {
  const many = Array.from({ length: 200 }, (_, index) => `filter.p.tag=t${index}`).join('&');
  assert.ok(parseFilterCriteria(many).tags.length <= 50);
});

// ------------------------------------------------- what makes a page indexable

test('an unfiltered collection is not a facet page', async () => {
  assert.equal(facetsAreActive(NO_FILTERS), false);
  assert.equal(facetsAreActive(parseFilterCriteria('sort_by=title-ascending')), false);
});

test('any active filter makes it one', async () => {
  /**
   * Drives `noindex` (§37.6). A catalogue of 200 products has tens of thousands
   * of filter combinations, and each indexed separately is thin duplicate
   * content competing with the page the merchant wants ranked.
   */
  for (const query of [
    'filter.p.tag=sale',
    'filter.p.vendor=acme',
    'filter.p.product_type=shoe',
    'filter.v.price.lte=5000',
  ]) {
    assert.equal(facetsAreActive(parseFilterCriteria(query)), true, query);
  }
});

// ------------------------------------------------------------- the cache

test('two different selections are two different cache entries', async () => {
  /**
   * The key kept only the first value of a repeated parameter, so ticking a
   * second filter was answered with the cached result of the first.
   */
  const one = cacheKeyFor('/collections/all', 'filter.p.tag=a', FACET_PARAM_KEYS);
  const two = cacheKeyFor('/collections/all', 'filter.p.tag=a&filter.p.tag=b', FACET_PARAM_KEYS);
  assert.notEqual(one, two);
});

test('ticking a then b is the same page as ticking b then a', async () => {
  const forwards = cacheKeyFor('/c', 'filter.p.tag=a&filter.p.tag=b', FACET_PARAM_KEYS);
  const backwards = cacheKeyFor('/c', 'filter.p.tag=b&filter.p.tag=a', FACET_PARAM_KEYS);
  assert.equal(forwards, backwards, 'one entry, not two, for one page');
});

test('a filtered page is never keyed as the unfiltered one', async () => {
  const plain = cacheKeyFor('/collections/all', '', FACET_PARAM_KEYS);
  const filtered = cacheKeyFor('/collections/all', 'filter.p.tag=sale', FACET_PARAM_KEYS);
  assert.equal(plain, '/collections/all');
  assert.notEqual(filtered, plain);
});

// ------------------------------------------------------------- the drops

test('a price range hands back objects, because themes read min_value.value', async () => {
  /**
   * The recurring trap: a theme addresses a setting as a record and we hand it
   * a scalar. `filter.min_value.value` on a number is nil, so the price filter
   * silently never looked set and its "clear" control never appeared.
   */
  const filter = filterDrop(
    {
      label: 'Price', param: 'filter.v.price.gte', filterType: 'price_range', values: [],
      minValue: 1000, maxValue: 5000, rangeMin: 500, rangeMax: 19900,
      currentUrl: '/collections/all',
    },
    context(),
  );

  assert.equal((await filter.min_value).value, 1000);
  assert.equal((await filter.max_value).value, 5000);
  // The bounds stay plain numbers — themes read `filter.range_max` directly.
  assert.equal(await filter.range_max, 19900);
});

test('an unset bound is absent, not zero', async () => {
  /**
   * How a theme tells "no price filter" from "a price filter at the very
   * bottom of the range". Zero would show a clear-filter chip on every page.
   */
  const filter = filterDrop(
    {
      label: 'Price', param: 'filter.v.price.gte', filterType: 'price_range', values: [],
      minValue: null, maxValue: null, rangeMin: 500, rangeMax: 19900,
      currentUrl: '/collections/all',
    },
    context(),
  );
  assert.equal(await filter.min_value, null);
  assert.equal(await filter.max_value, null);
});

test('a value carries the URL that applies it and the one that removes it', async () => {
  /**
   * The theme never builds these. Concatenating them by hand is what loses the
   * first tick when the second is made, or keeps `page=4` and shows an empty
   * result for a filter that has matches.
   */
  const filter = filterDrop(
    {
      label: 'Tag', param: 'filter.p.tag', filterType: 'list',
      values: [
        { value: 'sale', label: 'sale', count: 3, active: false, param: 'filter.p.tag' },
        { value: 'new', label: 'new', count: 1, active: true, param: 'filter.p.tag' },
      ],
      currentUrl: '/collections/all?filter.p.tag=new&page=4&sort_by=price-ascending',
    },
    context(),
  );

  const values = await filter.values;
  const added = await values[0].url_to_add;
  assert.ok(added.includes('filter.p.tag=new'), 'the tick already made is kept');
  assert.ok(added.includes('filter.p.tag=sale'), 'and the new one added');
  assert.ok(added.includes('sort_by=price-ascending'), 'the sort order survives');
  assert.ok(!added.includes('page=4'), 'but the page resets');
});

test('the current sort is the one marked active', async () => {
  const options = sortOptionsFor('price-descending');
  assert.equal(options.filter((option) => option.active).length, 1);
  assert.equal(options.find((option) => option.active).value, 'price-descending');
});

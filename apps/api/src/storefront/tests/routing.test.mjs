/**
 * Storefront · tests/routing.test.mjs
 * URLs in, page requests out — and query parameters a theme can safely read.
 *
 * The parameter tests carry the weight here. The reference product withholds
 * query parameters from themes, and the two reasons are reflected injection and
 * cache poisoning. We expose them, so these tests are the argument that doing so
 * is safe: a hostile parameter must render inert, and a page that read one must
 * be cached under a key that includes it.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import {
  cacheKeyFor,
  canonicalPath,
  createDropContext,
  matchRoute,
  MAX_PARAMS,
  MAX_PARAM_LENGTH,
  readableParams,
  requestDrop,
} from '../../../dist/storefront/domain/index.js';

const engine = createThemeEngine(defaultContext());
const context = createDropContext({
  currency: 'USD',
  locale: 'en',
  baseUrl: 'https://shop.test',
  load: {},
});

// ------------------------------------------------------------- routing

test('the storefront paths match the ones customers already have', () => {
  const cases = [
    ['/', { pageType: 'index' }],
    ['/products/linen-shirt', { pageType: 'product', handle: 'linen-shirt' }],
    ['/collections/sale', { pageType: 'collection', handle: 'sale' }],
    ['/collections', { pageType: 'list-collections' }],
    ['/pages/about-us', { pageType: 'page', handle: 'about-us' }],
    ['/blogs/news', { pageType: 'blog', handle: 'news' }],
    ['/blogs/news/spring-launch', { pageType: 'article', handle: 'spring-launch', parentHandle: 'news' }],
    ['/search', { pageType: 'search' }],
    ['/cart', { pageType: 'cart' }],
    ['/nonsense/here', { pageType: '404' }],
  ];

  for (const [path, expected] of cases) {
    const match = matchRoute(path);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(match[key], value, `${path} → ${key}`);
    }
  }
});

test('a collection tag filter is read as tags', () => {
  const match = matchRoute('/collections/shirts/blue+cotton');
  assert.equal(match.pageType, 'collection');
  assert.equal(match.handle, 'shirts');
  assert.deepEqual(match.tags, ['blue', 'cotton']);
});

test('a product reached through a collection is still a product', () => {
  // This is the URL `within` builds, and it must not 404.
  const match = matchRoute('/collections/sale/products/hat');
  assert.equal(match.pageType, 'product');
  assert.equal(match.handle, 'hat');
  assert.equal(match.parentHandle, 'sale');
});

test('a handle containing a dot keeps its tail', () => {
  // "3.5-inch-widget" is a real handle; stripping ".5-inch-widget" as a format
  // would 404 the product.
  const match = matchRoute('/products/3.5-inch-widget');
  assert.equal(match.handle, '3.5-inch-widget');
  assert.equal(match.format, undefined);
});

test('a real format suffix is separated from the handle', () => {
  const match = matchRoute('/products/hat.json');
  assert.equal(match.handle, 'hat');
  assert.equal(match.format, 'json');
});

test('doubled and trailing slashes do not create a second URL', () => {
  assert.deepEqual(matchRoute('//products//hat'), matchRoute('/products/hat'));
  assert.deepEqual(matchRoute('/products/hat/'), matchRoute('/products/hat'));
});

test('a query string does not change the route', () => {
  assert.equal(matchRoute('/collections/sale?sort_by=price').pageType, 'collection');
});

test('canonical drops the collection prefix and the tag filter', () => {
  /**
   * One page, one URL. A product reachable through four collections has five
   * paths; without a canonical, a search engine treats them as duplicates and
   * ranks none of them.
   */
  assert.equal(canonicalPath(matchRoute('/collections/sale/products/hat')), '/products/hat');
  assert.equal(canonicalPath(matchRoute('/collections/shirts/blue+cotton')), '/collections/shirts');
  assert.equal(canonicalPath(matchRoute('/blogs/news/spring')), '/blogs/news/spring');
});

// --------------------------------------------------- parameters: safety

test('a hostile parameter renders inert', async () => {
  /**
   * The reason the reference product withholds these. Liquid does not escape
   * output, so a raw parameter is reflected script on the merchant's domain,
   * reachable by sending a customer a link.
   */
  const { params } = readableParams('q=<script>alert(1)</script>');
  const request = requestDrop(
    { path: '/search', host: 'shop.test', origin: 'https://shop.test', pageType: 'search', locale: 'en', currency: 'USD', designMode: false, params },
    context,
  );

  const html = await engine.render(`<p>{{ request.params.q }}</p>`, { request });
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('a parameter cannot break out of an attribute', async () => {
  const { params } = readableParams(`view="><img src=x onerror=alert(1)>`);
  const request = requestDrop(
    { path: '/', host: 'h', origin: 'https://h', pageType: 'index', locale: 'en', currency: 'USD', designMode: false, params },
    context,
  );

  const html = await engine.render(`<div data-view="{{ request.params.view }}"></div>`, { request });
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&quot;'), html);
});

test('an ampersand is left alone, because escaping it is not what makes this safe', () => {
  // "shirts & ties" should read correctly; with < > " ' already gone, a value
  // cannot open a tag, so &amp; would be noise on the page for no gain.
  const { params } = readableParams('q=shirts %26 ties');
  assert.equal(params.q, 'shirts & ties');
});

test('a parameter value is capped', () => {
  const { params } = readableParams(`q=${'a'.repeat(5000)}`);
  assert.equal(params.q.length, MAX_PARAM_LENGTH);
});

test('the number of parameters is capped', () => {
  const query = Array.from({ length: 200 }, (_e, i) => `k${i}=v`).join('&');
  const { params } = readableParams(query);
  assert.equal(Object.keys(params).length, MAX_PARAMS);
});

test('prototype-polluting keys are refused', () => {
  const { params } = readableParams('__proto__=x&constructor=y&ok=z');
  assert.equal(params.ok, 'z');
  // The object is unchanged rather than carrying a poisoned prototype.
  assert.equal(Object.prototype.hasOwnProperty.call(params, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('a theme cannot write a parameter back', () => {
  const { params } = readableParams('a=1');
  assert.throws(() => {
    'use strict';
    params.a = 'changed';
  });
});

// ---------------------------------------------- parameters: cache safety

test('reading a parameter records it, so the cache key can include it', async () => {
  /**
   * The second reason the reference product withholds these: a page cached by
   * path alone, built from one visitor's `?utm_source`, is served to everyone
   * after them. Recording the reads turns that into a correct cache key.
   */
  const access = readableParams('variant=42&utm_source=newsletter&unused=x');
  const request = requestDrop(
    { path: '/products/hat', host: 'h', origin: 'https://h', pageType: 'product', locale: 'en', currency: 'USD', designMode: false, params: access.params },
    context,
  );

  await engine.render(`{{ request.params.variant }}`, { request });

  assert.deepEqual(access.readKeys(), ['variant']);
  assert.equal(
    cacheKeyFor('/products/hat', 'variant=42&utm_source=newsletter&unused=x', access.readKeys()),
    '/products/hat?variant=42',
  );
});

test('a page that reads nothing caches by path alone', () => {
  const access = readableParams('utm_source=newsletter');
  assert.deepEqual(access.readKeys(), []);
  assert.equal(cacheKeyFor('/products/hat', 'utm_source=newsletter', access.readKeys()), '/products/hat');
});

test('looping the parameters records all of them', async () => {
  // Otherwise a theme that iterated them would produce a page cached under a
  // key that ignored every one.
  const access = readableParams('a=1&b=2');
  const request = requestDrop(
    { path: '/', host: 'h', origin: 'https://h', pageType: 'index', locale: 'en', currency: 'USD', designMode: false, params: access.params },
    context,
  );

  await engine.render(`{% for p in request.params %}{{ p[0] }}{% endfor %}`, { request });
  assert.deepEqual(access.readKeys(), ['a', 'b']);
});

// ------------------------------------------------- what themes can now do

test('a theme can branch on a parameter', async () => {
  const { params } = readableParams('view=grid');
  const request = requestDrop(
    { path: '/collections/all', host: 'h', origin: 'https://h', pageType: 'collection', locale: 'en', currency: 'USD', designMode: false, params },
    context,
  );

  const html = await engine.render(
    `{% if request.params.view == 'grid' %}GRID{% else %}LIST{% endif %}`,
    { request },
  );
  assert.equal(html, 'GRID');
});

test('an absent parameter is empty rather than an error', async () => {
  const { params } = readableParams('');
  const request = requestDrop(
    { path: '/', host: 'h', origin: 'https://h', pageType: 'index', locale: 'en', currency: 'USD', designMode: false, params },
    context,
  );
  assert.equal(await engine.render(`[{{ request.params.missing }}]`, { request }), '[]');
});

test('request.url is the whole address, for a canonical tag', async () => {
  const request = requestDrop(
    {
      path: '/collections/sale', host: 'shop.test', origin: 'https://shop.test',
      pageType: 'collection', locale: 'en', currency: 'USD', designMode: false,
      queryString: 'page=2',
    },
    context,
  );
  assert.equal(
    await engine.render(`{{ request.url }}`, { request }),
    'https://shop.test/collections/sale?page=2',
  );
});

test('request.query_string is escaped too', async () => {
  const request = requestDrop(
    {
      path: '/', host: 'h', origin: 'https://h', pageType: 'index',
      locale: 'en', currency: 'USD', designMode: false,
      queryString: 'q=<script>',
    },
    context,
  );
  const html = await engine.render(`{{ request.query_string }}`, { request });
  assert.ok(!html.includes('<script>'), html);
});

test('a parameter named "then" cannot make the object look like a promise', async () => {
  /**
   * Found by testing, not by reasoning. The engine awaits values it renders,
   * and an object with a `then` property IS a thenable — so `?then=x` would
   * make the whole parameter object await itself. It is refused outright,
   * along with the engine's own probe names.
   */
  const { params } = readableParams('then=x&next=y&toLiquid=z&constructor=w&ok=1');

  assert.equal(params.ok, '1');
  for (const reserved of ['then', 'next', 'toLiquid', 'constructor']) {
    assert.equal(Object.hasOwn(params, reserved), false, `"${reserved}" should be refused`);
  }

  const request = requestDrop(
    { path: '/', host: 'h', origin: 'https://h', pageType: 'index', locale: 'en', currency: 'USD', designMode: false, params },
    context,
  );
  // Renders rather than hanging, which is what a thenable would have caused.
  assert.equal(await engine.render(`[{{ request.params.ok }}]`, { request }), '[1]');
});

test('the engine probing the object does not pollute the cache key', async () => {
  // liquidjs looks for `then`, `next` and `toLiquid` on anything it renders.
  // Recording those put three phantom entries in every key.
  const access = readableParams('a=1&b=2');
  const request = requestDrop(
    { path: '/', host: 'h', origin: 'https://h', pageType: 'index', locale: 'en', currency: 'USD', designMode: false, params: access.params },
    context,
  );

  await engine.render(`{{ request.params.a }}`, { request });
  assert.deepEqual(access.readKeys(), ['a']);
});

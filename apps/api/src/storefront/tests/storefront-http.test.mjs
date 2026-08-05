/**
 * Storefront · tests/storefront-http.test.mjs
 * A URL in, a response out — the whole pipeline.
 *
 * Two stores are wired up on purpose. A storefront serves anonymous visitors,
 * so there is no permission check to catch a tenant mistake — the Host header
 * is the only thing deciding whose data is rendered, and it is
 * attacker-controlled. Several tests here exist solely to prove one store's
 * host cannot reach another store's content.
 *
 * The status codes matter almost as much. A missing product that returns 200
 * with a "not found" page is a soft 404, and search engines index it as a real
 * page — so the theme's 404 template must be served with an actual 404.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';

/** A minimal but complete theme: layout, four templates, three sections. */
const theme = new InMemoryThemeSource({
  'layout/theme.liquid':
    `<!doctype html><html><head><title>{{ shop.name }}</title></head>` +
    `<body>{{ content_for_layout }}</body></html>`,
  'templates/index.json': JSON.stringify({ sections: { hero: { type: 'hero' } }, order: ['hero'] }),
  'templates/product.json': JSON.stringify({ sections: { main: { type: 'main-product' } }, order: ['main'] }),
  'templates/page.json': JSON.stringify({ sections: { body: { type: 'page-body' } }, order: ['body'] }),
  'templates/404.json': JSON.stringify({ sections: { oops: { type: 'oops' } }, order: ['oops'] }),
  'sections/hero.liquid': `<h1>{{ shop.name }}</h1>`,
  'sections/main-product.liquid': `<h1>{{ product.title }}</h1><p>{{ product.price | money }}</p>`,
  'sections/page-body.liquid': `<article>{{ page.title }}</article>`,
  'sections/oops.liquid': `<p>Nothing here</p>`,
});

function storeFixture(name, { products = {}, pages = {}, redirects = [], closed = false } = {}) {
  return {
    storeId: `store-${name}`,
    theme,
    closed,
    data: {
      // The display name and the host slug are different things: a merchant
      // names their shop, the platform derives the host.
      shop: async () => ({
        id: `store-${name}`,
        name: name[0].toUpperCase() + name.slice(1),
        handle: name,
        domain: `${name}.test`,
        currency: 'USD',
      }),
      settings: async () => ({}),
      productByHandle: async (handle) => products[handle] ?? null,
      collectionByHandle: async () => null,
      pageByHandle: async (handle) => pages[handle] ?? null,
      blogByHandle: async () => null,
      articleByHandle: async () => null,
      variantsOfProduct: () => [],
      imagesOfProduct: () => [],
      productsOfCollection: () => [],
      productCountOfCollection: () => 0,
      image: () => null,
      redirects: async () => redirects,
      sitemapEntries: async (kind) =>
        kind === 'product'
          ? Object.values(products).map((p) => ({ loc: `https://${name}.test/products/${p.handle}` }))
          : [],
    },
  };
}

const alpha = storeFixture('alpha', {
  products: {
    'linen-shirt': {
      id: 'p1', handle: 'linen-shirt', title: 'Alpha Linen Shirt',
      priceAmountMinor: '4500', inventoryQuantity: 3,
    },
  },
  pages: { about: { id: 'pg1', handle: 'about', title: 'About Alpha' } },
  redirects: [{ from: '/products/old-shirt', to: '/products/linen-shirt' }],
});

const beta = storeFixture('beta', {
  products: {
    'secret-widget': {
      id: 'p9', handle: 'secret-widget', title: 'Beta Secret Widget',
      priceAmountMinor: '9900', inventoryQuantity: 1,
    },
  },
});

const resolver = {
  resolve: async (host) => {
    if (host === 'alpha.test') return alpha;
    if (host === 'beta.test') return beta;
    return null;
  },
};

const storefront = new StorefrontHandler(resolver);
const get = (host, path, query = '') =>
  storefront.handle({ host, path, query, method: 'GET' });

// ------------------------------------------------------------ it serves

test('the homepage renders through the theme', async () => {
  const response = await get('alpha.test', '/');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.ok(response.body.includes('<h1>Alpha</h1>'), response.body);
  assert.ok(response.body.startsWith('<!doctype html>'), response.body);
});

test('a product page renders its drop through a filter', async () => {
  const response = await get('alpha.test', '/products/linen-shirt');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('Alpha Linen Shirt'), response.body);
  assert.ok(response.body.includes('$45.00'), response.body);
});

test('a page renders', async () => {
  const response = await get('alpha.test', '/pages/about');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('About Alpha'), response.body);
});

// ------------------------------------------------------ tenant isolation

test('one store cannot reach another store through the Host header', async () => {
  /**
   * The whole tenant boundary. A storefront visitor is anonymous, so there is
   * no permission check to catch a mistake here — the host is the only thing
   * deciding whose data renders.
   */
  const onAlpha = await get('alpha.test', '/products/secret-widget');
  assert.equal(onAlpha.status, 404);
  assert.ok(!onAlpha.body.includes('Beta Secret Widget'), onAlpha.body);

  // And it is genuinely reachable on its own host, so the test is not vacuous.
  const onBeta = await get('beta.test', '/products/secret-widget');
  assert.equal(onBeta.status, 200);
  assert.ok(onBeta.body.includes('Beta Secret Widget'), onBeta.body);
});

test('an unknown host gets nothing, and reveals nothing', async () => {
  const response = await get('someone-elses.test', '/');
  assert.equal(response.status, 404);
  // No hint that alpha or beta exist.
  assert.ok(!response.body.includes('alpha'), response.body);
});

test('the host is matched after the port is dropped and case is folded', async () => {
  const response = await get('ALPHA.test:8080', '/');
  assert.equal(response.status, 200, 'a port or capital should not lose the store');
});

test('a forwarded list of hosts uses the first', async () => {
  const response = await get('alpha.test, evil.test', '/');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('Alpha'), response.body);
});

// ---------------------------------------------------------- status codes

test('a missing product is a real 404, not a soft one', async () => {
  /**
   * A "not found" page served with 200 is indexed as a real page, and the
   * merchant ends up with search results pointing at nothing.
   */
  const response = await get('alpha.test', '/products/does-not-exist');
  assert.equal(response.status, 404);
  assert.ok(response.body.includes('Nothing here'), response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('an unroutable path renders the theme 404', async () => {
  const response = await get('alpha.test', '/total/nonsense');
  assert.equal(response.status, 404);
  assert.ok(response.body.includes('Nothing here'), response.body);
});

test('a non-GET method is refused', async () => {
  const response = await storefront.handle({
    host: 'alpha.test', path: '/', query: '', method: 'POST',
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

// ------------------------------------------------------------ redirects

test('a renamed handle redirects before it can 404', async () => {
  /**
   * Order matters: routing first would 404 on the way past, because the
   * redirect exists precisely because the route no longer resolves.
   */
  const response = await get('alpha.test', '/products/old-shirt');
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/products/linen-shirt');
});

test('a redirect keeps the campaign parameters', async () => {
  const response = await get('alpha.test', '/products/old-shirt', 'utm_source=email');
  assert.equal(response.status, 301);
  assert.ok(response.headers.location.includes('utm_source=email'), response.headers.location);
});

// -------------------------------------------------------- machine files

test('robots.txt names the sitemap and blocks the thin URLs', async () => {
  const response = await get('alpha.test', '/robots.txt');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.ok(response.body.includes('Sitemap: https://alpha.test/sitemap.xml'), response.body);
  assert.ok(response.body.includes('Disallow: /cart'), response.body);
});

test('a closed store disallows everything', async () => {
  const shut = storeFixture('shut', { closed: true });
  const controller = new StorefrontHandler({
    resolve: async (host) => (host === 'shut.test' ? shut : null),
  });
  const response = await controller.handle({
    host: 'shut.test', path: '/robots.txt', query: '', method: 'GET',
  });
  assert.ok(response.body.includes('Disallow: /'), response.body);
  assert.ok(!response.body.includes('Disallow: /cart'), response.body);
});

test('sitemap.xml is an index pointing at the per-kind files', async () => {
  const response = await get('alpha.test', '/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/xml/);
  assert.ok(response.body.includes('<sitemapindex'), response.body);
  assert.ok(response.body.includes('sitemap_product_1.xml'), response.body);
});

test('a per-kind sitemap lists that store’s URLs only', async () => {
  const response = await get('alpha.test', '/sitemap_product_1.xml');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('alpha.test/products/linen-shirt'), response.body);
  assert.ok(!response.body.includes('secret-widget'), response.body);
});

// --------------------------------------------------- headers and caching

test('security headers are on every response', async () => {
  for (const path of ['/', '/robots.txt', '/does-not-exist']) {
    const response = await get('alpha.test', path);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
    assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin', path);
  }
});

test('a canonical link is sent, without the collection prefix', async () => {
  const response = await get('alpha.test', '/collections/sale/products/linen-shirt');
  assert.ok(
    response.headers.link.includes('https://alpha.test/products/linen-shirt'),
    response.headers.link,
  );
});

test('a page that reads no parameter caches by path alone', async () => {
  const response = await get('alpha.test', '/', 'utm_source=newsletter');
  assert.equal(response.status, 200);
  // The theme never reads utm_source, so it must not fragment the cache.
  assert.equal(response.cacheKey, '/');
});

test('a 404 is never cached', async () => {
  const response = await get('alpha.test', '/products/nope');
  assert.equal(response.cacheKey, null);
});

test('a page that reads a parameter caches per that parameter', async () => {
  /**
   * The other half of the cache-key work: a theme reading `?variant` must
   * produce a key that varies on it, or one visitor's page is served to the
   * next.
   */
  const reading = new InMemoryThemeSource({
    'layout/theme.liquid': `<html>{{ content_for_layout }}</html>`,
    'templates/index.json': JSON.stringify({ sections: { v: { type: 'v' } }, order: ['v'] }),
    'sections/v.liquid': `<p>{{ request.params.variant }}</p>`,
  });
  const store = { ...storeFixture('reads'), theme: reading };
  const controller = new StorefrontHandler({
    resolve: async (host) => (host === 'reads.test' ? store : null),
  });

  const response = await controller.handle({
    host: 'reads.test', path: '/', query: 'variant=42&utm_source=x', method: 'GET',
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.includes('42'), response.body);
  assert.equal(response.cacheKey, '/?variant=42');
});

test('a hostile parameter is inert by the time it reaches the page', async () => {
  const reading = new InMemoryThemeSource({
    'layout/theme.liquid': `<html>{{ content_for_layout }}</html>`,
    'templates/index.json': JSON.stringify({ sections: { v: { type: 'v' } }, order: ['v'] }),
    'sections/v.liquid': `<p>{{ request.params.q }}</p>`,
  });
  const store = { ...storeFixture('xss'), theme: reading };
  const controller = new StorefrontHandler({
    resolve: async (host) => (host === 'xss.test' ? store : null),
  });

  const response = await controller.handle({
    host: 'xss.test', path: '/', query: 'q=%3Cscript%3Ealert(1)%3C/script%3E', method: 'GET',
  });

  assert.ok(!response.body.includes('<script>alert'), response.body);
  assert.ok(response.body.includes('&lt;script&gt;'), response.body);
});

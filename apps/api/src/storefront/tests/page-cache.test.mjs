/**
 * Storefront · tests/page-cache.test.mjs
 * A cache that speeds a storefront up without ever serving the wrong page.
 *
 * The interesting tests here are not the hits. They are the refusals — a 404
 * kept, a signed-in page replayed to a stranger, or a nonce reused are each
 * worse than rendering 86 KB of Liquid again — and the one attack this design
 * has to withstand, which is markup trying to borrow a nonce from the cache.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decideCacheable,
  fullCacheKey,
  substitute,
  varyKey,
} from '../../../dist/storefront/domain/index.js';
import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource, MemoryPageCache } from '../../../dist/storefront/infrastructure/index.js';

// -------------------------------------------------------------- the rules

const conditions = (over = {}) => ({
  method: 'GET',
  status: 200,
  cacheKey: '/',
  hasSession: false,
  contentType: 'text/html; charset=utf-8',
  ...over,
});

test('an ordinary anonymous page is cacheable', () => {
  assert.equal(decideCacheable(conditions()).cacheable, true);
});

test('a page rendered for somebody signed in is never cached', () => {
  /**
   * The clause that matters most. Such a page may carry their name, their
   * orders or their cart, and caching it hands that to the next visitor on the
   * same URL.
   */
  const decision = decideCacheable(conditions({ hasSession: true }));
  assert.equal(decision.cacheable, false);
  assert.match(decision.reason, /signed-in/);
});

test('errors, redirects and non-GETs are refused', () => {
  assert.equal(decideCacheable(conditions({ status: 404 })).cacheable, false);
  assert.equal(decideCacheable(conditions({ status: 422 })).cacheable, false);
  assert.equal(decideCacheable(conditions({ status: 303 })).cacheable, false);
  assert.equal(decideCacheable(conditions({ method: 'POST' })).cacheable, false);
});

test('a render that refused caching is honoured', () => {
  // The render knows things the cache does not — it is allowed the last word.
  assert.equal(decideCacheable(conditions({ cacheKey: null })).cacheable, false);
});

test('the key separates stores and generations', () => {
  assert.notEqual(fullCacheKey('a', 0, '/'), fullCacheKey('b', 0, '/'));
  assert.notEqual(fullCacheKey('a', 0, '/'), fullCacheKey('a', 1, '/'));
  assert.notEqual(fullCacheKey('a', 0, '/'), varyKey('a', 0, '/'));
});

// ------------------------------------------------------------- the store

test('entries expire, and a hit is the most recent write', async () => {
  let clock = 1_000;
  const cache = new MemoryPageCache({ now: () => clock });
  const entry = { status: 200, headers: {}, body: 'x', noncePlaceholder: null, expiresAt: 2_000 };

  await cache.set('k', entry);
  assert.equal((await cache.get('k'))?.body, 'x');

  clock = 2_001;
  assert.equal(await cache.get('k'), null, 'expired');
  assert.equal(await cache.get('k'), null, 'and stays gone');
});

test('the cache is bounded by bytes and evicts the least recently used', async () => {
  /**
   * Bounded by bytes rather than entries because entries are pages: a thousand
   * product pages at 40 KB is forty megabytes, and an entry limit would look
   * reasonable while the process ran out of heap.
   */
  const cache = new MemoryPageCache({ maxBytes: 30, now: () => 0 });
  const page = (body) => ({ status: 200, headers: {}, body, noncePlaceholder: null, expiresAt: 1 });

  await cache.set('a', page('a'.repeat(10)));
  await cache.set('b', page('b'.repeat(10)));
  await cache.get('a'); // 'a' is now the more recently used of the two
  await cache.set('c', page('c'.repeat(10)));
  await cache.set('d', page('d'.repeat(10)));

  assert.equal(await cache.get('b'), null, 'the least recently used went first');
  assert.ok(await cache.get('a'), 'the one that was read survived');
  assert.ok(cache.stats().bytes <= 30);
});

test('a single page larger than the whole budget does not loop forever', async () => {
  const cache = new MemoryPageCache({ maxBytes: 10, now: () => 0 });
  await cache.set('big', {
    status: 200, headers: {}, body: 'x'.repeat(1000), noncePlaceholder: null, expiresAt: 1,
  });
  assert.equal(cache.stats().entries, 1);
});

test('invalidating a store moves its epoch and leaves others alone', async () => {
  const cache = new MemoryPageCache();
  assert.equal(cache.epochFor('s1'), 0);

  await cache.invalidateStore('s1');
  assert.equal(cache.epochFor('s1'), 1);
  assert.equal(cache.epochFor('s2'), 0, 'one merchant publishing does not clear another');
});

// ------------------------------------------------- through the handler

const themeFor = (section) =>
  new InMemoryThemeSource({
    'layout/theme.liquid': `<html><body>{{ content_for_layout }}</body></html>`,
    'templates/index.json': JSON.stringify({ sections: { a: { type: 'a' } }, order: ['a'] }),
    'sections/a.liquid': section,
  });

const storeWith = (theme) => ({
  storeId: 'store_1',
  theme,
  data: {
    shop: async () => ({ id: 's', name: 'S', handle: 's', domain: 'shop.test', currency: 'USD' }),
    settings: async () => ({}),
    productByHandle: async () => null, collectionByHandle: async () => null,
    pageByHandle: async () => null, blogByHandle: async () => null, articleByHandle: async () => null,
    variantsOfProduct: () => [], imagesOfProduct: () => [], productsOfCollection: () => [],
    productCountOfCollection: () => 0, image: () => null,
    redirects: async () => [], sitemapEntries: async () => [],
  },
});

const handlerFor = (section, options = {}) => {
  const store = storeWith(themeFor(section));
  const cache = options.pageCache ?? new MemoryPageCache();
  return {
    cache,
    handler: new StorefrontHandler(
      { resolve: async (h) => (h === 'shop.test' ? store : null) },
      { pageCache: cache, ...options },
    ),
  };
};

const get = (handler, over = {}) =>
  handler.handle({ host: 'shop.test', path: '/', query: '', method: 'GET', ...over });

test('the second request is served from the cache', async () => {
  const { handler, cache } = handlerFor(`<p>hello</p>`);

  const first = await get(handler);
  assert.equal(first.headers['x-cache'], 'miss');

  const second = await get(handler);
  assert.equal(second.headers['x-cache'], 'hit');
  assert.equal(second.body, first.body, 'byte for byte, or it is not a cache');
  assert.equal(cache.stats().hits > 0, true);
});

test('a hit gets a fresh nonce, and the policy still agrees with the markup', async () => {
  /**
   * The whole reason this design exists. A cache that replayed the body would
   * serve a nonce the header no longer matches, and the page would silently
   * stop executing — which looks exactly like a broken storefront.
   */
  const { handler } = handlerFor(`{% javascript %}console.log(1){% endjavascript %}`, {
    csp: { enabled: true },
  });

  const nonceOf = (response) => {
    const header = response.headers['content-security-policy-report-only'];
    const inHeader = /'nonce-([A-Za-z0-9_-]+)'/.exec(header)?.[1];
    const inBody = /<script nonce="([A-Za-z0-9_-]+)"/.exec(response.body)?.[1];
    assert.ok(inHeader, 'the policy names a nonce');
    assert.equal(inBody, inHeader, 'and it is the one in the markup');
    return inHeader;
  };

  const first = await get(handler);
  const second = await get(handler);

  assert.equal(second.headers['x-cache'], 'hit');
  assert.notEqual(nonceOf(second), nonceOf(first), 'a nonce reused is not a nonce');

  const third = await get(handler);
  assert.notEqual(nonceOf(third), nonceOf(second));
});

test('the stored body contains no nonce at all', async () => {
  const { handler, cache } = handlerFor(`{% javascript %}x{% endjavascript %}`, {
    csp: { enabled: true },
  });

  const response = await get(handler);
  const nonce = /<script nonce="([A-Za-z0-9_-]+)"/.exec(response.body)[1];

  const stored = await cache.get(fullCacheKey('store_1', 0, '/'));
  assert.ok(stored, 'it was cached');
  assert.ok(!stored.body.includes(nonce), 'the nonce that went to a browser is not kept');
  assert.ok(stored.noncePlaceholder, 'a marker stands in its place');
});

test('markup cannot borrow a nonce by guessing the placeholder', async () => {
  /**
   * The attack this design has to withstand.
   *
   * With a FIXED marker, an attacker stores `<script nonce="MARKER">` in a
   * product title, waits for the page to be cached, and the cache substitutes a
   * live nonce into their script on the way out — the policy defeated using our
   * own machinery. The marker is therefore random per entry and never sent to a
   * browser, so there is nothing to write down in advance.
   *
   * Two stores' entries are compared because a marker shared across entries
   * would be observable from one and usable against the other.
   */
  const evil = `<script nonce="df-nonce-guess">stolen()</script>`;
  const { handler, cache } = handlerFor(evil, { csp: { enabled: true } });

  await get(handler);
  const hit = await get(handler);

  assert.equal(hit.headers['x-cache'], 'hit');
  const real = /'nonce-([A-Za-z0-9_-]+)'/.exec(
    hit.headers['content-security-policy-report-only'],
  )[1];
  assert.ok(
    hit.body.includes(`nonce="df-nonce-guess"`),
    'the injected attribute is served exactly as written',
  );
  assert.ok(
    !hit.body.includes(`nonce="${real}"`),
    'and it never receives the live nonce',
  );

  const stored = await cache.get(fullCacheKey('store_1', 0, '/'));
  assert.notEqual(stored.noncePlaceholder, 'df-nonce-guess');
  assert.ok(stored.noncePlaceholder.length > 20, 'long enough not to be guessed');
});

test('a parameter the page never reads does not split the cache', async () => {
  /**
   * Otherwise every `?utm_source=` variant is a separate entry and a campaign
   * link means the cache is never warm for anyone.
   */
  const { handler } = handlerFor(`<p>static</p>`);

  await get(handler);
  const tagged = await get(handler, { query: 'utm_source=newsletter' });

  assert.equal(tagged.headers['x-cache'], 'hit');
});

test('a parameter the page DOES read gets its own entry', async () => {
  // The other half of the same rule: without it, one visitor's `?variant` is
  // served to the next.
  const { handler } = handlerFor(`<p>{{ request.params.variant }}</p>`);

  const first = await get(handler, { query: 'variant=red' });
  assert.equal(first.headers['x-cache'], 'miss');
  assert.ok(first.body.includes('red'));

  const other = await get(handler, { query: 'variant=blue' });
  assert.equal(other.headers['x-cache'], 'miss', 'a different value is a different page');
  assert.ok(other.body.includes('blue'));

  const again = await get(handler, { query: 'variant=red' });
  assert.equal(again.headers['x-cache'], 'hit');
  assert.ok(again.body.includes('red'), 'and it is the right one');
});

test('a 404 is not kept, and says why', async () => {
  const { handler } = handlerFor(`<p>x</p>`);
  const missing = await get(handler, { path: '/nothing-here' });

  assert.equal(missing.status, 404);
  assert.match(missing.headers['x-cache'], /^bypass: status 404/);

  const again = await get(handler, { path: '/nothing-here' });
  assert.match(again.headers['x-cache'], /^bypass/, 'still not cached');
});

test('a page rendered for a signed-in visitor is not kept', async () => {
  const { handler } = handlerFor(`<p>x</p>`);
  const response = await get(handler, { hasSession: true });
  assert.match(response.headers['x-cache'], /signed-in/);
});

test('the editor preview is never served from a cache', async () => {
  /**
   * A merchant dragging a section expects to see the result. A cached preview
   * makes the editor look broken and the merchant do it again.
   */
  const { handler } = handlerFor(`<p>x</p>`);

  await get(handler);
  const preview = await get(handler, { designMode: true });
  assert.notEqual(preview.headers['x-cache'], 'hit');
});

test('publishing a theme retires the pages that were rendered from it', async () => {
  const { handler, cache } = handlerFor(`<p>x</p>`);

  await get(handler);
  assert.equal((await get(handler)).headers['x-cache'], 'hit');

  await cache.invalidateStore('store_1');
  assert.equal(
    (await get(handler)).headers['x-cache'],
    'miss',
    'a merchant who publishes must see it at once',
  );
});

test('without a cache configured, nothing changes', async () => {
  // The cache is an addition, not a dependency — every existing test renders
  // without one.
  const store = storeWith(themeFor(`<p>x</p>`));
  const handler = new StorefrontHandler({ resolve: async () => store }, {});

  const response = await get(handler);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-cache'], undefined);
});

// ------------------------------------------------------------ the primitive

test('substitution replaces every occurrence, and nothing when absent', () => {
  assert.equal(substitute('a-X-b-X', 'X', 'Y'), 'a-Y-b-Y');
  assert.equal(substitute('abc', 'X', 'Y'), 'abc');
  assert.equal(substitute('abc', '', 'Y'), 'abc', 'an empty needle is not a match');
});

// ------------------------------------------------------- invalidation wiring

import { EventBus } from '../../../dist/core/event-bus/event-bus.js';
import { CATALOG_EVENTS } from '../../../dist/modules/catalog/events/index.js';
import { CONTENT_EVENTS } from '../../../dist/modules/content/events/index.js';
import { STOREFRONT_EVENTS } from '../../../dist/storefront/events/index.js';

/** The same list and the same loop the composition root registers. */
const subscribeInvalidation = (events, cache) => {
  const types = [
    STOREFRONT_EVENTS.themePublished,
    CATALOG_EVENTS.productCreated,
    CATALOG_EVENTS.productUpdated,
    CATALOG_EVENTS.productPublished,
    CATALOG_EVENTS.productArchived,
    CONTENT_EVENTS.pagePublished,
    CONTENT_EVENTS.pageUnpublished,
  ];
  for (const type of types) {
    events.subscribe('storefront', type, async (envelope) => {
      if (envelope.storeId) await cache.invalidateStore(envelope.storeId);
    });
  }
  return types;
};

test('every event that changes a storefront clears that store', async () => {
  /**
   * The events are taken from each module's exported constants rather than
   * written out as strings, so a rename breaks this test instead of quietly
   * leaving merchants looking at a theme they already replaced.
   */
  for (const type of subscribeInvalidation(new EventBus(), new MemoryPageCache())) {
    const events = new EventBus();
    const cache = new MemoryPageCache();
    subscribeInvalidation(events, cache);

    const before = cache.epochFor('store_1');
    await events.emit(type, {}, { storeId: 'store_1' });

    assert.equal(cache.epochFor('store_1'), before + 1, `${type} must retire cached pages`);
  }
});

test('an event for one store leaves the others alone', async () => {
  const events = new EventBus();
  const cache = new MemoryPageCache();
  subscribeInvalidation(events, cache);

  await events.emit(CATALOG_EVENTS.productUpdated, {}, { storeId: 'store_1' });
  assert.equal(cache.epochFor('store_2'), 0, 'one merchant editing must not cost every other');
});

test('a platform-scoped event clears nothing', async () => {
  // Clearing every store because an event carried no id would be a
  // self-inflicted stampede across the whole platform.
  const events = new EventBus();
  const cache = new MemoryPageCache();
  subscribeInvalidation(events, cache);

  await events.emit(CATALOG_EVENTS.productUpdated, {}, { storeId: null });
  assert.equal(cache.epochFor('store_1'), 0);
});

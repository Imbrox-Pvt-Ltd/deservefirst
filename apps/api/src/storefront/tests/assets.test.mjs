/**
 * Storefront · tests/assets.test.mjs
 * Serving a theme's own files.
 *
 * Nothing served them at all: the reference theme's homepage referenced 25
 * asset URLs and every one answered 404, so the storefront rendered correct
 * markup that loaded no stylesheet, no JavaScript and no images. "The
 * storefront works" had been measured in bytes of HTML, which is the one
 * measurement that cannot see this.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assetPathFor,
  assetResponseFor,
  ASSET_CACHE_CONTROL,
  VERSIONED_CACHE_CONTROL,
} from '../../../dist/storefront/domain/index.js';
import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';

// ------------------------------------------------------------- the URL

test('an assets URL becomes a theme path', () => {
  assert.equal(assetPathFor('/assets/theme.css'), 'assets/theme.css');
  assert.equal(assetPathFor('/assets/logo@2x.png'), 'assets/logo@2x.png');
});

test('only /assets is served, not the rest of the theme', () => {
  /**
   * `settings_data.json` describes a merchant's whole store setup and
   * `locales/` is nobody's business. Serving a directory because it exists is
   * how a config file ends up on the public internet.
   */
  for (const path of [
    '/config/settings_data.json',
    '/locales/en.default.json',
    '/layout/theme.liquid',
    '/templates/index.json',
    '/sections/header.liquid',
  ]) {
    assert.equal(assetPathFor(path), null, path);
  }
});

test('nothing nested and nothing empty', () => {
  assert.equal(assetPathFor('/assets/'), null);
  assert.equal(assetPathFor('/assets/sub/theme.css'), null);
  assert.equal(assetPathFor('/assets'), null);
  assert.equal(assetPathFor('/'), null);
});

test('a percent-encoded traversal is decoded before it is judged', () => {
  // Decoded here so `confinePath` sees what would actually be opened. The
  // result still has to survive that check, which is what refuses it.
  assert.equal(assetPathFor('/assets/%2e%2e%2fconfig%2fx.json'), null, 'a slash makes it nested');
});

// -------------------------------------------------------- the content type

test('the types a theme really serves are named exactly', () => {
  assert.match(assetResponseFor('assets/theme.css').contentType, /^text\/css/);
  assert.match(assetResponseFor('assets/theme.js').contentType, /^text\/javascript/);
  assert.equal(assetResponseFor('assets/logo.png').contentType, 'image/png');
  assert.equal(assetResponseFor('assets/font.woff2').contentType, 'font/woff2');
  assert.equal(assetResponseFor('assets/icon.svg').contentType, 'image/svg+xml');
});

test('an unknown type is sent as bytes nobody will interpret', () => {
  /**
   * The installer's allow-list is narrower than this map, but a theme that
   * reached the store some other way must not be able to serve HTML from the
   * merchant's own domain by naming a file `.htm`.
   */
  const decided = assetResponseFor('assets/page.htm');
  assert.equal(decided.contentType, 'application/octet-stream');
  assert.equal(decided.inline, false, 'and downloaded rather than rendered');
});

test('an unversioned URL revalidates; a versioned one is immutable', () => {
  /**
   * The distinction the whole scheme rests on. `asset_url` appends the theme's
   * version, so publishing a change produces different URLs and nothing can be
   * stale — which is what makes a year safe. A URL WITHOUT the version is the
   * same URL before and after a publish, so it gets minutes and revalidation.
   *
   * Getting this backwards would leave every visitor on an old stylesheet for a
   * year with no way to correct it.
   */
  assert.match(ASSET_CACHE_CONTROL, /must-revalidate/);
  assert.ok(!/immutable/.test(ASSET_CACHE_CONTROL));
  assert.match(VERSIONED_CACHE_CONTROL, /immutable/);

  assert.equal(assetResponseFor('assets/theme.css').cacheControl, ASSET_CACHE_CONTROL);
  assert.equal(assetResponseFor('assets/theme.css', true).cacheControl, VERSIONED_CACHE_CONTROL);
  // The type is unaffected by how long it may be kept.
  assert.equal(assetResponseFor('assets/x.htm', true).contentType, 'application/octet-stream');
});

// ------------------------------------------------------ through a response

const theme = new InMemoryThemeSource({
  'layout/theme.liquid': '<html><body>{{ content_for_layout }}</body></html>',
  'templates/index.json': JSON.stringify({ sections: {}, order: [] }),
  'assets/theme.css': '.a{color:red}',
  'config/settings_data.json': '{"secret":"a merchant’s whole setup"}',
});

const store = {
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
};

const handler = new StorefrontHandler({ resolve: async () => store }, {});
const get = (path) => handler.handle({ host: 'shop.test', path, query: '', method: 'GET' });

test('an asset is served with its type and cache headers', async () => {
  const response = await get('/assets/theme.css');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/css/);
  assert.equal(response.headers['cache-control'], ASSET_CACHE_CONTROL);
  assert.equal(String(response.body), '.a{color:red}');
});

test('a missing asset is a 404, not a rendered page', async () => {
  const response = await get('/assets/nope.css');
  assert.equal(response.status, 404);
});

test('a theme file outside assets is not reachable as an asset', async () => {
  // It exists in the theme and must still not be served.
  const response = await get('/config/settings_data.json');
  assert.notEqual(response.status, 200);
  assert.ok(!String(response.body).includes('a merchant’s whole setup'));
});

test('the security headers travel with an asset too', async () => {
  // `nosniff` is what makes a correct content-type worth sending.
  const response = await get('/assets/theme.css');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('a source that cannot read bytes serves nothing rather than something corrupt', async () => {
  /**
   * A PNG read through `read` is decoded as UTF-8, and every invalid byte
   * sequence becomes the same replacement character — the image that reaches
   * the browser is not the image on disk. Refusing is the honest failure.
   */
  const textOnly = {
    read: async () => 'x',
    exists: async () => true,
    list: async () => [],
    manifest: async () => new Set(),
  };

  const limited = new StorefrontHandler(
    { resolve: async () => ({ ...store, theme: textOnly }) },
    {},
  );

  const response = await limited.handle({
    host: 'shop.test', path: '/assets/theme.css', query: '', method: 'GET',
  });
  assert.equal(response.status, 404);
});

test('a versioned request is served immutably through the handler', async () => {
  const response = await handler.handle({
    host: 'shop.test', path: '/assets/theme.css', query: 'v=v_abc123', method: 'GET',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], VERSIONED_CACHE_CONTROL);
  assert.equal(String(response.body), '.a{color:red}');
});

test('the version is not part of the file it names', async () => {
  // A different version of the same URL still serves the file. The version
  // exists to change the URL, not to be looked up.
  const response = await handler.handle({
    host: 'shop.test', path: '/assets/theme.css', query: 'v=anything-at-all', method: 'GET',
  });
  assert.equal(response.status, 200);
});

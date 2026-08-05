/**
 * Storefront · tests/csp.test.mjs
 * A Content-Security-Policy a theme can actually satisfy.
 *
 * A storefront renders untrusted third-party code on a merchant's domain, so
 * this is the one page where a CSP is not belt-and-braces. The design in one
 * line: the platform's own inline code is nonced, and nothing else may execute
 * inline — a theme's `{% javascript %}` gets the nonce because the platform
 * emitted that tag, and a `<script>` inside a product title does not.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCsp, cspHeaderName, isUsableNonce } from '../../../dist/storefront/domain/index.js';
import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';

const policy = (over = {}) =>
  buildCsp({ nonce: 'abc123', assetHosts: ['https://shop.test'], ...over });

const directive = (csp, name) =>
  csp.split('; ').find((part) => part.startsWith(`${name} `))?.slice(name.length + 1) ?? '';

// ------------------------------------------------------------ the policy

test('inline script is allowed only by nonce', () => {
  const csp = policy();
  const scriptSrc = directive(csp, 'script-src');

  assert.ok(scriptSrc.includes("'nonce-abc123'"), scriptSrc);
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'unsafe-inline would defeat the whole policy');
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), scriptSrc);
});

test('strict-dynamic is present, because themes load their own bundles', () => {
  /**
   * A theme's nonced bootstrap loads further scripts, and the browser adds
   * those — we cannot nonce them. Without strict-dynamic every real theme
   * would break.
   */
  assert.ok(directive(policy(), 'script-src').includes("'strict-dynamic'"));
});

test('style ATTRIBUTES stay allowed while inline style blocks need the nonce', () => {
  /**
   * `style="..."` on an element cannot run script, and blocking it would break
   * every theme on the platform for no security gain. Inline `<style>` blocks
   * are a different question and take the nonce.
   */
  const csp = policy();
  assert.ok(directive(csp, 'style-src').includes("'nonce-abc123'"));
  assert.ok(!directive(csp, 'style-src').includes("'unsafe-inline'"));
  assert.equal(directive(csp, 'style-src-attr'), "'unsafe-inline'");
});

test('the directives that close the quiet gaps are present', () => {
  const csp = policy();
  // An injected <base> re-points every relative URL, which hijacks a form
  // without touching the form.
  assert.equal(directive(csp, 'base-uri'), "'self'");
  // And a submission cannot be redirected off-site.
  assert.equal(directive(csp, 'form-action'), "'self'");
  assert.equal(directive(csp, 'object-src'), "'none'");
});

test('the platform’s own video embeds are allowed', () => {
  // `external_video_tag` emits these, so a policy blocking them would break a
  // filter we ship.
  const frameSrc = directive(policy(), 'frame-src');
  assert.ok(frameSrc.includes('https://www.youtube.com'), frameSrc);
  assert.ok(frameSrc.includes('https://player.vimeo.com'), frameSrc);
});

test('framing is denied unless a host is named', () => {
  assert.equal(directive(policy(), 'frame-ancestors'), "'none'");
  assert.equal(
    directive(policy({ frameAncestors: ['https://admin.test'] }), 'frame-ancestors'),
    'https://admin.test',
    'the theme editor previews a store in an iframe',
  );
});

test('a merchant’s own analytics host can be allowed', () => {
  /**
   * Extensible on purpose. A policy a merchant cannot add their analytics tag
   * to is one they turn off wholesale, which is worse than a hole they chose.
   */
  const csp = policy({ allowedScriptHosts: ['https://plausible.example'] });
  assert.ok(directive(csp, 'script-src').includes('https://plausible.example'));
});

test('report-only and enforcing use different headers', () => {
  // A policy switched straight to enforcing takes existing storefronts down on
  // the day it ships.
  assert.equal(cspHeaderName(true), 'content-security-policy-report-only');
  assert.equal(cspHeaderName(false), 'content-security-policy');
});

test('a nonce must be unguessable to be a nonce at all', () => {
  assert.equal(isUsableNonce('short'), false);
  assert.equal(isUsableNonce('a'.repeat(22)), true);
  assert.equal(isUsableNonce('has spaces in it here!'), false);
});

// ------------------------------------------- the nonce reaching the markup

test('theme inline script and style carry the nonce', async () => {
  /**
   * The mechanism. Without this the policy is unsatisfiable and every theme's
   * own JavaScript stops running.
   */
  const engine = createThemeEngine(defaultContext({ nonce: 'n0nce-value' }));

  const script = await engine.render(`{% javascript %}console.log(1){% endjavascript %}`, {});
  assert.ok(script.includes('<script nonce="n0nce-value">'), script);

  const sheet = await engine.render(`{% stylesheet %}.a{color:red}{% endstylesheet %}`, {});
  assert.ok(sheet.includes('<style nonce="n0nce-value">'), sheet);

  const styled = await engine.render(`{% style %}.b{color:{{ c }}}{% endstyle %}`, { c: 'blue' });
  assert.ok(styled.includes('<style nonce="n0nce-value">'), styled);
  assert.ok(styled.includes('color:blue'), 'the body still renders as Liquid');
});

test('no nonce is stamped when no policy is being sent', async () => {
  // A `nonce=""` attribute on every tag would be noise, and a misleading
  // suggestion that a policy exists.
  const engine = createThemeEngine(defaultContext());
  const out = await engine.render(`{% javascript %}x{% endjavascript %}`, {});
  assert.equal(out, '<script>x</script>');
});

// ------------------------------------------------------ through a response

const theme = new InMemoryThemeSource({
  'layout/theme.liquid': `<html><body>{{ content_for_layout }}</body></html>`,
  'templates/index.json': JSON.stringify({ sections: { a: { type: 'a' } }, order: ['a'] }),
  'sections/a.liquid': `{% javascript %}console.log('hi'){% endjavascript %}`,
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

const handlerWith = (options) =>
  new StorefrontHandler({ resolve: async (h) => (h === 'shop.test' ? store : null) }, options);

test('the header nonce is the one in the page', async () => {
  /**
   * If these ever diverge the policy blocks the theme's own code, which looks
   * exactly like a broken storefront and is far harder to diagnose.
   */
  const response = await handlerWith({ csp: { enabled: true } }).handle({
    host: 'shop.test', path: '/', query: '', method: 'GET',
  });

  const header = response.headers['content-security-policy-report-only'];
  assert.ok(header, 'report-only by default');

  const inHeader = /'nonce-([A-Za-z0-9_-]+)'/.exec(header)?.[1];
  const inBody = /<script nonce="([A-Za-z0-9_-]+)"/.exec(response.body)?.[1];

  assert.ok(inHeader, header);
  assert.equal(inBody, inHeader, 'the page and the policy must agree');
});

test('two renders never share a nonce', async () => {
  // A nonce reused across visitors is a nonce an attacker can look up.
  const handler = handlerWith({ csp: { enabled: true } });
  const get = () => handler.handle({ host: 'shop.test', path: '/', query: '', method: 'GET' });

  const [a, b] = await Promise.all([get(), get()]);
  const nonceOf = (r) => /'nonce-([A-Za-z0-9_-]+)'/.exec(r.headers['content-security-policy-report-only'])[1];

  assert.notEqual(nonceOf(a), nonceOf(b));
});

test('enforcing sends the enforcing header', async () => {
  const response = await handlerWith({ csp: { enabled: true, enforce: true } }).handle({
    host: 'shop.test', path: '/', query: '', method: 'GET',
  });
  assert.ok(response.headers['content-security-policy']);
  assert.equal(response.headers['content-security-policy-report-only'], undefined);
});

test('a nonced page is cacheable, and reports the nonce for swapping out', async () => {
  /**
   * This used to assert the opposite. A nonced page was excluded from the cache
   * because every response carries a different nonce and a replayed body would
   * serve one the header no longer matches — the page would stop executing
   * entirely.
   *
   * The cache now swaps the nonce for a per-entry random marker on the way in
   * and substitutes a fresh one on the way out, so both properties hold at
   * once. `page-cache.test.mjs` is where that is proven; here we only check the
   * render hands over what the cache needs.
   */
  const nonced = await handlerWith({ csp: { enabled: true } }).handle({
    host: 'shop.test', path: '/', query: '', method: 'GET',
  });
  assert.equal(nonced.cacheKey, '/');
  assert.ok(nonced.nonce, 'the cache cannot swap out a nonce it is not told');
  assert.ok(nonced.body.includes(nonced.nonce), 'and it is the one in the markup');

  const plain = await handlerWith({}).handle({
    host: 'shop.test', path: '/', query: '', method: 'GET',
  });
  assert.equal(plain.cacheKey, '/');
  assert.equal(plain.nonce, null);
});

test('no policy is sent unless it is switched on', async () => {
  const response = await handlerWith({}).handle({
    host: 'shop.test', path: '/', query: '', method: 'GET',
  });
  assert.equal(response.headers['content-security-policy'], undefined);
  assert.equal(response.headers['content-security-policy-report-only'], undefined);
});

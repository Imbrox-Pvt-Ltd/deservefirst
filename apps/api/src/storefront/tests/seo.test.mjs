/**
 * Storefront · tests/seo.test.mjs
 * Redirects, sitemap, robots and JSON-LD.
 *
 * Each of these is a file or a header read by a machine, and each has a failure
 * mode where the output looks fine and is discarded wholesale: one unescaped
 * `&` invalidates a sitemap, one injected newline rewrites robots.txt, one
 * redirect cycle replaces a 404 with a browser error page.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  articleJsonLd,
  breadcrumbJsonLd,
  compileRedirects,
  DEFAULT_DISALLOW,
  escapeXml,
  isSafeRedirectTarget,
  jsonLdScript,
  MAX_URLS_PER_SITEMAP,
  normaliseRedirectPath,
  productJsonLd,
  redirectFor,
  renderJsonLd,
  renderRobots,
  renderSitemap,
  renderSitemapIndex,
  splitIntoSitemaps,
} from '../../../dist/storefront/domain/index.js';

// -------------------------------------------------------------- redirects

test('a renamed handle sends the old link to the new one', () => {
  const { table } = compileRedirects([{ from: '/products/old-name', to: '/products/new-name' }]);
  assert.equal(table.resolve('/products/old-name'), '/products/new-name');
  assert.equal(table.resolve('/products/untouched'), null);
});

test('paths match regardless of case and trailing slash', () => {
  const { table } = compileRedirects([{ from: '/Products/Old-Name/', to: '/products/new' }]);
  assert.equal(table.resolve('/products/old-name'), '/products/new');
  assert.equal(normaliseRedirectPath('/A/B/'), '/a/b');
});

test('a chain is resolved to its end, so the visitor makes one hop', () => {
  const { table } = compileRedirects([
    { from: '/a', to: '/b' },
    { from: '/b', to: '/c' },
    { from: '/c', to: '/d' },
  ]);
  assert.equal(table.resolve('/a'), '/d');
  assert.equal(table.resolve('/b'), '/d');
});

test('a loop is refused rather than served', () => {
  /**
   * A browser following `a → b → a` gives up and shows its own error page,
   * which is worse than the 404 the redirect was meant to replace — at least
   * the 404 is the theme's own page.
   */
  const { table, rejected } = compileRedirects([
    { from: '/a', to: '/b' },
    { from: '/b', to: '/a' },
  ]);

  assert.equal(table.resolve('/a'), null);
  assert.equal(table.resolve('/b'), null);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /loops/);
});

test('a self-redirect is refused', () => {
  const { rejected } = compileRedirects([{ from: '/a', to: '/a' }]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /cannot redirect to itself/);
});

test('an open redirect is refused', () => {
  /**
   * A target on another host turns the merchant's domain into a phishing
   * relay: a link that genuinely begins at their store and ends somewhere else,
   * carrying their reputation with it.
   */
  for (const target of [
    'https://evil.test/login',
    '//evil.test',
    'http://evil.test',
    'javascript:alert(1)',
    '/\\evil.test',
    '/path\nLocation: https://evil.test',
  ]) {
    assert.equal(isSafeRedirectTarget(target), false, `"${target}" should be refused`);
  }

  assert.equal(isSafeRedirectTarget('/products/hat'), true);
  assert.equal(isSafeRedirectTarget('/collections/all?sort_by=price'), true);
});

test('two rules for one path are refused rather than raced', () => {
  const { rejected } = compileRedirects([
    { from: '/a', to: '/b' },
    { from: '/a', to: '/c' },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /already redirects/);
});

test('a redirect keeps the campaign parameters it was given', () => {
  // Dropping them loses the attribution the merchant is paying for.
  const { table } = compileRedirects([{ from: '/old', to: '/new' }]);
  assert.equal(redirectFor(table, '/old', 'utm_source=newsletter'), '/new?utm_source=newsletter');
});

test('the target’s own parameters win over the incoming ones', () => {
  const { table } = compileRedirects([{ from: '/old', to: '/new?variant=2' }]);
  assert.equal(redirectFor(table, '/old', 'variant=1'), '/new?variant=2');
});

// ---------------------------------------------------------------- sitemap

test('an ampersand in a URL is escaped, or the whole file is discarded', () => {
  /**
   * Not cosmetic. One raw `&` makes the XML invalid, and a crawler drops every
   * URL in the document rather than the one that was wrong.
   */
  const xml = renderSitemap([{ loc: 'https://shop.test/collections/tea-&-coffee' }]);
  assert.ok(xml.includes('tea-&amp;-coffee'), xml);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'an unescaped ampersand survived');
});

test('all five XML entities are escaped', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('a sitemap declares the xhtml namespace only when it uses it', () => {
  const plain = renderSitemap([{ loc: 'https://shop.test/' }]);
  assert.ok(!plain.includes('xmlns:xhtml'), plain);

  const translated = renderSitemap([
    { loc: 'https://shop.test/', alternates: [{ hreflang: 'fr', href: 'https://shop.test/fr' }] },
  ]);
  assert.ok(translated.includes('xmlns:xhtml'), translated);
  assert.ok(translated.includes('hreflang="fr"'), translated);
});

test('entries are split so no file exceeds the protocol ceiling', () => {
  const entries = Array.from({ length: 120_000 }, (_e, i) => ({ loc: `https://shop.test/p/${i}` }));
  const chunks = splitIntoSitemaps(entries);

  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.ok(chunk.length <= MAX_URLS_PER_SITEMAP);
  assert.equal(chunks.flat().length, 120_000, 'splitting lost entries');
});

test('the index points at each file', () => {
  const xml = renderSitemapIndex([
    { loc: 'https://shop.test/sitemap_products_1.xml', lastmod: '2026-01-15T10:00:00Z' },
    { loc: 'https://shop.test/sitemap_pages_1.xml' },
  ]);
  assert.ok(xml.includes('<sitemapindex'), xml);
  assert.ok(xml.includes('sitemap_products_1.xml'), xml);
  // Date only: a timestamp that changes every build teaches a crawler to ignore
  // the field.
  assert.ok(xml.includes('<lastmod>2026-01-15</lastmod>'), xml);
});

test('priority is clamped to the range the protocol allows', () => {
  const xml = renderSitemap([{ loc: 'https://shop.test/', priority: 9 }]);
  assert.ok(xml.includes('<priority>1.0</priority>'), xml);
});

// ----------------------------------------------------------------- robots

test('the defaults keep crawlers away from thin and stateful URLs', () => {
  const txt = renderRobots({ sitemaps: ['https://shop.test/sitemap.xml'] });

  for (const path of ['/cart', '/account', '/search', '/password']) {
    assert.ok(txt.includes(`Disallow: ${path}`), `${path} should be disallowed:\n${txt}`);
  }
  // Faceted URLs are the expensive one: thousands of near-identical pages.
  assert.ok(txt.includes('filter.'), txt);
  assert.ok(txt.includes('Sitemap: https://shop.test/sitemap.xml'), txt);
});

test('a newline in a merchant value cannot inject a directive', () => {
  /**
   * robots.txt is line-oriented, so an injected "\nDisallow: /" would hide the
   * entire store from every crawler — a catastrophic, silent outage.
   */
  const txt = renderRobots({ additionalDisallow: ['/private\nDisallow: /'] });

  const disallowAll = txt.split('\n').filter((line) => line.trim() === 'Disallow: /');
  assert.equal(disallowAll.length, 0, `an injected rule survived:\n${txt}`);
});

test('a closed store disallows everything', () => {
  const txt = renderRobots({ closed: true });
  assert.ok(txt.includes('Disallow: /\n'), txt);
  // And nothing else, so a pre-launch page cannot be indexed.
  assert.ok(!txt.includes('/cart'), txt);
});

test('the sitemap line sits outside any user-agent group', () => {
  // Some crawlers miss it when it is nested inside one.
  const txt = renderRobots({
    rules: [{ userAgent: '*', disallow: ['/cart'] }],
    sitemaps: ['https://shop.test/sitemap.xml'],
  });
  const lines = txt.trim().split('\n');
  assert.equal(lines[lines.length - 1], 'Sitemap: https://shop.test/sitemap.xml');
});

test('the default list is not accidentally empty', () => {
  assert.ok(DEFAULT_DISALLOW.length >= 8, `${DEFAULT_DISALLOW.length} defaults`);
});

// -------------------------------------------------------------- JSON-LD

test('a product renders a valid Offer with an exact price', () => {
  const data = productJsonLd({
    title: 'Linen Shirt',
    url: 'https://shop.test/products/linen-shirt',
    priceMinor: 4499,
    currency: 'USD',
    available: true,
    sku: 'LS-1',
    vendor: 'Atelier',
  });

  assert.equal(data['@type'], 'Product');
  // 4499 / 100 is 44.989999999999995 in binary floating point.
  assert.equal(data.offers.price, '44.99');
  assert.equal(data.offers.availability, 'https://schema.org/InStock');
  assert.deepEqual(data.brand, { '@type': 'Brand', name: 'Atelier' });
});

test('a product with no price has no price field, rather than zero', () => {
  // A price of zero because the field was missing is a lie search engines
  // penalise the merchant for.
  const data = productJsonLd({ title: 'X', url: 'https://s.test/x', currency: 'USD' });
  assert.equal('price' in data.offers, false);
});

test('a description is stripped of markup and does not run words together', () => {
  const data = productJsonLd({
    title: 'X',
    url: 'https://s.test/x',
    currency: 'USD',
    description: '<p>First.</p><p>Second.</p>',
  });
  assert.equal(data.description, 'First. Second.');
});

test('JSON-LD cannot close the script tag it sits inside', () => {
  const script = jsonLdScript(
    productJsonLd({
      title: '</script><script>alert(1)</script>',
      url: 'https://s.test/x',
      currency: 'USD',
    }),
  );

  assert.ok(!script.slice(0, -9).includes('</script>'), script);
  // And it is still parseable, so a consumer reads it unchanged.
  const json = script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.equal(JSON.parse(json)['@type'], 'Product');
});

test('a breadcrumb list is contiguous and 1-based', () => {
  const data = breadcrumbJsonLd([
    { name: 'Home', url: 'https://s.test/' },
    { name: 'Shirts', url: 'https://s.test/collections/shirts' },
    { name: 'Linen', url: 'https://s.test/products/linen' },
  ]);

  // A gap invalidates the whole list rather than one entry.
  assert.deepEqual(data.itemListElement.map((entry) => entry.position), [1, 2, 3]);
});

test('an article headline is capped at the length engines read', () => {
  const data = articleJsonLd({ title: 'a'.repeat(300), url: 'https://s.test/a' });
  assert.equal(data.headline.length, 110);
});

test('renderJsonLd output survives a round trip', () => {
  const json = renderJsonLd({ '@type': 'Product', name: 'Tea & Coffee <br>' });
  assert.equal(JSON.parse(json).name, 'Tea & Coffee <br>');
});

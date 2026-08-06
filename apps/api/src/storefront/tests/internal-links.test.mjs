/**
 * Storefront · tests/internal-links.test.mjs
 * Links a theme stored using another platform's URL scheme.
 *
 * When a merchant picks "the about page" in a theme editor, the theme stores an
 * opaque reference rather than a path, so the link survives a rename. Rendered
 * as-is that reaches the browser as an unknown scheme and the link does
 * nothing — not a broken link a visitor recognises, a button that simply does
 * not respond.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveInternalLink,
  resolveLinkSettings,
} from '../../../dist/storefront/domain/index.js';

// The scheme is data, from `config/theme-compat.json`, never a literal here.
const SCHEMES = ['examplestore'];
const resolve = (value) => resolveInternalLink(value, SCHEMES);

test('a reference becomes the path this store serves', () => {
  assert.equal(resolve('examplestore://collections/all'), '/collections/all');
  assert.equal(resolve('examplestore://pages/about'), '/pages/about');
  assert.equal(resolve('examplestore://products/linen-shirt'), '/products/linen-shirt');
  assert.equal(resolve('examplestore://blogs/news/a-post'), '/blogs/news/a-post');
});

test('a bare reference is the storefront root', () => {
  // What a theme stores for "the home page". An empty string would render
  // `href=""`, which reloads the current page rather than going home.
  assert.equal(resolve('examplestore://'), '/');
});

test('the scheme is matched without regard to case, and trimmed', () => {
  assert.equal(resolve('  ExampleStore://pages/about  '), '/pages/about');
});

test('anything that could leave the site is refused, not rewritten', () => {
  /**
   * The reference is merchant-supplied through an editor. A `//` or a backslash
   * after the scheme produces a protocol-relative URL that sends a customer to
   * another host — so those are left alone, visibly broken rather than quietly
   * hostile.
   */
  for (const hostile of [
    'examplestore:////evil.example.com',
    'examplestore:///evil.example.com',
    'examplestore://\\\\evil.example.com',
    'examplestore://https://evil.example.com',
  ]) {
    assert.equal(resolve(hostile), null, hostile);
  }
});

test('an ordinary value is left exactly as it was', () => {
  for (const value of [
    '/collections/all',
    'https://example.com/x',
    'mailto:a@b.test',
    '',
    '#anchor',
    null,
    42,
  ]) {
    assert.equal(resolve(value), null, JSON.stringify(value));
  }
});

test('settings are rewritten by VALUE, not by key name', () => {
  /**
   * The opposite of how fonts and colours are resolved, and deliberately so: a
   * font handle is indistinguishable from a product code without its key, while
   * `<scheme>://` is unambiguous. Matching keys would mean listing every name a
   * theme might give a link field, and missing one silently.
   */
  const resolved = resolveLinkSettings(
    {
      banner_link: 'examplestore://pages/about',
      some_unexpected_name: 'examplestore://collections/all',
      heading: 'Our story',
      external: 'https://example.com',
    },
    SCHEMES,
  );

  assert.equal(resolved.banner_link, '/pages/about');
  assert.equal(resolved.some_unexpected_name, '/collections/all', 'whatever the key is called');
  assert.equal(resolved.heading, 'Our story');
  assert.equal(resolved.external, 'https://example.com');
});

test('no configured schemes means nothing is rewritten', () => {
  const settings = { link: 'examplestore://pages/about' };
  assert.deepEqual(resolveLinkSettings(settings, []), settings);
});

test('the shipped compatibility table declares at least one scheme', async () => {
  /**
   * The table is data and this asserts it is wired, not what is in it — naming
   * a competitor here would put the string back into shipped code, which is the
   * whole reason it lives in JSON.
   */
  const { resolveCompatMap } = await import('../../../dist/storefront/domain/index.js');
  const raw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../config/theme-compat.json', import.meta.url),
      'utf8',
    ),
  );

  assert.ok(resolveCompatMap(raw, 'deservefirst').linkSchemes.length > 0);
});

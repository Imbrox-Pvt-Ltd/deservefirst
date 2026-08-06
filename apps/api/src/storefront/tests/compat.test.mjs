/**
 * Storefront · tests/compat.test.mjs
 * Porting a theme written for another platform.
 *
 * The map itself is data and deliberately small, so these test the machinery
 * rather than the entries: that a foreign name is found only where it is
 * actually a filter, that porting changes exactly what checking reported, and
 * that compatibility mode is off unless asked for.
 *
 * The last one matters most. Our vocabulary is the real one; aliases are a
 * courtesy that has to be requested, or the foreign names quietly become part
 * of the platform and the porting story stops being true.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import {
  findForeignNames,
  portTemplate,
  resolveCompatMap,
} from '../../../dist/storefront/domain/index.js';

/** A stand-in map, so these tests do not depend on what the real table holds. */
const map = resolveCompatMap(
  { filters: { other_asset_url: '{slug}_asset_url' }, objects: {}, tags: {} },
  'deservefirst',
);

test('the slug is substituted into every replacement', () => {
  assert.equal(map.filters.other_asset_url, 'deservefirst_asset_url');
});

test('a foreign filter is found where it is used as a filter', () => {
  const findings = findForeignNames('x.liquid', `{{ 'a.js' | other_asset_url }}`, map);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].found, 'other_asset_url');
  assert.equal(findings[0].replacement, 'deservefirst_asset_url');
  assert.equal(findings[0].kind, 'filter');
});

test('the same word outside a Liquid tag is left alone', () => {
  /**
   * A theme's own JavaScript may mention the name in a comment, a URL or an
   * analytics key. Rewriting those would break working code to fix nothing.
   */
  const source = `<script>// see other_asset_url docs</script>`;
  assert.deepEqual(findForeignNames('x.liquid', source, map), []);
  assert.equal(portTemplate(source, map).changes, 0);
});

test('the same word inside a tag but not as a filter is left alone', () => {
  const source = `{% assign note = 'other_asset_url' %}`;
  assert.deepEqual(findForeignNames('x.liquid', source, map), []);
});

test('porting changes exactly what checking reported', () => {
  const source = `{{ 'a.js' | other_asset_url }} and {{ 'b.js' | other_asset_url }}`;
  const found = findForeignNames('x.liquid', source, map);
  const ported = portTemplate(source, map);

  assert.equal(ported.changes, 2);
  assert.ok(found.length > 0);
  assert.ok(!ported.source.includes('other_asset_url'), ported.source);
  assert.equal(
    ported.source,
    `{{ 'a.js' | deservefirst_asset_url }} and {{ 'b.js' | deservefirst_asset_url }}`,
  );
});

test('porting a theme that is already ported changes nothing', () => {
  const source = `{{ 'a.js' | deservefirst_asset_url }}`;
  assert.equal(portTemplate(source, map).changes, 0);
});

test('an unreadable or empty map is an empty map, not a crash', () => {
  assert.deepEqual(resolveCompatMap(null, 'x'), {
    filters: {},
    objects: {},
    tags: {},
    // Empty rather than absent: a caller iterating the schemes of a map it
    // could not read should find none, not crash on undefined.
    linkSchemes: [],
  });
  assert.deepEqual(resolveCompatMap({ filters: 'nope' }, 'x').filters, {});
});

test('link schemes are read, and anything that is not a scheme is dropped', () => {
  // The value decides which URL schemes a theme's internal links may use, so a
  // malformed entry must not become one.
  const map = resolveCompatMap({ linkSchemes: ['examplestore', '', 42, null, 'other'] }, 'x');
  assert.deepEqual(map.linkSchemes, ['examplestore', 'other']);

  assert.deepEqual(resolveCompatMap({ linkSchemes: 'nope' }, 'x').linkSchemes, []);
});

// ------------------------------------------------ runtime compatibility

test('foreign names are NOT registered by default', async () => {
  const engine = createThemeEngine(defaultContext());
  assert.equal(engine.hasFilter('shopify_asset_url'), false);
  assert.equal(engine.hasFilter('deservefirst_asset_url'), true);
});

test('compatibility mode registers them, and they behave identically', async () => {
  const context = defaultContext();
  const strict = createThemeEngine(context);
  const compatible = createThemeEngine(context, { compatibility: true });

  assert.equal(compatible.hasFilter('deservefirst_asset_url'), true);

  const ours = await strict.render(`{{ 'common.js' | deservefirst_asset_url }}`, {});
  // An alias delegates to the filter it points at, so it cannot drift from it.
  for (const foreign of Object.keys(
    resolveCompatMap(
      JSON.parse(
        (await import('node:fs')).readFileSync(
          new URL('../../../src/storefront/config/theme-compat.json', import.meta.url),
          'utf8',
        ),
      ),
      'deservefirst',
    ).filters,
  )) {
    assert.equal(compatible.hasFilter(foreign), true, `${foreign} should be registered`);
    const aliased = await compatible.render(`{{ 'common.js' | ${foreign} }}`, {});
    assert.equal(aliased, ours, `${foreign} must render exactly as its target does`);
  }
});

test('a theme using a foreign name fails loudly without compatibility mode', async () => {
  const engine = createThemeEngine(defaultContext());
  await assert.rejects(
    () => engine.render(`{{ 'a.js' | shopify_asset_url }}`, {}),
    /undefined filter/,
    'without compatibility mode this must fail rather than silently pass the value through',
  );
});

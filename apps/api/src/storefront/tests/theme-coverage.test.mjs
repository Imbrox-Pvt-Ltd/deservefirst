/**
 * Storefront · tests/theme-coverage.test.mjs
 * Will this theme run here, and if not, what is missing?
 *
 * The question a developer porting a theme actually has. A documentation
 * snapshot cannot answer it: stale the moment the other platform ships
 * anything, and silent about the theme in their hand.
 *
 * Most of these tests are about NOISE, because that is what decides whether a
 * checker gets used. The first version of this reported 200 gaps against a
 * theme that renders correctly — every one of them the theme's own variables,
 * Liquid's own keywords, or a string literal misread as a filter.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareCoverage, knownObjects } from '../../../dist/storefront/domain/index.js';
import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

const surface = {
  filters: new Set(['money', 'image_url']),
  tags: new Set(['render', 'schema']),
  objects: new Set(['product', 'settings']),
};
const at = (name, file = 'sections/a.liquid', line = 1) => ({ name, file, line });

test('what the platform lacks is reported, with somewhere to look', () => {
  const report = compareCoverage(
    { filters: [at('money'), at('sizes')], tags: [at('render')], objects: [at('product')] },
    surface,
  );

  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].name, 'sizes');
  assert.equal(report.gaps[0].kind, 'filter');
  assert.equal(report.gaps[0].firstSeen.file, 'sections/a.liquid');
});

test('gaps are ordered by how many files depend on them', () => {
  /**
   * A filter twelve files use breaks twelve templates; one used once breaks a
   * corner. The order is the order to fix them in.
   */
  const report = compareCoverage(
    {
      filters: [at('rare', 'a.liquid'), at('common', 'a.liquid'), at('common', 'b.liquid')],
      tags: [], objects: [],
    },
    surface,
  );

  assert.deepEqual(report.gaps.map((gap) => gap.name), ['common', 'rare']);
  assert.equal(report.gaps[0].files, 2);
});

test('the same name in one file many times is one thing to fix', () => {
  // Counting occurrences would rank a snippet's forty uses above something ten
  // separate templates need.
  const report = compareCoverage(
    { filters: [at('x', 'a.liquid', 1), at('x', 'a.liquid', 9)], tags: [], objects: [] },
    surface,
  );
  assert.equal(report.gaps[0].files, 1);
  assert.equal(report.gaps[0].firstSeen.line, 1, 'and points at the first one');
});

test('a name the theme defined itself is not a platform gap', () => {
  /**
   * Every `{% assign %}` and `{% for %}` binding. Without this the report is
   * three quarters the theme's own variables, which is what makes a checker
   * ignorable.
   */
  const report = compareCoverage(
    { filters: [], tags: [], objects: [at('my_thing'), at('unknown_thing')] },
    surface,
    new Set(['my_thing']),
  );

  assert.deepEqual(report.gaps.map((gap) => gap.name), ['unknown_thing']);
});

test('Liquid’s own control flow is never a missing feature', () => {
  // `endif` and `else` are grammar, not something a platform implements. They
  // put nine entries at the TOP of the first report, ordered by reach.
  const report = compareCoverage(
    {
      filters: [],
      tags: [at('endif'), at('else'), at('when'), at('endcapture'), at('genuinely_missing')],
      objects: [],
    },
    surface,
  );

  assert.deepEqual(report.gaps.map((gap) => gap.name), ['genuinely_missing']);
});

test('a name read in one snippet is reported but not asserted', () => {
  /**
   * `{% render 'share-button', align: 'left' %}` puts `align` in that snippet's
   * scope. A snippet documenting the parameter in a comment has nothing to bind
   * it, and nothing in the theme can distinguish that from a platform object it
   * wanted and did not get. Reported and marked, rather than hidden or claimed.
   */
  const report = compareCoverage(
    { filters: [], tags: [], objects: [at('align', 'snippets/share-button.liquid', 24)] },
    surface,
  );

  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].certain, false);
});

test('the same name outside snippets, or across files, IS certain', () => {
  const inSection = compareCoverage(
    { filters: [], tags: [], objects: [at('recommendations', 'sections/product.liquid')] },
    surface,
  );
  assert.equal(inSection.gaps[0].certain, true);

  const twoFiles = compareCoverage(
    {
      filters: [], tags: [],
      objects: [at('recommendations', 'snippets/a.liquid'), at('recommendations', 'snippets/b.liquid')],
    },
    surface,
  );
  assert.equal(twoFiles.gaps[0].certain, true);
});

test('a missing filter or tag is always certain', () => {
  // The engine either registers one or it does not, and no theme can introduce
  // one — so there is nothing to be unsure about.
  const report = compareCoverage(
    { filters: [at('nope', 'snippets/x.liquid')], tags: [], objects: [] },
    surface,
  );
  assert.equal(report.gaps[0].certain, true);
});

// ------------------------------------------------- extraction, via the parser

const usageOf = (source) => createThemeEngine(defaultContext()).analyse('t.liquid', source);

test('a string literal containing pipes is not a filter', () => {
  // The exact false positive that made the first attempt worthless.
  const usage = usageOf(`{{ content | replace: '|||sizes|||', x }}`);
  assert.deepEqual(usage.filters.map((f) => f.name), ['replace']);
});

test('a translation key is not an object', () => {
  const usage = usageOf(`{{ 'general.meta.page' | t: page: 2 }}`);
  assert.deepEqual(usage.filters.map((f) => f.name), ['t']);
  assert.deepEqual(usage.objects.map((o) => o.name), []);
});

test('everything inside a block is seen', () => {
  /**
   * The large majority of a real theme. liquidjs stores an `if`'s bodies as
   * `{ value, templates }` pairs rather than templates, so walking `branches`
   * directly finds nothing and reports a clean file.
   */
  const usage = usageOf('{% if a %}{{ product.title | upcase }}{% else %}{{ z | money }}{% endif %}');
  assert.deepEqual(usage.filters.map((f) => f.name).sort(), ['money', 'upcase']);
  assert.ok(usage.objects.some((o) => o.name === 'product'));
});

test('a `{% liquid %}` block is many statements, not one tag', () => {
  // Read as a single tag, its arguments are `assign x = …` — so the name bound
  // is "assign" and `x` looks like a missing object.
  const usage = usageOf('{%- liquid\n  assign total = product.price | money\n  echo total\n-%}');
  assert.ok(usage.bound.includes('total'));
  assert.deepEqual(usage.filters.map((f) => f.name), ['money']);
});

test('a snippet’s parameters are bound by whoever renders it', () => {
  const usage = usageOf(`{% render 'card', align: 'left', product: product %}`);
  assert.deepEqual(usage.bound.sort(), ['align', 'product']);
});

test('a tag naming a file is not an expression', () => {
  // `{% layout none %}` — read as one, `none` becomes a missing object.
  assert.deepEqual(usageOf('{% layout none %}').objects.map((o) => o.name), []);
  assert.deepEqual(usageOf(`{% section 'header' %}`).objects.map((o) => o.name), []);
});

test('the root of a path is the question, not the whole path', () => {
  // `product.featured_image.src` asks one thing: does `product` exist.
  const usage = usageOf('{{ product.featured_image.src }}');
  assert.deepEqual(usage.objects.map((o) => o.name), ['product']);
});

test('a template that does not parse contributes nothing rather than throwing', () => {
  // The linter reports Liquid errors. A coverage report that died on the first
  // malformed file would say less than one that covered the other four hundred.
  const usage = usageOf('{% if unclosed %}{{ x ');
  assert.ok(Array.isArray(usage.filters));
});

test('the platform’s claimed objects include what every render provides', () => {
  const known = new Set(knownObjects());
  for (const name of ['product', 'collection', 'settings', 'section', 'request', 'routes']) {
    assert.ok(known.has(name), name);
  }
});

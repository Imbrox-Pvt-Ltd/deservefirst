/**
 * Storefront · tests/filter-coverage.test.mjs
 * Does a real theme's filter usage resolve against what we provide?
 *
 * This is the test that would have caught the whole problem. `strictFilters` is
 * on, so one unimplemented filter fails the render of every page that reaches
 * it — and a theme uses ninety-two distinct filters across four hundred files,
 * which is not a thing anyone audits by reading.
 *
 * It reports the gap rather than asserting a number, so adding a theme or a
 * filter does not require editing a constant. Skipped when the theme is absent:
 * it is a licensed commercial theme, deliberately not in the repository.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

const THEME = join(process.cwd(), 'theme', 'broadcast');
const present = existsSync(THEME);
const skip = !present && 'theme/broadcast is not present';

const engine = createThemeEngine(defaultContext());

/** Every filter name used inside a Liquid delimiter, with a usage count. */
function filtersUsedIn(root) {
  const used = new Map();

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.liquid')) continue;

      const source = readFileSync(path, 'utf8');
      // Only inside `{{ }}` / `{% %}`, so a `||` in embedded JavaScript is not
      // mistaken for a filter — it was, on the first attempt at this.
      for (const tag of source.matchAll(/\{[{%]([\s\S]*?)[%}]\}/g)) {
        for (const match of tag[1].matchAll(/(?<!\|)\|\s*([a-z_][a-z0-9_]*)/gi)) {
          const name = match[1];
          used.set(name, (used.get(name) ?? 0) + 1);
        }
      }
    }
  };

  walk(root);
  return used;
}

test('every filter the reference theme uses is available', { skip }, () => {
  const used = filtersUsedIn(THEME);
  assert.ok(used.size > 50, `expected a real theme to use many filters, found ${used.size}`);

  const missing = [...used.entries()]
    .filter(([name]) => !engine.hasFilter(name))
    .sort((a, b) => b[1] - a[1]);

  assert.deepEqual(
    missing,
    [],
    `${missing.length} filter(s) the theme uses do not exist, so every page reaching one ` +
      `fails to render:\n  ${missing.map(([name, count]) => `${name} (${count} uses)`).join('\n  ')}`,
  );
});

test('values a filter puts in an ATTRIBUTE are escaped', async () => {
  /**
   * The `returnsHtml` contract, checked rather than trusted.
   *
   * Scoped to attributes on purpose. Liquid does not escape output — neither
   * here nor in the reference product — so a theme writing `{{ product.title }}`
   * emits it raw, and that is the language rather than a defect in any filter.
   * What IS ours is the markup these filters construct: a value we place inside
   * a tag we built must not be able to end the attribute and start another.
   */
  const hostile = '"><img src=x onerror=alert(1)>';

  const cases = [
    [`{{ 'https://x.test/a.jpg' | image_tag: alt: v }}`, { v: hostile }],
    [`{{ v | placeholder_svg_tag: 'c' }}`, { v: hostile }],
    [`{{ v | payment_type_svg_tag }}`, { v: hostile }],
    [`{{ v | asset_url | stylesheet_tag }}`, { v: hostile }],
    [`{{ v | image_url | image_tag }}`, { v: hostile }],
    [`{{ address | format_address }}`, { address: { address1: hostile, country_code: 'US' } }],
    [`{{ errors | default_errors }}`, { errors: { messages: { form: hostile } } }],
  ];

  for (const [source, scope] of cases) {
    const out = await engine.render(source, scope);
    /**
     * The test is escape, not absence.
     *
     * `alt="&quot;&gt;&lt;img onerror=...&gt;"` still contains the word
     * "onerror" and is completely inert — asserting the word is missing failed
     * on correct output. What must not survive is the breakout: the raw value
     * appearing verbatim, able to close the attribute and open a tag.
     */
    assert.ok(
      !out.includes(hostile),
      `${source} reflected the value unescaped, so it can break out of the attribute:\n  ${out}`,
    );
  }
});

test('escaping preserves the value rather than discarding it', async () => {
  /**
   * The companion to the breakout check, kept separate because the two filters
   * defend differently and one assertion cannot describe both.
   *
   * `image_tag` escapes and keeps the text; `payment_type_svg_tag` strips to a
   * safe character set, because its value becomes a path segment rather than
   * text. Both are correct; only the first can be checked for preservation.
   */
  const out = await engine.render(`{{ 'https://x.test/a.jpg' | image_tag: alt: v }}`, {
    v: 'Rose & "Thorn" <hat>',
  });
  assert.ok(out.includes('&amp;'), out);
  assert.ok(out.includes('&quot;'), out);
  assert.ok(out.includes('&lt;hat&gt;'), out);
  // The words survive; only the syntax is neutralised.
  assert.ok(out.includes('Rose'), out);
  assert.ok(out.includes('Thorn'), out);
});

test('link_to escapes its href but passes its label through', async () => {
  /**
   * Pinned because it looks like a bug and is not.
   *
   * The reference theme writes `{{ '&larr;' | link_to: url }}`; escaping the
   * label would render the literal text "&larr;" where an arrow belongs. The
   * href has no such requirement, so it is refused when it is dangerous.
   */
  assert.equal(
    await engine.render(`{{ '&larr;' | link_to: '/page/2' }}`, {}),
    '<a href="/page/2">&larr;</a>',
  );
  assert.equal(
    await engine.render(`{{ 'Go' | link_to: 'javascript:alert(1)' }}`, {}),
    '<a href="">Go</a>',
  );
});

test('the theme names no setting type we do not support', { skip }, async () => {
  const { INPUT_SETTING_TYPES, SIDEBAR_SETTING_TYPES } = await import(
    '../../../dist/storefront/domain/index.js'
  );
  const known = new Set([...INPUT_SETTING_TYPES, ...SIDEBAR_SETTING_TYPES]);

  const settingsSchema = join(THEME, 'config', 'settings_schema.json');
  if (!existsSync(settingsSchema)) return;

  const found = new Set();
  const collect = (node) => {
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (node && typeof node === 'object') {
      if (typeof node.type === 'string' && node.id !== undefined) found.add(node.type);
      Object.values(node).forEach(collect);
    }
  };
  collect(JSON.parse(readFileSync(settingsSchema, 'utf8')));

  const unsupported = [...found].filter((type) => !known.has(type));
  assert.deepEqual(unsupported, [], `unsupported setting types: ${unsupported.join(', ')}`);
});

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

/**
 * The whole documented storefront filter surface, by category.
 *
 * Broadcast uses 92 of these; an arbitrary theme may use any. Testing against
 * one theme proves that theme renders — testing against the canonical list is
 * what makes "bring your theme" a claim we can actually stand behind.
 */
const CANONICAL_FILTERS = {
  array: ['compact','concat','find','find_index','first','has','join','last','map','reject','reverse','size','sort','sort_natural','sum','uniq','where'],
  cart: ['item_count_for_variant','line_items_for'],
  collection: ['highlight_active_tag','link_to_type','link_to_vendor','sort_by','url_for_type','url_for_vendor','within'],
  color: ['brightness_difference','color_brightness','color_contrast','color_darken','color_desaturate','color_difference','color_extract','color_lighten','color_mix','color_modify','color_saturate','color_to_hex','color_to_hsl','color_to_rgb','hex_to_rgba'],
  customer: ['avatar','customer_login_link','customer_logout_link','customer_register_link','login_button'],
  default: ['default','default_errors','default_pagination'],
  font: ['font_face','font_modify','font_url'],
  format: ['date','json','structured_data','weight_with_unit'],
  html: ['class_list','highlight','placeholder_svg_tag','preload_tag','script_tag','stylesheet_tag','time_tag'],
  hosted: ['asset_img_url','asset_url','file_img_url','file_url','global_asset_url','image_url','img_url','payment_type_img_url'],
  localization: ['currency_selector','format_address','t','translate'],
  math: ['abs','at_least','at_most','ceil','divided_by','floor','minus','modulo','plus','round','times'],
  media: ['external_video_tag','external_video_url','image_tag','img_tag','media_tag','model_viewer_tag','video_tag'],
  metafield: ['metafield_tag','metafield_text'],
  money: ['money','money_with_currency','money_without_currency','money_without_trailing_zeros'],
  payment: ['payment_button','payment_terms','payment_type_svg_tag'],
  string: ['append','base64_decode','base64_encode','base64_url_safe_decode','base64_url_safe_encode','camelcase','capitalize','downcase','escape','escape_once','handle','handleize','hmac_sha1','hmac_sha256','lstrip','md5','newline_to_br','pluralize','prepend','remove','remove_first','remove_last','replace','replace_first','replace_last','rstrip','sha1','sha256','slice','split','strip','strip_html','strip_newlines','truncate','truncatewords','upcase','url_decode','url_encode','url_escape','url_param_escape'],
  tag: ['link_to_add_tag','link_to_remove_tag','link_to_tag'],
  utility: ['link_to'],
};

test('the whole canonical storefront filter surface exists', () => {
  const missing = {};
  for (const [category, names] of Object.entries(CANONICAL_FILTERS)) {
    const gap = [...new Set(names)].filter((name) => !engine.hasFilter(name));
    if (gap.length) missing[category] = gap;
  }

  assert.deepEqual(
    missing,
    {},
    'a theme using any of these renders a broken page — strictFilters makes a ' +
      `missing filter fail the whole template:\n${JSON.stringify(missing, null, 2)}`,
  );
});

test('every canonical filter actually runs rather than merely existing', async () => {
  /**
   * Registration is not implementation. A filter that throws on its own name
   * would pass the check above and fail every page that used it, so each one is
   * invoked once with a plausible input.
   *
   * The assertion is only that it does not throw; what it returns is the
   * business of the tests that cover it specifically.
   */
  const names = [...new Set(Object.values(CANONICAL_FILTERS).flat())];
  const failures = [];

  for (const name of names) {
    for (const source of [`{{ value | ${name} }}`, `{{ value | ${name}: 'x' }}`]) {
      try {
        await engine.render(source, { value: 'a' });
      } catch (error) {
        const message = error.message.split('\n')[0];
        /**
         * An arity complaint is the engine enforcing the filter's own contract,
         * not a broken filter. `{{ x | append }}` with no argument is invalid
         * Liquid and should be refused — this test called every filter with and
         * without one, so it provokes exactly that.
         */
        if (/expect \d+ argument/.test(message)) continue;
        failures.push(`${name}: ${message}`);
      }
    }
  }

  assert.deepEqual(failures, [], `filters that threw:\n  ${failures.join('\n  ')}`);
});

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

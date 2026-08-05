/**
 * Storefront · tests/conformance.test.mjs
 * The schema model, checked against a real commercial Shopify theme.
 *
 * "Does a real theme load unmodified?" is a better test of this than anything
 * invented here, and it has already earned its place twice — it caught two
 * rules I had written from assumption rather than from evidence:
 *
 *   1. Every block needs a name. It does not: a block whose type resolves to a
 *      `blocks/*.liquid` file takes its name from there, and a leading
 *      underscore marks it private so the merchant never picks it by name.
 *   2. `tag` is one of a few element names. It can also be `null`, meaning
 *      render with no wrapper — every theme block in the reference theme relies
 *      on that, because a block that wraps itself in an unasked-for `div`
 *      breaks the grid it was dropped into.
 *
 * The theme is a licensed commercial product and is NOT in this repository —
 * `theme/` is ignored. So these skip when it is absent rather than failing, and
 * a clone without it still passes CI. A skipped conformance test is honest; a
 * failing one that everybody learns to ignore is not.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { assertPlacementCoherent, assertSchemaValid } from '../../../dist/storefront/domain/index.js';

const THEME = 'theme/broadcast';
const present = existsSync(join(THEME, 'sections'));

const SCHEMA = /{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/;

function inventory() {
  const dir = join(THEME, 'blocks');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return { blockFiles: new Set(files.map((file) => basename(file, '.liquid'))) };
}

function schemasIn(folder) {
  const dir = join(THEME, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.liquid'))
    .map((file) => [file, SCHEMA.exec(readFileSync(join(dir, file), 'utf8'))])
    .filter(([, match]) => match !== null)
    .map(([file, match]) => [file, JSON.parse(match[1])]);
}

test('every section in a real theme loads', { skip: !present && 'theme/broadcast is not present' }, () => {
  const known = inventory();
  const sections = schemasIn('sections');

  assert.ok(sections.length > 50, `expected a substantial theme, found ${sections.length} sections`);
  for (const [file, schema] of sections) {
    assert.doesNotThrow(() => {
      assertSchemaValid(file, schema, known);
      assertPlacementCoherent(file, schema);
    }, `${file} should load`);
  }
});

test('every theme block in a real theme loads', { skip: !present && 'theme/broadcast is not present' }, () => {
  const known = inventory();
  const blocks = schemasIn('blocks');

  assert.ok(blocks.length > 0, 'expected Online Store 2.0 theme blocks');
  for (const [file, schema] of blocks) {
    assert.doesNotThrow(() => assertSchemaValid(file, schema, known), `${file} should load`);
  }
});

test('a real theme’s JSON templates have the shape we expect', { skip: !present && 'theme/broadcast is not present' }, () => {
  const dir = join(THEME, 'templates');
  const templates = readdirSync(dir).filter((file) => file.endsWith('.json'));

  assert.ok(templates.length > 10, `expected JSON templates, found ${templates.length}`);
  for (const file of templates) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    // `sections` is a map keyed by instance id; `order` is what decides what
    // renders and in what sequence. A template with sections and no order
    // renders nothing, which is the failure this pins.
    assert.ok(parsed.sections, `${file} needs sections`);
    assert.ok(Array.isArray(parsed.order), `${file} needs an order array`);
    for (const id of parsed.order) {
      assert.ok(parsed.sections[id], `${file} orders "${id}", which it does not define`);
    }
  }
});

test('the setting types a real theme uses are all supported', { skip: !present && 'theme/broadcast is not present' }, async () => {
  const { INPUT_SETTING_TYPES, SIDEBAR_SETTING_TYPES } = await import(
    '../../../dist/storefront/domain/index.js'
  );
  const supported = new Set([...INPUT_SETTING_TYPES, ...SIDEBAR_SETTING_TYPES]);

  const used = new Set();
  for (const folder of ['sections', 'blocks']) {
    for (const [, schema] of schemasIn(folder)) {
      for (const setting of schema.settings ?? []) used.add(setting.type);
      for (const block of schema.blocks ?? []) {
        for (const setting of block.settings ?? []) used.add(setting.type);
      }
    }
  }

  const missing = [...used].filter((type) => !supported.has(type));
  assert.deepEqual(missing, [], `these setting types are used by a real theme and unsupported: ${missing}`);
});

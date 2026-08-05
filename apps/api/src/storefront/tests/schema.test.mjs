/**
 * Storefront · tests/schema.test.mjs
 * The theme schema, checked against shapes a real theme actually uses.
 *
 * The failures pinned here are the ones that produce a broken EDITOR rather
 * than a broken page — a preset adding a block that does not exist, two
 * settings sharing an id, a range no slider can land on. Those are invisible
 * until a merchant tries to use the section, which is the worst time.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INPUT_SETTING_TYPES,
  MAX_BLOCKS_PER_SECTION,
  SIDEBAR_SETTING_TYPES,
  allowedOnTemplate,
  assertNoDuplicateIds,
  assertPlacementCoherent,
  assertSchemaValid,
  assertSettingValid,
  blockCapacity,
  defaultValueFor,
  isInputSetting,
} from '../../../dist/storefront/domain/index.js';

/** Shaped like a real theme's rich-text section, including a preset. */
const richTextSection = {
  name: 'Rich text',
  tag: 'section',
  class: 'section',
  settings: [
    { type: 'select', id: 'content_width', label: 'Width', default: 'medium',
      options: [
        { value: 'narrow', label: 'Narrow' },
        { value: 'medium', label: 'Medium' },
        { value: 'wide', label: 'Wide' },
      ] },
    { type: 'range', id: 'padding_top', label: 'Top padding', min: 0, max: 100, step: 4, default: 36, unit: 'px' },
    { type: 'header', content: 'Colours' },
    { type: 'color_scheme', id: 'color_scheme', label: 'Colour scheme', default: 'scheme-1' },
  ],
  blocks: [
    { type: 'heading', name: 'Heading', limit: 1, settings: [{ type: 'inline_richtext', id: 'heading', label: 'Heading' }] },
    { type: 'text', name: 'Text', settings: [{ type: 'richtext', id: 'text', label: 'Text' }] },
    { type: 'button', name: 'Button', limit: 2, settings: [
      { type: 'text', id: 'button_label', label: 'Label' },
      { type: 'url', id: 'button_link', label: 'Link' },
    ] },
    { type: '@app' },
  ],
  max_blocks: 6,
  presets: [
    { name: 'Rich text', blocks: [{ type: 'heading' }, { type: 'text' }, { type: 'button' }] },
  ],
};

test('a real theme’s section schema passes', () => {
  assert.doesNotThrow(() => assertSchemaValid('rich-text', richTextSection));
});

test('every input type the reference product has is supported', () => {
  // Supporting eighteen of twenty-two does not mean "mostly compatible" — it
  // means every theme using the other four fails, and the author cannot tell
  // which four without reading our source.
  for (const type of ['image_picker', 'color_scheme', 'font_picker', 'link_list', 'liquid',
                      'inline_richtext', 'text_alignment', 'video_url', 'product_list',
                      'metaobject', 'collection_list', 'html', 'article']) {
    assert.ok(INPUT_SETTING_TYPES.includes(type), `${type} must be supported`);
  }
  assert.deepEqual([...SIDEBAR_SETTING_TYPES], ['header', 'paragraph']);
});

test('a setting that holds a value needs an addressable id', () => {
  assert.throws(() => assertSettingValid('s', { type: 'text', label: 'A' }), /needs an id/);
  // The id becomes `settings.<id>` in Liquid, so one with a dot is unreachable
  // from the theme that declared it.
  assert.throws(
    () => assertSettingValid('s', { type: 'text', id: 'my.setting' }),
    /not usable as settings\.<id>/,
  );
  assert.throws(() => assertSettingValid('s', { type: 'colour', id: 'c' }), /is not a setting type/);
});

test('a header holds nothing, so it must not have an id', () => {
  assert.doesNotThrow(() => assertSettingValid('s', { type: 'header', content: 'Colours' }));
  // Otherwise it lands in settings_data.json as a value nobody set.
  assert.throws(
    () => assertSettingValid('s', { type: 'header', id: 'colours', content: 'C' }),
    /holds no value/,
  );
  assert.equal(isInputSetting({ type: 'header' }), false);
  assert.equal(isInputSetting({ type: 'text', id: 't' }), true);
});

test('a range no slider can land on is refused', () => {
  assert.doesNotThrow(() =>
    assertSettingValid('s', { type: 'range', id: 'r', min: 0, max: 100, step: 4 }),
  );
  // 0–10000 by 1 is a control nobody can hit a value on; the author meant
  // `number`, and the message says so.
  assert.throws(
    () => assertSettingValid('s', { type: 'range', id: 'r', min: 0, max: 10000, step: 1 }),
    /Use "number" instead/,
  );
  assert.throws(
    () => assertSettingValid('s', { type: 'range', id: 'r', min: 10, max: 5 }),
    /must be greater than min/,
  );
});

test('select options must be distinct, and a default must be one of them', () => {
  const base = { type: 'select', id: 's', options: [{ value: 'a', label: 'A' }] };

  assert.throws(
    () => assertSettingValid('s', { ...base, options: [
      { value: 'a', label: 'A' }, { value: 'a', label: 'Also A' },
    ] }),
    /two options share the value "a"/,
  );
  assert.throws(() => assertSettingValid('s', { ...base, default: 'z' }), /not one of the options/);
  assert.throws(() => assertSettingValid('s', { type: 'select', id: 's' }), /needs options/);
});

test('two settings sharing an id is refused, because the later one silently wins', () => {
  assert.throws(
    () => assertNoDuplicateIds('s', [
      { type: 'text', id: 'title' },
      { type: 'richtext', id: 'title' },
    ]),
    /two settings share the id "title"/,
  );
});

test('a preset cannot add a block the section does not define', () => {
  // The merchant adds the section, the preset tries to create a block with no
  // definition, and they get a section missing part of itself with nothing
  // saying why.
  assert.throws(
    () => assertSchemaValid('rich-text', {
      ...richTextSection,
      presets: [{ name: 'Broken', blocks: [{ type: 'carousel' }] }],
    }),
    /adds a "carousel" block, which this section does not define/,
  );

  // A section accepting @theme accepts anything the theme defines.
  assert.doesNotThrow(() =>
    assertSchemaValid('flexible', {
      name: 'Flexible',
      blocks: [{ type: '@theme' }],
      presets: [{ name: 'Any', blocks: [{ type: 'whatever' }] }],
    }),
  );
});

test('a section cannot wrap itself in an arbitrary tag', () => {
  // The wrapper is emitted by us, so it is ours to constrain.
  assert.throws(
    () => assertSchemaValid('x', { name: 'X', tag: 'script' }),
    /is not a wrapper tag a section may use/,
  );
});

test('block limits and max_blocks combine into a real capacity', () => {
  const existing = [{ type: 'heading' }, { type: 'button' }];

  // `heading` has limit 1 and one exists.
  assert.equal(blockCapacity(richTextSection, 'heading', existing), 0);
  // `button` has limit 2, one exists, and 4 slots remain overall.
  assert.equal(blockCapacity(richTextSection, 'button', existing), 1);
  // `text` is unlimited per type, so the section's own ceiling decides.
  assert.equal(blockCapacity(richTextSection, 'text', existing), 4);
});

test('max_blocks is bounded, and cannot be set on a section with no blocks', () => {
  assert.throws(
    () => assertSchemaValid('x', { name: 'X', blocks: [{ type: 'a', name: 'A' }], max_blocks: 500 }),
    new RegExp(`the editor allows ${MAX_BLOCKS_PER_SECTION}`),
  );
  // Almost always a section that lost its blocks in an edit and kept the limit.
  assert.throws(
    () => assertSchemaValid('x', { name: 'X', max_blocks: 3 }),
    /max_blocks is set but the section defines no blocks/,
  );
});

test('enabled_on and disabled_on cannot both be declared', () => {
  assert.throws(
    () => assertPlacementCoherent('x', {
      name: 'X',
      enabled_on: { templates: ['index'] },
      disabled_on: { templates: ['product'] },
    }),
    /not both/,
  );

  assert.equal(allowedOnTemplate({ name: 'X', enabled_on: { templates: ['index'] } }, 'index'), true);
  assert.equal(allowedOnTemplate({ name: 'X', enabled_on: { templates: ['index'] } }, 'product'), false);
  assert.equal(allowedOnTemplate({ name: 'X', disabled_on: { templates: ['product'] } }, 'product'), false);
  assert.equal(allowedOnTemplate({ name: 'X' }, 'anything'), true);
});

test('a setting with no default gets one that renders as nothing', () => {
  // A theme renders `settings.foo` directly; `undefined` becomes the string
  // "undefined" in a template, whereas an empty value renders as nothing.
  assert.equal(defaultValueFor({ type: 'text', id: 't' }), '');
  assert.equal(defaultValueFor({ type: 'checkbox', id: 'c' }), false);
  assert.equal(defaultValueFor({ type: 'range', id: 'r', min: 10, max: 20 }), 10);
  assert.deepEqual(defaultValueFor({ type: 'product_list', id: 'p' }), []);
  assert.equal(
    defaultValueFor({ type: 'select', id: 's', options: [{ value: 'a', label: 'A' }] }),
    'a',
  );
  assert.equal(defaultValueFor({ type: 'text', id: 't', default: 'given' }), 'given');
});

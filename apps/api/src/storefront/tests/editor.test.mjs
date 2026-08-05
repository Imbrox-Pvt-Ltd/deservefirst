/**
 * Storefront · tests/editor.test.mjs
 * What a merchant's edit does to a template.
 *
 * Reordering is the easy part and barely tested here. What is tested is what
 * goes wrong quietly: two people editing at once, a value the theme cannot
 * render, a section added where its own schema says it does not belong. Each of
 * those, unguarded, produces a broken storefront rather than an error in the
 * editor where somebody could fix it.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyEdit,
  EditorError,
  serialiseTemplate,
  templateNameOf,
} from '../../../dist/storefront/domain/index.js';

/** A theme with two sections: one general, one product-only with blocks. */
const schemas = {
  schemaFor: (type) =>
    ({
      'image-banner': {
        name: 'Image banner',
        settings: [
          { type: 'text', id: 'heading', default: 'Welcome' },
          { type: 'range', id: 'height', min: 200, max: 600, step: 50, default: 400 },
          { type: 'checkbox', id: 'full_width', default: false },
          { type: 'select', id: 'align', options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
          ], default: 'left' },
        ],
        presets: [{ name: 'Default', settings: { heading: 'Hello' } }],
      },
      'main-product': {
        name: 'Product information',
        // Only ever one, and only on the product template.
        limit: 1,
        enabled_on: { templates: ['product'] },
        blocks: [
          { type: 'title', name: 'Title' },
          { type: 'price', name: 'Price', limit: 1 },
        ],
        max_blocks: 4,
        settings: [{ type: 'checkbox', id: 'show_vendor', default: true }],
        presets: [{ name: 'Default', blocks: [{ type: 'title' }] }],
      },
    })[type],
};

let counter = 0;
const newId = () => `id${++counter}`;

const documentWith = (sections, path = 'templates/index.json') => ({
  templatePath: path,
  sections,
  version: 1,
});

const banner = {
  id: 'image-banner',
  type: 'image-banner',
  settings: { heading: 'Hi', height: 400, full_width: false, align: 'left' },
  blocks: [],
  disabled: false,
};

const edit = (doc, action, version = doc.version) =>
  applyEdit(doc, { action, expectedVersion: version }, schemas, newId);

// ------------------------------------------------------ concurrent editing

test('an edit against a stale version is refused, not merged', () => {
  /**
   * A merchant and their designer both have the editor open. Last-write-wins
   * discards one of them silently, and neither is told — so somebody redoes an
   * afternoon of work without knowing why it vanished.
   */
  const doc = documentWith([banner]);

  // The designer saves first; the stored document is now version 2.
  const saved = edit(doc, { kind: 'move_section', sectionId: 'image-banner', toIndex: 0 });
  assert.equal(saved.version, 2);

  // The merchant's editor is still showing version 1 and submits against it.
  assert.throws(
    () => edit(saved, { kind: 'remove_section', sectionId: 'image-banner' }, 1),
    (error) => error instanceof EditorError && error.code === 'conflict',
  );

  // Submitting against what is actually stored succeeds.
  assert.equal(
    edit(saved, { kind: 'remove_section', sectionId: 'image-banner' }, 2).sections.length,
    0,
  );
});

test('a rejected edit leaves the document untouched', () => {
  const doc = documentWith([banner]);
  const before = JSON.stringify(doc);
  assert.throws(() => edit(doc, { kind: 'remove_section', sectionId: 'nope' }));
  assert.equal(JSON.stringify(doc), before, 'the document was mutated by a failed edit');
});

test('applying an edit never mutates the input', () => {
  // The caller holds the previous version — that is what makes undo possible
  // without re-fetching.
  const doc = documentWith([banner]);
  const after = edit(doc, { kind: 'toggle_section', sectionId: 'image-banner', disabled: true });
  assert.equal(doc.sections[0].disabled, false);
  assert.equal(after.sections[0].disabled, true);
});

// ------------------------------------------------------------- the theme's rules

test('a section cannot be added where its schema forbids it', () => {
  /**
   * `enabled_on: { templates: ['product'] }` means the section reads `product`
   * and renders nothing anywhere else. Allowing it on the homepage produces an
   * empty band a merchant cannot diagnose.
   */
  const doc = documentWith([], 'templates/index.json');
  assert.throws(
    () => edit(doc, { kind: 'add_section', sectionType: 'main-product' }),
    (error) => error.code === 'not_allowed_here' && /index template/.test(error.message),
  );

  // And it is allowed where it belongs, so the rule is not merely refusing.
  const onProduct = documentWith([], 'templates/product.json');
  assert.equal(edit(onProduct, { kind: 'add_section', sectionType: 'main-product' }).sections.length, 1);
});

test('a suffixed template is still the page type it belongs to', () => {
  assert.equal(templateNameOf('templates/product.wholesale.json'), 'product');
  const doc = documentWith([], 'templates/product.wholesale.json');
  assert.equal(edit(doc, { kind: 'add_section', sectionType: 'main-product' }).sections.length, 1);
});

test('a section limit is enforced', () => {
  let doc = documentWith([], 'templates/product.json');
  doc = edit(doc, { kind: 'add_section', sectionType: 'main-product' });
  assert.throws(
    () => edit(doc, { kind: 'add_section', sectionType: 'main-product' }),
    (error) => error.code === 'limit_reached',
  );
});

test('a block limit is enforced', () => {
  let doc = documentWith([], 'templates/product.json');
  doc = edit(doc, { kind: 'add_section', sectionType: 'main-product' });
  const id = doc.sections[0].id;

  doc = edit(doc, { kind: 'add_block', sectionId: id, blockType: 'price' });
  assert.throws(
    () => edit(doc, { kind: 'add_block', sectionId: id, blockType: 'price' }),
    (error) => error.code === 'limit_reached',
  );
});

// ------------------------------------------------------------ typed settings

test('a value outside a range is refused', () => {
  const doc = documentWith([banner]);
  assert.throws(
    () => edit(doc, { kind: 'update_settings', sectionId: 'image-banner', settings: { height: 900 } }),
    (error) => error.code === 'invalid' && /between 200 and 600/.test(error.message),
  );
});

test('a value off the step is refused', () => {
  /**
   * A slider can only produce values on its steps, so one that is not came from
   * somewhere else — and the theme's CSS may well assume the increments.
   */
  const doc = documentWith([banner]);
  assert.throws(
    () => edit(doc, { kind: 'update_settings', sectionId: 'image-banner', settings: { height: 425 } }),
    (error) => /steps of 50/.test(error.message),
  );
  // On a step, it is accepted.
  assert.equal(
    edit(doc, { kind: 'update_settings', sectionId: 'image-banner', settings: { height: 450 } })
      .sections[0].settings.height,
    450,
  );
});

test('a select only takes one of its options', () => {
  const doc = documentWith([banner]);
  assert.throws(
    () => edit(doc, { kind: 'update_settings', sectionId: 'image-banner', settings: { align: 'diagonal' } }),
    (error) => /must be one of: left, center/.test(error.message),
  );
});

test('a checkbox takes a boolean, not a string', () => {
  const doc = documentWith([banner]);
  assert.throws(
    () => edit(doc, { kind: 'update_settings', sectionId: 'image-banner', settings: { full_width: 'yes' } }),
    (error) => /true or false/.test(error.message),
  );
});

test('a setting the schema does not declare is dropped, not stored', () => {
  // It cannot be rendered, so keeping it would grow the file with values
  // nothing reads.
  const doc = documentWith([banner]);
  const after = edit(doc, {
    kind: 'update_settings',
    sectionId: 'image-banner',
    settings: { heading: 'New', invented_by_an_api_caller: 'x' },
  });
  assert.equal(after.sections[0].settings.heading, 'New');
  assert.equal('invented_by_an_api_caller' in after.sections[0].settings, false);
});

// --------------------------------------------------------------- behaviour

test('a new section starts from its preset with defaults filled in', () => {
  const doc = documentWith([]);
  const after = edit(doc, { kind: 'add_section', sectionType: 'image-banner' });
  const section = after.sections[0];

  assert.equal(section.settings.heading, 'Hello', 'the preset value');
  assert.equal(section.settings.height, 400, 'the schema default');
  assert.equal(section.settings.align, 'left');
});

test('a second section of one type gets a readable, unique id', () => {
  // The id ends up in the JSON a developer reads and in the editor's URLs.
  let doc = documentWith([]);
  doc = edit(doc, { kind: 'add_section', sectionType: 'image-banner' });
  doc = edit(doc, { kind: 'add_section', sectionType: 'image-banner' });

  assert.deepEqual(doc.sections.map((s) => s.id), ['image-banner', 'image-banner-2']);
});

test('disabling keeps the settings, so switching back on restores them', () => {
  /**
   * Removing and re-adding would give the merchant the preset instead, quietly
   * discarding what they had configured.
   */
  let doc = documentWith([{ ...banner, settings: { ...banner.settings, heading: 'Mine' } }]);
  doc = edit(doc, { kind: 'toggle_section', sectionId: 'image-banner', disabled: true });
  doc = edit(doc, { kind: 'toggle_section', sectionId: 'image-banner', disabled: false });
  assert.equal(doc.sections[0].settings.heading, 'Mine');
});

test('dragging past the end puts it last rather than failing', () => {
  const second = { ...banner, id: 'other', type: 'image-banner' };
  let doc = documentWith([banner, second]);
  doc = edit(doc, { kind: 'move_section', sectionId: 'image-banner', toIndex: 99 });
  assert.deepEqual(doc.sections.map((s) => s.id), ['other', 'image-banner']);
});

// -------------------------------------------------------------- the file

test('order is always written explicitly', () => {
  /**
   * JSON key order is not guaranteed by the spec and any tool that rewrites the
   * file may change it. A template whose sections silently reordered on save
   * would be a bug nobody could reproduce.
   */
  const doc = documentWith([banner, { ...banner, id: 'second' }]);
  const json = JSON.parse(serialiseTemplate(doc));
  assert.deepEqual(json.order, ['image-banner', 'second']);
});

test('blocks round-trip with their order', () => {
  let doc = documentWith([], 'templates/product.json');
  doc = edit(doc, { kind: 'add_section', sectionType: 'main-product' });
  const id = doc.sections[0].id;
  doc = edit(doc, { kind: 'add_block', sectionId: id, blockType: 'price' });

  const json = JSON.parse(serialiseTemplate(doc));
  const written = json.sections[id];
  assert.equal(written.block_order.length, 2);
  assert.deepEqual(
    written.block_order.map((blockId) => written.blocks[blockId].type),
    ['title', 'price'],
  );
});

test('a disabled section is marked in the file', () => {
  let doc = documentWith([banner]);
  doc = edit(doc, { kind: 'toggle_section', sectionId: 'image-banner', disabled: true });
  assert.equal(JSON.parse(serialiseTemplate(doc)).sections['image-banner'].disabled, true);
});

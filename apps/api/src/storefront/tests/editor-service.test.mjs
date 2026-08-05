/**
 * Storefront · tests/editor-service.test.mjs
 * Reading a theme into the editor, and previewing unsaved work.
 *
 * The test that matters most is the last one: an edit must change the PREVIEW
 * and not the live store. Everything else in the editor is a convenience; that
 * property is the reason a merchant can touch their storefront at all.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EditorService,
  InMemoryDraftStore,
  PageRenderer,
  ThemeSchemas,
  withDrafts,
} from '../../../dist/storefront/application/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';
import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

/** A theme with three sections: two configurable, one deliberately broken. */
const theme = new InMemoryThemeSource({
  'layout/theme.liquid': `<html><body>{{ content_for_layout }}</body></html>`,

  'templates/index.json': JSON.stringify({
    sections: { hero: { type: 'hero', settings: { heading: 'Live heading' } } },
    order: ['hero'],
  }),

  'sections/hero.liquid':
    `<h1>{{ section.settings.heading }}</h1>\n` +
    `{% schema %}
    {
      "name": "Hero",
      "settings": [{ "type": "text", "id": "heading", "default": "Hello" }],
      "presets": [{ "name": "Default" }]
    }
    {% endschema %}`,

  'sections/promo.liquid':
    `<aside>{{ section.settings.label }}</aside>\n` +
    `{% schema %}
    {
      "name": "Promo bar",
      "settings": [{ "type": "text", "id": "label", "default": "Free delivery" }],
      "presets": [{ "name": "Default" }]
    }
    {% endschema %}`,

  // Placed by the template, never offered in the picker: no preset.
  'sections/footer.liquid':
    `<footer>x</footer>\n{% schema %}{ "name": "Footer" }{% endschema %}`,

  // Malformed JSON — must not stop the editor opening.
  'sections/broken.liquid': `x\n{% schema %}{ "name": "Broken", }{% endschema %}`,
});

let counter = 0;
const service = () => new EditorService(new InMemoryDraftStore(), () => `b${++counter}`);
const session = { themeId: 'thm_1', source: theme };

// ------------------------------------------------------- reading the theme

test('schemas are read out of the section files', async () => {
  const schemas = await ThemeSchemas.read(theme);
  assert.equal(schemas.schemaFor('hero')?.name, 'Hero');
  assert.equal(schemas.schemaFor('promo')?.name, 'Promo bar');
  assert.equal(schemas.schemaFor('nonexistent'), undefined);
});

test('one malformed schema does not stop the editor opening', async () => {
  /**
   * The difference between "fix this section" and "the editor is broken". A
   * theme with one bad file must still be editable.
   */
  const schemas = await ThemeSchemas.read(theme);
  assert.equal(schemas.schemaFor('hero')?.name, 'Hero', 'the good ones still loaded');

  const unusable = schemas.unusable();
  assert.equal(unusable.length, 1);
  assert.equal(unusable[0].type, 'broken');
  assert.ok(unusable[0].reason.length > 0, 'it should say why');
});

test('only sections with a preset are offered in the picker', async () => {
  /**
   * A preset is the theme author's own signal that a merchant adds this. The
   * footer has none — it is placed by the template — so offering it would put a
   * piece in the picker that renders nothing on its own.
   */
  const schemas = await ThemeSchemas.read(theme);
  const offered = schemas.addable('index').map((entry) => entry.type);

  assert.deepEqual(offered.sort(), ['hero', 'promo']);
  assert.ok(!offered.includes('footer'), 'footer has no preset');
});

test('the picker respects where a section says it belongs', async () => {
  const restricted = new InMemoryThemeSource({
    'sections/only-product.liquid':
      `x\n{% schema %}
      { "name": "Product only", "enabled_on": { "templates": ["product"] },
        "presets": [{ "name": "Default" }] }
      {% endschema %}`,
  });
  const schemas = await ThemeSchemas.read(restricted);

  assert.equal(schemas.addable('index').length, 0);
  assert.equal(schemas.addable('product').length, 1);
});

// ------------------------------------------------------------- the draft

test('opening reads the theme file when there is no draft', async () => {
  const editor = service();
  const document = await editor.open(session, 'templates/index.json');

  assert.equal(document.sections.length, 1);
  assert.equal(document.sections[0].settings.heading, 'Live heading');
});

test('reopening shows the draft, not the file', async () => {
  /**
   * An editor that discards unsaved work on refresh is one people learn not to
   * trust.
   */
  const editor = service();
  const schemas = await ThemeSchemas.read(theme);

  const edited = await editor.edit(session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Draft heading' } },
    expectedVersion: 1,
  }, schemas);
  assert.equal(edited.sections[0].settings.heading, 'Draft heading');

  const reopened = await editor.open(session, 'templates/index.json');
  assert.equal(reopened.settings, undefined);
  assert.equal(reopened.sections[0].settings.heading, 'Draft heading');
});

test('discarding a draft returns to the published file', async () => {
  const editor = service();
  const schemas = await ThemeSchemas.read(theme);

  await editor.edit(session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Draft' } },
    expectedVersion: 1,
  }, schemas);
  await editor.discard(session, 'templates/index.json');

  const reopened = await editor.open(session, 'templates/index.json');
  assert.equal(reopened.sections[0].settings.heading, 'Live heading');
});

test('pending files are the JSON a save would write', async () => {
  const editor = service();
  const schemas = await ThemeSchemas.read(theme);

  await editor.edit(session, 'templates/index.json', {
    action: { kind: 'add_section', sectionType: 'promo' },
    expectedVersion: 1,
  }, schemas);

  const files = await editor.pendingFiles(session);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'templates/index.json');

  const written = JSON.parse(files[0].contents);
  assert.deepEqual(written.order, ['hero', 'promo']);
  assert.equal(written.sections.promo.settings.label, 'Free delivery', 'the schema default');
});

// ============================================== the property that matters

test('an edit changes the preview and NOT the live store', async () => {
  /**
   * The whole reason the editor is safe to use. A merchant dragging sections
   * around is working on a draft; customers keep seeing the published theme
   * until they publish. If this ever stops being true, every keystroke is live.
   */
  const editor = service();
  const schemas = await ThemeSchemas.read(theme);

  const draft = await editor.edit(session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Unsaved heading' } },
    expectedVersion: 1,
  }, schemas);

  // What a customer gets: the theme, untouched.
  const live = new PageRenderer(createThemeEngine(defaultContext(), { source: theme }), theme);
  const livePage = await live.render({ pageType: 'index', scope: {} });

  // What the merchant's preview gets: the same theme with the draft overlaid.
  const files = await editor.pendingFiles(session);
  const previewSource = withDrafts(theme, new Map(files.map((f) => [f.path, f.contents])));
  const preview = new PageRenderer(
    createThemeEngine(defaultContext(), { source: previewSource }),
    previewSource,
  );
  const previewPage = await preview.render({ pageType: 'index', scope: {} });

  assert.ok(livePage.html.includes('Live heading'), livePage.html);
  assert.ok(!livePage.html.includes('Unsaved heading'), 'the draft leaked to customers');

  assert.ok(previewPage.html.includes('Unsaved heading'), previewPage.html);
  assert.ok(!previewPage.html.includes('Live heading'), previewPage.html);

  assert.equal(draft.version, 2);
});

test('the preview overlays only the templates that changed', async () => {
  // Wrapping rather than copying: a preview that duplicated the theme would
  // drift from it the moment anything else changed.
  const previewSource = withDrafts(theme, new Map([['templates/index.json', '{"sections":{},"order":[]}']]));

  assert.notEqual(await previewSource.read('sections/hero.liquid'), null, 'other files still resolve');
  assert.equal(JSON.parse(await previewSource.read('templates/index.json')).order.length, 0);
});

test('a draft for a template the theme lacks can still be previewed', async () => {
  // Otherwise a merchant cannot preview a template they just created.
  const previewSource = withDrafts(
    theme,
    new Map([['templates/page.json', '{"sections":{},"order":[]}']]),
  );
  const manifest = await previewSource.manifest();
  assert.ok(manifest.has('templates/page.json'));
  assert.ok(manifest.has('templates/index.json'), 'the real files are still there');
});

// ==================================== placement, learned from a real theme

test('a group-only section is not offered for a template', async () => {
  /**
   * The bug a real theme caught. Every one of the reference theme's 55
   * placement declarations uses `groups`, none uses `templates` — and checking
   * only `templates` fell through to "no restriction", offering nine header and
   * footer sections in the page picker where they render wrongly.
   *
   * `enabled_on` is a whitelist: naming groups and not templates means
   * "not on a template".
   */
  const source = new InMemoryThemeSource({
    'sections/announcement.liquid':
      `x\n{% schema %}
      { "name": "Announcement", "enabled_on": { "groups": ["header"] },
        "presets": [{ "name": "Default" }] }
      {% endschema %}`,
    'sections/hero.liquid':
      `x\n{% schema %}
      { "name": "Hero", "presets": [{ "name": "Default" }] }
      {% endschema %}`,
  });
  const schemas = await ThemeSchemas.read(source);

  assert.deepEqual(schemas.addable('index').map((s) => s.type), ['hero']);
  assert.deepEqual(schemas.addableToGroup('header').map((s) => s.type), ['announcement', 'hero']);
});

test('disabled_on groups does not restrict templates', async () => {
  /**
   * The asymmetry is the point: `disabled_on` is a blacklist, so saying nothing
   * about templates means templates are fine. Treating it like `enabled_on`
   * would have removed 46 sections from every picker.
   */
  const source = new InMemoryThemeSource({
    'sections/promo.liquid':
      `x\n{% schema %}
      { "name": "Promo", "disabled_on": { "groups": ["header", "footer"] },
        "presets": [{ "name": "Default" }] }
      {% endschema %}`,
  });
  const schemas = await ThemeSchemas.read(source);

  assert.equal(schemas.addable('index').length, 1, 'still addable to a template');
  assert.equal(schemas.addableToGroup('header').length, 0, 'but not to the header');
  assert.equal(schemas.addableToGroup('aside').length, 1, 'and unaffected elsewhere');
});

test('a template-only section is not offered for a group', async () => {
  const source = new InMemoryThemeSource({
    'sections/main-product.liquid':
      `x\n{% schema %}
      { "name": "Product information", "enabled_on": { "templates": ["product"] },
        "presets": [{ "name": "Default" }] }
      {% endschema %}`,
  });
  const schemas = await ThemeSchemas.read(source);

  assert.equal(schemas.addable('product').length, 1);
  assert.equal(schemas.addable('index').length, 0);
  assert.equal(schemas.addableToGroup('header').length, 0);
});

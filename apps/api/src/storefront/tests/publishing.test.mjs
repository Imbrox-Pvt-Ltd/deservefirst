/**
 * Storefront · tests/publishing.test.mjs
 * Publishing a theme, and refusing to.
 *
 * The test that earns its place is "a broken theme cannot be published". A
 * publish that wrote first and checked afterwards would have already taken the
 * store down by the time it noticed; checking first means the worst outcome is
 * a merchant being told no, with nothing changed.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EditorService,
  InMemoryDraftStore,
  PublishService,
  ThemeSchemas,
} from '../../../dist/storefront/application/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';
import {
  planPublish,
  planRollback,
  PublishError,
  versionRefFor,
} from '../../../dist/storefront/domain/index.js';

// ------------------------------------------------------- the pure decisions

test('publishing the theme that is already live demotes nothing', () => {
  /**
   * The common case: a merchant editing their live theme and shipping the
   * change. Treating it as a swap would briefly leave the store with no main
   * theme — a storefront that answers nothing.
   */
  const live = { id: 'thm_1', name: 'Broadcast', role: 'main', versionRef: 'v_old' };
  const change = planPublish(live, live, 'v_new');

  assert.deepEqual(change.promote, { themeId: 'thm_1', versionRef: 'v_new' });
  assert.equal(change.demote, null);
});

test('publishing a different theme demotes the old one', () => {
  const live = { id: 'thm_1', name: 'Old', role: 'main', versionRef: 'v_1' };
  const draft = { id: 'thm_2', name: 'New', role: 'unpublished', versionRef: 'v_2' };

  const change = planPublish(draft, live, 'v_3');
  assert.equal(change.promote.themeId, 'thm_2');
  assert.deepEqual(change.demote, { themeId: 'thm_1' });
});

test('a store with no live theme has nothing to demote', () => {
  const change = planPublish(
    { id: 'thm_1', name: 'First', role: 'unpublished', versionRef: 'v_1' },
    null,
    'v_1',
  );
  assert.equal(change.demote, null);
});

test('a version reference is content-addressed and order-independent', () => {
  /**
   * Two publishes of identical content are the same version, so republishing
   * writes nothing — and a reference cannot point at content that changed
   * underneath it, which is what makes rollback trustworthy.
   */
  const a = versionRefFor([
    { path: 'templates/index.json', contents: '{}' },
    { path: 'layout/theme.liquid', contents: '<html></html>' },
  ]);
  const b = versionRefFor([
    { path: 'layout/theme.liquid', contents: '<html></html>' },
    { path: 'templates/index.json', contents: '{}' },
  ]);

  assert.equal(a, b, 'file order must not change the reference');
  assert.notEqual(
    a,
    versionRefFor([{ path: 'templates/index.json', contents: '{"changed":true}' }]),
  );
  assert.match(a, /^v_[0-9a-f]{16}$/);
});

test('rollback targets the previous VERSION of the live theme', () => {
  /**
   * Not the previously-live theme. Those differ when a merchant published edits
   * to the theme that was already live, which is the usual case — rolling back
   * should undo the edit, not swap to a theme abandoned months ago.
   */
  const live = { id: 'thm_1', name: 'Broadcast', role: 'main', versionRef: 'v_3' };
  const target = planRollback(live, [
    { versionRef: 'v_1', publishedAt: '2026-01-01T00:00:00Z' },
    { versionRef: 'v_2', publishedAt: '2026-02-01T00:00:00Z' },
    { versionRef: 'v_3', publishedAt: '2026-03-01T00:00:00Z' },
  ]);

  assert.deepEqual(target, { themeId: 'thm_1', versionRef: 'v_2' });
});

test('a theme published only once cannot be rolled back', () => {
  assert.throws(
    () =>
      planRollback({ id: 'thm_1', name: 'X', role: 'main', versionRef: 'v_1' }, [
        { versionRef: 'v_1', publishedAt: '2026-01-01T00:00:00Z' },
      ]),
    (error) => error instanceof PublishError && error.code === 'no_rollback',
  );
});

// ------------------------------------------------------- the whole publish

/** A working theme, and the pieces to publish it. */
function fixture({ breakIt = false } = {}) {
  const files = {
    'layout/theme.liquid': `<html><body>{{ content_for_layout }}</body></html>`,
    'templates/index.json': JSON.stringify({
      sections: { hero: { type: 'hero', settings: { heading: 'Live' } } },
      order: ['hero'],
    }),
    'sections/hero.liquid':
      `<h1>{{ section.settings.heading }}</h1>\n` +
      `{% schema %}
      { "name": "Hero",
        "settings": [{ "type": "text", "id": "heading", "default": "Hello" }],
        "presets": [{ "name": "Default" }] }
      {% endschema %}`,
  };

  if (breakIt) {
    // A filter that does not exist. strictFilters makes this fail the render of
    // any page reaching it — exactly what a merchant must not ship.
    files['sections/hero.liquid'] =
      `<h1>{{ section.settings.heading | no_such_filter }}</h1>\n` +
      `{% schema %}
      { "name": "Hero",
        "settings": [{ "type": "text", "id": "heading" }],
        "presets": [{ "name": "Default" }] }
      {% endschema %}`;
  }

  const source = new InMemoryThemeSource(files);
  const drafts = new InMemoryDraftStore();
  const session = { themeId: 'thm_1', source };

  const written = new Map();
  const versions = {
    write: async (themeId, ref, fileSet) => written.set(`${themeId} ${ref}`, fileSet),
    has: async (themeId, ref) => written.has(`${themeId} ${ref}`),
    sourceFor: () => source,
  };

  let live = { id: 'thm_1', name: 'Broadcast', role: 'main', versionRef: 'v_start' };
  const applied = [];
  const themes = {
    byId: async (id) => (id === 'thm_1' ? live : null),
    mainTheme: async () => live,
    applyRoleChange: async (change) => {
      applied.push(change);
      live = { ...live, versionRef: change.promote.versionRef };
    },
    history: async () => [{ versionRef: 'v_start', publishedAt: '2026-01-01T00:00:00Z' }],
  };

  const announced = [];
  const publisher = new PublishService(themes, versions, drafts, async (event) =>
    announced.push(event),
  );

  return {
    session, source, drafts, publisher, written, applied, announced,
    editor: new EditorService(drafts, () => 'b1'),
    liveNow: () => live,
  };
}

test('publishing writes a version and moves the pointer', async () => {
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Shipped' } },
    expectedVersion: 1,
  }, schemas);

  const result = await f.publisher.publish(f.session);

  assert.equal(result.changed, true);
  assert.match(result.versionRef, /^v_/);
  assert.equal(result.preflight.ok, true);

  // One transaction, and it promoted without demoting — the theme was already live.
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].demote, null);
  assert.equal(f.liveNow().versionRef, result.versionRef);
});

test('a published version holds the WHOLE theme, not only what changed', async () => {
  /**
   * A version with only the edited template could not be served on its own, so
   * rolling back to it would produce a store with no layout.
   */
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'X' } },
    expectedVersion: 1,
  }, schemas);
  const result = await f.publisher.publish(f.session);

  const stored = f.written.get(`thm_1 ${result.versionRef}`);
  const paths = stored.map((file) => file.path).sort();

  assert.deepEqual(paths, ['layout/theme.liquid', 'sections/hero.liquid', 'templates/index.json']);
  // And the edit is in it.
  assert.ok(stored.find((file) => file.path === 'templates/index.json').contents.includes('"X"'));
});

test('the draft is cleared only after the pointer moved', async () => {
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Y' } },
    expectedVersion: 1,
  }, schemas);

  await f.publisher.publish(f.session);
  assert.deepEqual(await f.drafts.pending('thm_1'), [], 'the draft should be gone');
});

test('publishing with no changes is refused rather than being a no-op', async () => {
  const f = fixture();
  await assert.rejects(
    () => f.publisher.publish(f.session),
    (error) => error instanceof PublishError && error.code === 'nothing_to_publish',
  );
});

// ============================================ the property that matters

test('a theme that would break the store cannot be published', async () => {
  /**
   * The whole reason preflight exists. `no_such_filter` fails the render of any
   * page reaching it, so publishing would give every visitor a broken homepage —
   * and the merchant is right here with the editor open, which is the one moment
   * when telling them costs nothing.
   */
  const f = fixture({ breakIt: true });
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Doomed' } },
    expectedVersion: 1,
  }, schemas);

  await assert.rejects(
    () => f.publisher.publish(f.session),
    (error) => {
      assert.ok(error instanceof PublishError, 'wrong error type');
      assert.equal(error.code, 'would_break');
      assert.equal(error.failures.length, 1);
      assert.match(error.failures[0].reason, /undefined filter/);
      return true;
    },
  );

  // Nothing was written and nothing moved — the store is exactly as it was.
  assert.equal(f.written.size, 0, 'a version was written for a broken theme');
  assert.equal(f.applied.length, 0, 'the pointer moved for a broken theme');
  assert.equal(f.liveNow().versionRef, 'v_start');
  assert.deepEqual(await f.drafts.pending('thm_1'), ['templates/index.json'], 'the draft was lost');
});

test('preflight can be asked without publishing', async () => {
  // The check is the valuable part; making a merchant press publish to find out
  // would waste it.
  const f = fixture({ breakIt: true });
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Z' } },
    expectedVersion: 1,
  }, schemas);

  const files = await f.editor.pendingFiles(f.session);
  const result = await f.publisher.preflight(f.session, files);

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(f.written.size, 0, 'preflight must not write');
});

test('republishing identical content writes no second copy', async () => {
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  const change = {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Same' } },
    expectedVersion: 1,
  };

  await f.editor.edit(f.session, 'templates/index.json', change, schemas);
  const first = await f.publisher.publish(f.session);

  await f.editor.edit(f.session, 'templates/index.json', change, schemas);
  const second = await f.publisher.publish(f.session);

  assert.equal(second.versionRef, first.versionRef, 'identical content, identical version');
  assert.equal(second.changed, false, 'it should not have been written again');
  assert.equal(f.written.size, 1);
});

test('publishing announces what happened', async () => {
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Announced' } },
    expectedVersion: 1,
  }, schemas);
  const result = await f.publisher.publish(f.session);

  assert.equal(f.announced.length, 1);
  assert.equal(f.announced[0].type, 'storefront.theme.published');
  assert.equal(f.announced[0].payload.versionRef, result.versionRef);
});

test('rollback moves the pointer back without writing', async () => {
  const f = fixture();
  const schemas = await ThemeSchemas.read(f.source);

  await f.editor.edit(f.session, 'templates/index.json', {
    action: { kind: 'update_settings', sectionId: 'hero', settings: { heading: 'Regret' } },
    expectedVersion: 1,
  }, schemas);
  await f.publisher.publish(f.session);

  const before = f.written.size;
  const target = await f.publisher.rollback();

  assert.equal(target.versionRef, 'v_start', 'back to what was live before');
  assert.equal(f.written.size, before, 'a rollback writes nothing');
  assert.equal(f.liveNow().versionRef, 'v_start');
});

// ============ the distinction that makes preflight usable rather than absolute

test('a theme bug blocks; a missing-data failure does not', async () => {
  /**
   * The hardest judgement in preflight, and wrong in both directions.
   *
   * The check renders with no products or collections, because one that needed
   * real data could never let a NEW store publish. So a section reaching for
   * `product.title` fails here and works perfectly for a customer — blocking on
   * that would make most real themes unpublishable.
   *
   * A missing filter fails for EVERY visitor regardless of data. That is not an
   * artefact of checking; it is a page a customer will never see.
   */
  const { decidePublish, isThemeBug } = await import('../../../dist/storefront/domain/index.js');

  assert.equal(isThemeBug('undefined filter: no_such_filter, line:1'), true);
  assert.equal(isThemeBug('{% paginate %} was never closed'), true);
  // Data-shaped failures are not theme bugs.
  assert.equal(isThemeBug("Cannot read properties of undefined (reading 'title')"), false);
  assert.equal(isThemeBug('variants is not iterable'), false);

  const decision = decidePublish([
    {
      template: 'templates/index.json',
      error: null,
      sectionFailures: [
        { section: 'hero', reason: 'undefined filter: no_such_filter' },
        { section: 'related', reason: "Cannot read properties of undefined (reading 'title')" },
      ],
    },
  ]);

  assert.equal(decision.ok, false, 'the theme bug must block');
  assert.equal(decision.failures.length, 1);
  assert.match(decision.failures[0].reason, /hero/);

  assert.equal(decision.warnings.length, 1, 'the data failure is a warning, not a block');
  assert.match(decision.warnings[0].reason, /related/);
});

test('a template that fails outright always blocks', async () => {
  const { decidePublish } = await import('../../../dist/storefront/domain/index.js');
  const decision = decidePublish([
    { template: 'templates/product.json', error: 'the theme has no template for this page' },
  ]);
  assert.equal(decision.ok, false);
  assert.equal(decision.failures.length, 1);
});

test('a clean theme publishes with no warnings at all', async () => {
  const { decidePublish } = await import('../../../dist/storefront/domain/index.js');
  const decision = decidePublish([
    { template: 'templates/index.json', error: null, sectionFailures: [] },
  ]);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.warnings, []);
  assert.deepEqual(decision.checked, ['templates/index.json']);
});

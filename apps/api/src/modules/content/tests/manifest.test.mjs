/**
 * Content · tests/manifest.test.mjs
 * Metaobject validation is the interesting part: a merchant-defined content type
 * has to be checkable without a schema, because there is no schema — the
 * definition is data.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@deservefirst/contracts';

import { contentManifest } from '../../../../dist/modules/content/content.manifest.js';
import { pageResource } from '../../../../dist/modules/content/contracts/index.js';
import {
  assertDefinitionValid,
  assertEntryValid,
  assertPageHandleAvailable,
  assertPageValid,
  ContentInvariantError,
  entryDisplayName,
} from '../../../../dist/modules/content/domain/index.js';

test('the manifest satisfies every capability contract it declares', () => {
  assert.deepEqual(validateManifest(contentManifest).errors, []);
});

test('Page is the entity that opts into SEO', () => {
  const page = contentManifest.entities.find((entity) => entity.name === 'Page');
  assert.equal(page.toolkit.seo, true);
  assert.ok(page.translatableFields.includes('title'));
  assert.equal(pageResource.urlSegment, 'pages');
});

// --- pages ------------------------------------------------------------------

const page = (overrides = {}) => ({
  id: 'p1',
  handle: 'about-us',
  title: 'About us',
  body: '<p>Hello.</p>',
  status: 'draft',
  templateSuffix: null,
  publishedAt: null,
  version: 1,
  ...overrides,
});

test('a published page needs content and a date', () => {
  assert.doesNotThrow(() => assertPageValid(page()));
  assert.throws(
    () => assertPageValid(page({ status: 'published', body: '  ', publishedAt: new Date() })),
    /a published page needs content/,
  );
  assert.throws(
    () => assertPageValid(page({ status: 'published', publishedAt: null })),
    /needs a publication date/,
  );
  // A draft may be empty — that is what a draft is for.
  assert.doesNotThrow(() => assertPageValid(page({ body: '' })));
});

test('a page cannot shadow a storefront route', () => {
  assert.doesNotThrow(() => assertPageHandleAvailable('about-us'));
  for (const reserved of ['cart', 'checkout', 'products', 'collections', 'account']) {
    assert.throws(() => assertPageHandleAvailable(reserved), /reserved by the storefront/);
  }
});

test('a page needs a title and a handle', () => {
  assert.throws(() => assertPageValid(page({ title: '   ' })), ContentInvariantError);
  assert.throws(() => assertPageValid(page({ handle: '' })), ContentInvariantError);
});

// --- metaobject definitions -------------------------------------------------

const definition = (overrides = {}) => ({
  id: 'd1',
  type: 'author',
  name: 'Author',
  description: null,
  displayNameKey: 'full_name',
  fields: [
    { key: 'full_name', name: 'Full name', type: 'single_line_text', required: true, description: null },
    { key: 'bio', name: 'Bio', type: 'multi_line_text', required: false, description: null },
    { key: 'website', name: 'Website', type: 'url', required: false, description: null },
    { key: 'articles', name: 'Articles', type: 'integer', required: false, description: null },
  ],
  version: 1,
  ...overrides,
});

test('a definition needs a snake_case type and at least one field', () => {
  assert.doesNotThrow(() => assertDefinitionValid(definition()));
  assert.throws(() => assertDefinitionValid(definition({ type: 'Author' })), /lower_snake_case/);
  assert.throws(() => assertDefinitionValid(definition({ fields: [] })), /at least one field/);
});

test('duplicate field keys are refused', () => {
  const duplicated = definition({
    fields: [
      { key: 'name', name: 'A', type: 'single_line_text', required: false, description: null },
      { key: 'name', name: 'B', type: 'single_line_text', required: false, description: null },
    ],
    displayNameKey: null,
  });
  assert.throws(() => assertDefinitionValid(duplicated), /duplicate field key "name"/);
});

test('the display-name key must name a real field', () => {
  assert.throws(
    () => assertDefinitionValid(definition({ displayNameKey: 'nope' })),
    /must name one of this definition/,
  );
});

// --- metaobject entries -----------------------------------------------------

const entry = (values, overrides = {}) => ({
  id: 'e1',
  definitionId: 'd1',
  handle: 'ada',
  values,
  status: 'draft',
  version: 1,
  ...overrides,
});

test('an entry is validated against its definition, which is data not schema', () => {
  assert.doesNotThrow(() =>
    assertEntryValid(definition(), entry({ full_name: 'Ada Lovelace', articles: 3 })),
  );
});

test('a required field must be present', () => {
  assert.throws(() => assertEntryValid(definition(), entry({ bio: 'x' })), /"Full name" is required/);
  assert.throws(() => assertEntryValid(definition(), entry({ full_name: '  ' })), /is required/);
});

test('an unknown key is rejected rather than silently dropped', () => {
  // Dropping a value the merchant typed is worse than telling them the field
  // does not exist.
  assert.throws(
    () => assertEntryValid(definition(), entry({ full_name: 'Ada', nickname: 'A' })),
    /"nickname" is not a field on author/,
  );
});

test('field types are enforced', () => {
  assert.throws(
    () => assertEntryValid(definition(), entry({ full_name: 'Ada', articles: 1.5 })),
    /must be a whole number/,
  );
  assert.throws(
    () => assertEntryValid(definition(), entry({ full_name: 'Ada', website: 'not a url' })),
    /must be a valid URL/,
  );
  assert.throws(
    () => assertEntryValid(definition(), entry({ full_name: 'Line\nBreak' })),
    /is single-line/,
  );
});

test('an entry falls back to its handle rather than showing blank', () => {
  assert.equal(entryDisplayName(definition(), entry({ full_name: 'Ada Lovelace' })), 'Ada Lovelace');
  assert.equal(entryDisplayName(definition(), entry({})), 'ada');
  assert.equal(entryDisplayName(definition({ displayNameKey: null }), entry({ full_name: 'Ada' })), 'ada');
});

/**
 * Core · tests/entity-toolkit.test.mjs
 * The toolkit is inherited by every entity, so these tests are the contract that
 * "declare an entity, get a full admin surface" actually holds.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCsv,
  buildSeoPreview,
  bulkActionsFor,
  detailPanelsFor,
  diffFields,
  disambiguateHandle,
  markOutdated,
  MetafieldValidationError,
  normalizeLocale,
  normalizeTags,
  parseCsv,
  parseCsvLine,
  redactChanges,
  redirectForHandleChange,
  requiredIndexesFor,
  resolveLocaleChain,
  resolveToolkit,
  resolveTranslation,
  shouldRunInBackground,
  slugifyHandle,
  toolkitTablesFor,
  validateMetafieldValue,
} from '../dist/core/entity-toolkit/index.js';

// --- handles ---------------------------------------------------------------

test('handles are slugified, accent-folded and bounded', () => {
  assert.equal(slugifyHandle('Crème Brûlée Deluxe'), 'creme-brulee-deluxe');
  assert.equal(slugifyHandle('  Spaced   Out  '), 'spaced-out');
  // Atomic Latin letters that NFKD leaves alone must still transliterate.
  assert.equal(slugifyHandle('Ünïcødé & Symbols!!'), 'unicode-symbols');
  assert.equal(slugifyHandle('Bløde Æbler'), 'blode-aebler');
  assert.equal(slugifyHandle('Straße'), 'strasse');
  assert.equal(slugifyHandle('Łódź'), 'lodz');
  assert.ok(slugifyHandle('x'.repeat(500)).length <= 255);
});

test('duplicate handles are suffixed rather than rejected', () => {
  const taken = new Set(['blue-shirt', 'blue-shirt-2']);
  assert.equal(disambiguateHandle('blue-shirt', taken), 'blue-shirt-3');
  assert.equal(disambiguateHandle('red-shirt', taken), 'red-shirt');
});

// --- metafields ------------------------------------------------------------

const definition = (overrides = {}) => ({
  id: 'def-1',
  storeId: 'store-1',
  ownerEntity: 'Product',
  namespace: 'custom',
  key: 'fabric',
  name: 'Fabric',
  description: null,
  type: 'single_line_text',
  validation: {},
  source: 'merchant',
  categoryId: null,
  translatable: false,
  pinned: false,
  ...overrides,
});

test('metafield types are actually enforced', () => {
  assert.throws(() => validateMetafieldValue(definition(), 42), MetafieldValidationError);
  assert.throws(
    () => validateMetafieldValue(definition({ type: 'integer' }), 1.5),
    /expected a whole number/,
  );
  assert.throws(
    () => validateMetafieldValue(definition({ type: 'boolean' }), 'yes'),
    /expected true or false/,
  );
  assert.throws(
    () => validateMetafieldValue(definition({ type: 'url' }), 'not a url'),
    /is not a valid URL/,
  );
});

test('single-line text rejects newlines, which is the point of the type', () => {
  assert.throws(
    () => validateMetafieldValue(definition(), 'line one\nline two'),
    /may not contain a newline/,
  );
  assert.doesNotThrow(() => validateMetafieldValue(definition({ type: 'multi_line_text' }), 'a\nb'));
});

test('validation rules are applied', () => {
  assert.throws(
    () => validateMetafieldValue(definition({ validation: { maxLength: 3 } }), 'toolong'),
    /longer than the 3-character limit/,
  );
  assert.throws(
    () => validateMetafieldValue(definition({ validation: { choices: ['cotton', 'wool'] } }), 'silk'),
    /must be one of: cotton, wool/,
  );
  assert.throws(
    () => validateMetafieldValue(definition({ type: 'rating', validation: { min: 1, max: 5 } }), 9),
    /must be at most 5/,
  );
});

test('money metafields must be the Money value object, not a number', () => {
  assert.throws(
    () => validateMetafieldValue(definition({ type: 'money' }), 19.99),
    /expected a Money value object/,
  );
  assert.doesNotThrow(() =>
    validateMetafieldValue(definition({ type: 'money' }), { amountMinor: 1999n, currency: 'USD' }),
  );
});

test('null clears a metafield rather than failing validation', () => {
  assert.doesNotThrow(() => validateMetafieldValue(definition({ type: 'integer' }), null));
});

// --- timeline & audit ------------------------------------------------------

test('diffs record only what changed', () => {
  const changes = diffFields(
    { title: 'Old', vendor: 'Acme', price: 100 },
    { title: 'New', vendor: 'Acme', price: 100 },
    ['title', 'vendor', 'price'],
  );
  assert.deepEqual(changes, [{ field: 'title', from: 'Old', to: 'New' }]);
});

test('dates compare by value, not by reference', () => {
  const changes = diffFields({ at: new Date('2026-01-01') }, { at: new Date('2026-01-01') }, ['at']);
  assert.deepEqual(changes, []);
});

test('secrets never reach a timeline entry', () => {
  const redacted = redactChanges([
    { field: 'title', from: 'a', to: 'b' },
    { field: 'password', from: 'hunter2', to: 'hunter3' },
    { field: 'api_key', from: 'k1', to: 'k2' },
  ]);
  assert.equal(redacted[0].to, 'b');
  assert.equal(redacted[1].from, '[redacted]');
  assert.equal(redacted[2].to, '[redacted]');
});

// --- translations ----------------------------------------------------------

test('locale resolution prefers the user, then the store, then the header', () => {
  const resolution = resolveLocaleChain({
    userLocale: 'fr-CA',
    storeDefaultLocale: 'en-US',
    acceptLanguage: 'de-DE;q=0.9,es;q=0.8',
  });
  assert.equal(resolution.locale, 'fr-CA');
  assert.deepEqual(resolution.fallbackChain.slice(0, 4), ['fr-CA', 'fr', 'en-US', 'en']);
});

test('locales are normalised to BCP-47 shape', () => {
  assert.equal(normalizeLocale('EN_us'), 'en-US');
  assert.equal(normalizeLocale('fr'), 'fr');
});

test('a missing translation falls back to the source rather than showing blank', () => {
  const resolved = resolveTranslation([], 'title', ['fr-CA', 'fr'], 'Original title');
  assert.equal(resolved.value, 'Original title');
  assert.equal(resolved.locale, null);
});

test('draft translations are not served', () => {
  const records = [{ field: 'title', locale: 'fr', value: 'Titre', status: 'draft', outdated: false }];
  assert.equal(resolveTranslation(records, 'title', ['fr'], 'Title').value, 'Title');
});

test('changing a source field marks its translations outdated', () => {
  const records = [
    { field: 'title', locale: 'fr', value: 'Titre', status: 'published', outdated: false },
    { field: 'body', locale: 'fr', value: 'Corps', status: 'published', outdated: false },
  ];
  const marked = markOutdated(records, ['title']);
  assert.equal(marked[0].outdated, true);
  assert.equal(marked[1].outdated, false);
});

// --- SEO -------------------------------------------------------------------

test('SEO preview falls back to the record and warns about length', () => {
  const preview = buildSeoPreview({
    seo: {
      title: null,
      description: null,
      canonicalUrl: null,
      ogImageUrl: null,
      noIndex: false,
      noFollow: false,
    },
    fallbackTitle: 'A'.repeat(80),
    fallbackDescription: '<p>Some <b>markup</b> here</p>',
    storefrontUrl: 'https://example.test/products/a',
  });
  assert.equal(preview.description, 'Some markup here');
  assert.ok(preview.warnings.some((warning) => /truncated near 60/.test(warning)));
});

test('a handle change produces a 301 so links do not break', () => {
  const redirect = redirectForHandleChange('store-1', 'products', 'old-name', 'new-name', new Date());
  assert.equal(redirect.fromPath, '/products/old-name');
  assert.equal(redirect.statusCode, 301);
  assert.equal(redirectForHandleChange('store-1', 'products', 'same', 'same', new Date()), null);
});

// --- tags ------------------------------------------------------------------

test('tags are normalised and de-duplicated case-insensitively', () => {
  assert.deepEqual(normalizeTags([' Sale ', 'sale', 'SALE', 'New  Arrival', '']), [
    'Sale',
    'New Arrival',
  ]);
});

// --- bulk & CSV ------------------------------------------------------------

test('select-all-matching always runs in the background', () => {
  assert.equal(shouldRunInBackground({ kind: 'all-matching', query: {} }), true);
  assert.equal(shouldRunInBackground({ kind: 'ids', ids: ['1', '2'] }), false);
  assert.equal(shouldRunInBackground({ kind: 'ids', ids: Array(200).fill('x') }), true);
});

test('CSV quoting survives commas, quotes and newlines', () => {
  const csv = buildCsv(
    ['title', 'note'],
    [
      { title: 'Blue, large', note: 'He said "hi"' },
      { title: 'Multi\nline', note: null },
    ],
  );
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['title', 'note']);
  assert.equal(parsed.rows[0].title, 'Blue, large');
  assert.equal(parsed.rows[0].note, 'He said "hi"');
  assert.equal(parsed.rows[1].title, 'Multi\nline');
});

test('a quoted comma does not split a column', () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
});

// --- composition -----------------------------------------------------------

test('toolkit features default on, SEO opts in', () => {
  const resolved = resolveToolkit({ name: 'Product', tableName: 'products' });
  assert.equal(resolved.metafields, true);
  assert.equal(resolved.softDelete, true);
  assert.equal(resolved.seo, false);
  assert.equal(resolveToolkit({ name: 'Page', tableName: 'pages', toolkit: { seo: true } }).seo, true);
});

test('satellite tables and indexes follow from the declaration', () => {
  const entity = {
    name: 'Product',
    tableName: 'products',
    toolkit: { seo: true },
    translatableFields: ['title'],
  };
  const tables = toolkitTablesFor(entity).map((table) => table.name);
  assert.ok(tables.includes('products_metafields'));
  assert.ok(tables.includes('products_translations'));
  assert.ok(tables.includes('products_seo'));

  const indexes = requiredIndexesFor(entity);
  assert.ok(indexes.some((index) => index.includes('(store_id)')));
  assert.ok(indexes.some((index) => index.includes('deleted_at')));
});

test('detail panels and bulk actions are derived, not hand-listed', () => {
  const entity = {
    name: 'Product',
    tableName: 'products',
    toolkit: { seo: true },
    translatableFields: ['title'],
  };
  assert.deepEqual(detailPanelsFor(entity), ['tags', 'metafields', 'seo', 'translations', 'timeline']);
  assert.deepEqual(bulkActionsFor(entity), [
    'edit',
    'add-tags',
    'remove-tags',
    'archive',
    'delete',
    'export',
  ]);
});

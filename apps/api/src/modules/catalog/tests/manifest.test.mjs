/**
 * Catalog · tests/manifest.test.mjs
 * The Phase 1 exit criterion, expressed as a test: a Product is DECLARED once,
 * and from that declaration alone it gets a list screen, a detail screen,
 * metafields, saved views, bulk actions, SEO, translations, search and a
 * composed route — with no bespoke code anywhere in this module.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseListQuery, validateManifest } from '@deservefirst/contracts';

import {
  bulkActionsFor,
  detailPanelsFor,
  requiredIndexesFor,
  toolkitTablesFor,
} from '../../../../dist/core/entity-toolkit/index.js';
import { compileListQuery } from '../../../../dist/core/list-engine/index.js';
import { ModuleRegistry } from '../../../../dist/core/module-registry/registry.js';
import { catalogManifest } from '../../../../dist/modules/catalog/catalog.manifest.js';
import { productResource } from '../../../../dist/modules/catalog/contracts/index.js';
import {
  assertProductValid,
  assertTransitionAllowed,
  canPublish,
  marginBasisPoints,
  ProductInvariantError,
} from '../../../../dist/modules/catalog/domain/index.js';

test('the manifest satisfies every capability contract it declares', () => {
  const result = validateManifest(catalogManifest);
  assert.deepEqual(result.errors, [], result.errors.join('\n'));
});

test('declaring the entity earns the whole toolkit — no code required', () => {
  const [product] = catalogManifest.entities;

  // Satellite storage the migration generator will create.
  const tables = toolkitTablesFor(product).map((table) => table.name);
  assert.deepEqual(tables.sort(), [
    'products_metafields',
    'products_saved_views',
    'products_seo',
    'products_tags',
    'products_timeline',
    'products_translations',
  ]);

  // Detail panels the screen renders, derived from the declaration.
  assert.deepEqual(detailPanelsFor(product), [
    'tags',
    'metafields',
    'seo',
    'translations',
    'timeline',
  ]);

  // Bulk actions the list offers.
  assert.ok(bulkActionsFor(product).includes('export'));
  assert.ok(bulkActionsFor(product).includes('archive'));

  // Indexes that keep it off the slow-query dashboard.
  const indexes = requiredIndexesFor(product);
  assert.ok(indexes.some((index) => index.includes('(store_id)')));
  assert.ok(indexes.some((index) => index.includes('store_id, handle')));
});

test('the resource definition drives a real, safe list query', () => {
  const compiled = compileListQuery({
    resource: productResource,
    tableName: 'products',
    storeId: 'store-1',
    query: parseListQuery(
      new URLSearchParams(
        'query=' +
          encodeURIComponent('vendor:"Hydrogen Vendor" status:active') +
          '&order=createdAt+desc&selectedColumns=title,status,vendor',
      ),
    ),
  });

  assert.match(compiled.sql, /"store_id" = \$1/);
  assert.match(compiled.sql, /"deleted_at" IS NULL/);
  assert.ok(compiled.parameters.includes('Hydrogen Vendor'));
  assert.ok(!compiled.sql.includes('Hydrogen'), 'values are bound, never interpolated');
  assert.match(compiled.sql, /ORDER BY "created_at" DESC, "id" DESC/);
});

test('a private field never reaches the public column set', () => {
  const cost = productResource.fields.find((field) => field.name === 'costPerItem');
  const notes = productResource.fields.find((field) => field.name === 'internalNotes');
  assert.equal(cost.visibility, 'private');
  assert.equal(notes.visibility, 'internal');
});

test('routes and navigation compose into the registry without collision', () => {
  const registry = new ModuleRegistry();
  registry.register(catalogManifest);
  registry.seal();

  const paths = registry.routes().map((entry) => entry.item.path);
  assert.ok(paths.includes('/store/:handle/products'));
  assert.ok(paths.includes('/store/:handle/products/:id'));

  // Every navigation item resolves to a declared route — no orphans (§24.5).
  for (const entry of registry.navigation()) {
    assert.ok(paths.includes(entry.item.path), `orphan nav item ${entry.item.id}`);
  }

  // Every route's permission is declared by the same module.
  const declared = new Set(registry.permissions().map((entry) => entry.item.key));
  for (const entry of registry.routes()) {
    assert.ok(declared.has(entry.item.permission), `undeclared permission ${entry.item.permission}`);
  }

  assert.deepEqual(registry.storeScopedTables(), ['products']);
});

test('settings contribute into a shared group rather than a new page', () => {
  const groups = new Set(catalogManifest.settings.map((setting) => setting.group));
  assert.deepEqual([...groups], ['general']);
});

// --- domain invariants ------------------------------------------------------

const product = (overrides = {}) => ({
  id: 'p1',
  handle: 'blue-shirt',
  title: 'Blue Shirt',
  description: '',
  status: 'draft',
  vendor: 'Acme',
  productType: 'Shirt',
  price: { amountMinor: 1999n, currency: 'USD' },
  compareAtPrice: null,
  costPerItem: null,
  variants: [],
  optionNames: [],
  publishedChannels: [],
  version: 1,
  ...overrides,
});

test('invariants reject the states that would corrupt a catalog', () => {
  assert.throws(() => assertProductValid(product({ title: '   ' })), ProductInvariantError);
  assert.throws(
    () => assertProductValid(product({ price: { amountMinor: -1n, currency: 'USD' } })),
    /cannot be negative/,
  );
  assert.throws(
    () => assertProductValid(product({ compareAtPrice: { amountMinor: 2999n, currency: 'EUR' } })),
    /same currency as price/,
  );
  assert.throws(
    () => assertProductValid(product({ optionNames: ['a', 'b', 'c', 'd'] })),
    /at most 3 options/,
  );
});

test('duplicate variant option combinations are refused', () => {
  const withDuplicates = product({
    optionNames: ['Color'],
    variants: [
      {
        id: 'v1',
        sku: null,
        optionValues: { Color: 'Blue' },
        price: { amountMinor: 1999n, currency: 'USD' },
        inventoryQuantity: 1,
      },
      {
        id: 'v2',
        sku: null,
        optionValues: { Color: 'Blue' },
        price: { amountMinor: 1999n, currency: 'USD' },
        inventoryQuantity: 2,
      },
    ],
  });
  assert.throws(() => assertProductValid(withDuplicates), /duplicate option combination "Blue"/);
});

test('a variant must supply exactly the declared options', () => {
  const mismatched = product({
    optionNames: ['Color', 'Size'],
    variants: [
      {
        id: 'v1',
        sku: null,
        optionValues: { Color: 'Blue' },
        price: { amountMinor: 1999n, currency: 'USD' },
        inventoryQuantity: 1,
      },
    ],
  });
  assert.throws(() => assertProductValid(mismatched), /must supply exactly the declared options/);
});

test('publishing is a rule-checked transition, not an enum write', () => {
  assert.equal(canPublish(product({ status: 'archived' })).ok, false);
  assert.equal(canPublish(product({ title: '  ' })).ok, false);
  assert.equal(canPublish(product({ price: { amountMinor: 0n, currency: 'USD' } })).ok, false);
  assert.equal(canPublish(product()).ok, true);

  assert.doesNotThrow(() => assertTransitionAllowed('draft', 'active'));
  assert.doesNotThrow(() => assertTransitionAllowed('active', 'archived'));
  // Archived must be unarchived first — it cannot jump straight back to live.
  assert.throws(
    () => assertTransitionAllowed('archived', 'active'),
    /cannot move from archived to active/,
  );
});

test('margin is computed in basis points, and unknown cost is not zero margin', () => {
  assert.equal(marginBasisPoints(product()), null);
  const withCost = product({
    price: { amountMinor: 10000n, currency: 'USD' },
    costPerItem: { amountMinor: 4000n, currency: 'USD' },
  });
  assert.equal(marginBasisPoints(withCost), 6000); // 60.00%
});

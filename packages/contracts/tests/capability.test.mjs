/**
 * Contracts · tests/capability.test.mjs
 * Capability-contract validation is what makes metadata-driven composition safe
 * (§31.7). These tests prove it fails loudly on each way a manifest can lie about
 * what it supplies — a silent pass here would be worse than no validation.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertManifestValid, validateManifest } from '../dist/index.js';

const base = {
  id: 'catalog',
  version: '1.0.0',
  label: 'Catalog',
  description: 'Product catalog.',
  entitlementKey: 'catalog',
  dependsOn: [{ module: 'core', type: 'required' }],
  capabilities: ['permissions'],
  permissions: [
    { key: 'catalog.read', label: 'Read', description: 'Read.', categories: ['store'] },
  ],
};

test('a minimal well-formed manifest validates', () => {
  assert.deepEqual(validateManifest(base).errors, []);
});

test('rejects a malformed id, version or missing entitlement key', () => {
  const errors = validateManifest({ ...base, id: 'Catalog', version: '1.0', entitlementKey: '' }).errors;
  assert.ok(errors.some((e) => /lower-kebab-case/.test(e)));
  assert.ok(errors.some((e) => /semver/.test(e)));
  assert.ok(errors.some((e) => /entitlementKey/.test(e)));
});

test('a declared capability without its required pieces fails', () => {
  const errors = validateManifest({ ...base, capabilities: ['permissions', 'jobs'] }).errors;
  assert.ok(errors.some((e) => /capability "jobs" requires manifest key "jobs"/.test(e)));
});

test('a route referencing an undeclared permission fails', () => {
  const errors = validateManifest({
    ...base,
    capabilities: ['permissions', 'routes'],
    routes: [{ path: '/store/:handle/products', screen: 'ListScreen', permission: 'catalog.write' }],
  }).errors;
  assert.ok(errors.some((e) => /requires permission "catalog.write"/.test(e)));
});

test('a resource targeting an undeclared entity fails', () => {
  const errors = validateManifest({
    ...base,
    capabilities: ['permissions', 'entities', 'resources'],
    entities: [{ name: 'Product', tableName: 'products' }],
    resources: [
      {
        name: 'Collection',
        entity: 'Collection',
        pluralName: 'Collections',
        urlSegment: 'collections',
        fields: [],
        api: { graphql: true, rest: true, visibility: 'public' },
        screens: ['list'],
        permissions: { read: 'catalog.read', write: 'catalog.read' },
      },
    ],
  }).errors;
  assert.ok(errors.some((e) => /targets entity "Collection", which the manifest does not declare/.test(e)));
});

test('a webhook mapped to an event the module never emits fails', () => {
  const errors = validateManifest({
    ...base,
    capabilities: ['permissions', 'events', 'webhooks'],
    events: [
      { type: 'catalog.product.created', version: 1, label: 'Created', description: '', direction: 'emits' },
    ],
    webhooks: [{ topic: 'products/updated', eventType: 'catalog.product.updated', description: '' }],
  }).errors;
  assert.ok(errors.some((e) => /which this module does not emit/.test(e)));
});

test('a navigation item pointing at a non-route fails', () => {
  const errors = validateManifest({
    ...base,
    capabilities: ['permissions', 'routes', 'navigation'],
    routes: [{ path: '/store/:handle/products', screen: 'ListScreen', permission: 'catalog.read' }],
    navigation: [
      {
        id: 'collections',
        label: 'Collections',
        path: '/store/:handle/collections',
        section: 'primary',
        position: 1,
        permission: 'catalog.read',
      },
    ],
  }).errors;
  assert.ok(errors.some((e) => /is not a declared route/.test(e)));
});

test('declaring content without its capability fails — it would never be composed', () => {
  const errors = validateManifest({
    ...base,
    jobs: [{ key: 'reindex', label: 'Reindex', schedule: '0 * * * *', tenantScoped: true, maxAttempts: 3 }],
  }).errors;
  assert.ok(errors.some((e) => /does not list capability "jobs"/.test(e)));
});

test('search requires an entity, a permission and at least one field', () => {
  const errors = validateManifest({
    ...base,
    capabilities: ['permissions', 'entities', 'search'],
    entities: [{ name: 'Product', tableName: 'products' }],
    searchProviders: [{ entity: 'Product', indexKey: 'products', permission: 'catalog.read', fields: [] }],
  }).errors;
  assert.ok(errors.some((e) => /declares no searchable fields/.test(e)));
});

test('assertManifestValid throws with every problem listed at once', () => {
  assert.throws(
    () => assertManifestValid({ ...base, id: 'Bad', capabilities: ['permissions', 'jobs'] }),
    (error) => /failed capability-contract validation/.test(error.message)
      && /lower-kebab-case/.test(error.message)
      && /requires manifest key "jobs"/.test(error.message),
  );
});

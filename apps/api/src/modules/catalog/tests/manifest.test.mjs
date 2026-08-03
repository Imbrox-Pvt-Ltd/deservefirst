/**
 * Catalog · tests/manifest.test.mjs
 * Proves the manifest satisfies its declared capability contracts. Every module
 * ships this test — a manifest that cannot load is a module that silently does
 * nothing (§31.7).
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@deservefirst/contracts';

// Tests run against built output, so this reaches into dist/ rather than src/.
import { catalogManifest } from '../../../../dist/modules/catalog/catalog.manifest.js';

test('catalog manifest satisfies its capability contracts', () => {
  const result = validateManifest(catalogManifest);
  assert.deepEqual(result.errors, [], result.errors.join('\n'));
});

/**
 * Apps · tests/version.test.mjs
 * Why scopes belong to a release rather than to the app.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addedScopes,
  assertEditable,
  assertReleasable,
  currentVersion,
  requiresReconsent,
} from '../../../dist/apps/domain/index.js';

const version = (over = {}) => ({
  id: 'v-1', appId: 'app-1', name: '1.0.0', message: null, status: 'draft',
  scopes: ['read_products'], redirectUris: ['https://app.test/cb'], appUrl: null,
  webhookApiVersion: '2026-01', createdAt: new Date('2026-01-01'), releasedAt: null, ...over,
});

test('a released version can never be edited', () => {
  // If it could, consent would mean nothing: an app approved asking for
  // products could quietly become one asking for customer contact details,
  // with every install still pointing at the same version id.
  assert.throws(
    () => assertEditable(version({ status: 'released', releasedAt: new Date() })),
    /cannot be changed/,
  );
  assert.doesNotThrow(() => assertEditable(version()));
});

test('a version cannot ask for a scope the app never registered', () => {
  assert.doesNotThrow(() => assertReleasable(version(), ['read_products', 'write_products']));
  // Otherwise a release routes around the review the app's own list went through.
  assert.throws(
    () => assertReleasable(version({ scopes: ['read_customer_contact'] }), ['read_products']),
    /which the app has not registered/,
  );
  assert.throws(() => assertReleasable(version({ name: '  ' }), ['read_products']), /needs a name/);
  assert.throws(
    () => assertReleasable(version({ redirectUris: [] }), ['read_products']),
    /at least one redirect/,
  );
  assert.throws(
    () => assertReleasable(version({ status: 'released' }), ['read_products']),
    /already been released/,
  );
});

test('only widening asks the merchant again', () => {
  const narrow = version({ scopes: ['read_products'] });
  const wide = version({ id: 'v-2', scopes: ['read_products', 'write_products'] });
  const urlOnly = version({ id: 'v-3', scopes: ['read_products'], appUrl: 'https://new.test' });

  assert.equal(requiresReconsent(narrow, wide), true);
  assert.deepEqual(addedScopes(narrow, wide), ['write_products']);

  // Re-approving strictly less access is a prompt that teaches merchants to
  // click through prompts.
  assert.equal(requiresReconsent(wide, narrow), false);
  assert.equal(requiresReconsent(narrow, urlOnly), false);

  // A first install always asks.
  assert.equal(requiresReconsent(null, narrow), true);
});

test('merchants install the newest RELEASED version, never a draft', () => {
  const older = version({ id: 'v-1', status: 'released', releasedAt: new Date('2026-01-01') });
  const newer = version({ id: 'v-2', status: 'released', releasedAt: new Date('2026-02-01') });
  const draft = version({ id: 'v-3', status: 'draft' });

  assert.equal(currentVersion([older, newer, draft])?.id, 'v-2');
  // An unreleased version is the author's working copy; installing one would
  // mean consenting to something still being edited.
  assert.equal(currentVersion([draft])?.id, undefined);
  assert.equal(currentVersion([]), null);
});

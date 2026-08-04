/**
 * Apps · tests/app.test.mjs
 * The OAuth failures that pass a happy-path test.
 *
 * Almost every case here is an attack rather than a mistake, because that is
 * what this code is for. Each one is a one-line change away from being allowed,
 * and none of them would show up as a broken install.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertAppValid,
  assertCodeUsable,
  assertInstallTransition,
  assertInstallable,
  effectiveScopes,
  needsReconsent,
  permissionsForScopes,
  redirectIsRegistered,
  scopesToConsent,
  tokenExpiry,
  tokenIsUsable,
  tokenScopes,
} from '../../../dist/apps/domain/index.js';

const app = (over = {}) => ({
  id: 'app-1',
  partnerId: 'prt-1',
  name: 'Stock Sync',
  handle: 'stock-sync',
  status: 'published',
  distribution: 'public',
  appUrl: 'https://stocksync.example',
  redirectUris: ['https://stocksync.example/callback'],
  requestedScopes: ['read_products', 'write_products'],
  clientId: 'cid',
  clientSecretHash: 'hash',
  version: 1,
  ...over,
});

const installation = (over = {}) => ({
  id: 'ins-1',
  appId: 'app-1',
  storeId: 'sto-1',
  status: 'installed',
  grantedScopes: ['read_products'],
  installedAt: new Date('2026-01-01'),
  uninstalledAt: null,
  ...over,
});

const code = (over = {}) => ({
  code: 'c-1',
  appId: 'app-1',
  storeId: 'sto-1',
  userId: 'usr-1',
  redirectUri: 'https://stocksync.example/callback',
  scopes: ['read_products', 'write_products'],
  tokenType: 'offline',
  expiresAt: new Date('2026-01-01T00:05:00Z'),
  usedAt: null,
  ...over,
});

const token = (over = {}) => ({
  id: 'tok-1',
  appId: 'app-1',
  storeId: 'sto-1',
  tokenType: 'offline',
  userId: null,
  tokenHash: 'hash',
  scopes: ['read_products'],
  expiresAt: null,
  revokedAt: null,
  ...over,
});

test('a redirect URL has to be a real, safe one', () => {
  assert.throws(() => assertAppValid(app({ redirectUris: [] })), /at least one redirect/);
  assert.throws(() => assertAppValid(app({ redirectUris: ['/callback'] })), /not an absolute URL/);
  assert.throws(
    () => assertAppValid(app({ redirectUris: ['http://stocksync.example/cb'] })),
    /must use https/,
  );
  // A fragment never reaches the server, so it cannot be part of a match.
  assert.throws(
    () => assertAppValid(app({ redirectUris: ['https://stocksync.example/cb#x'] })),
    /must not contain a fragment/,
  );
  assert.throws(
    () => assertAppValid(app({ redirectUris: ['https://user:pw@stocksync.example/cb'] })),
    /must not contain credentials/,
  );
  // Loopback stays http, or every developer disables the check instead.
  assert.doesNotThrow(() => assertAppValid(app({ redirectUris: ['http://localhost:3000/cb'] })));
});

test('redirect matching is exact, so a lookalike host cannot collect the code', () => {
  const registered = app();

  assert.equal(redirectIsRegistered(registered, 'https://stocksync.example/callback'), true);
  // The prefix attack: passes any check written with startsWith.
  assert.equal(redirectIsRegistered(registered, 'https://stocksync.example.evil.com/callback'), false);
  assert.equal(redirectIsRegistered(registered, 'https://stocksync.example/callback/../evil'), false);
  assert.equal(redirectIsRegistered(registered, 'https://stocksync.example/callback?x=1'), false);
  assert.equal(redirectIsRegistered(registered, 'https://stocksync.example/CALLBACK'), false);
});

test('an app cannot ask for a scope it never registered', () => {
  assert.throws(
    () => scopesToConsent(app(), ['read_products', 'read_customers']),
    /has not registered the scope: read_customers/,
  );
  // Asking for less than it registered is fine and should be encouraged.
  assert.deepEqual(scopesToConsent(app(), ['read_products']), ['read_products']);
  // Asking for nothing means everything it registered.
  assert.deepEqual(scopesToConsent(app(), []), ['read_products', 'write_products']);
});

test('a draft public app cannot be installed, a suspended one never can', () => {
  assert.throws(() => assertInstallable(app({ status: 'suspended' })), /suspended/);
  assert.throws(() => assertInstallable(app({ status: 'draft' })), /not published/);
  // A custom app is built for one merchant and never goes through review.
  assert.doesNotThrow(() =>
    assertInstallable(app({ status: 'draft', distribution: 'custom' })),
  );
});

test('wanting more than was granted means asking again, not taking more', () => {
  assert.equal(needsReconsent(installation(), ['read_products']), false);
  assert.equal(needsReconsent(installation(), ['read_products', 'write_products']), true);
  assert.equal(needsReconsent(installation({ status: 'uninstalled' }), ['read_products']), true);
});

test('a code works once', () => {
  const now = new Date('2026-01-01T00:01:00Z');

  assert.doesNotThrow(() => assertCodeUsable(code(), now));
  // Anyone who read it out of a log or a referrer gets nothing.
  assert.throws(
    () => assertCodeUsable(code({ usedAt: new Date('2026-01-01T00:00:30Z') }), now),
    /already been used/,
  );
  assert.throws(
    () => assertCodeUsable(code(), new Date('2026-01-01T00:06:00Z')),
    /has expired/,
  );
});

test("the token carries the merchant's answer, not the app's request", () => {
  // The code asks for read and write; the merchant granted only read.
  assert.deepEqual(tokenScopes(code(), installation()), ['read_products']);

  assert.deepEqual(
    tokenScopes(code(), installation({ grantedScopes: ['read_products', 'write_products'] })),
    ['read_products', 'write_products'],
  );
});

test('offline tokens do not expire on a clock; online ones do', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  assert.equal(tokenExpiry('offline', at), null);
  assert.equal(tokenExpiry('online', at)?.toISOString(), '2026-01-02T00:00:00.000Z');
});

test('uninstalling stops live tokens at once, not when they expire', () => {
  const now = new Date('2026-02-01');

  assert.equal(tokenIsUsable(token(), installation(), now).ok, true);
  // The whole point of an uninstall.
  assert.equal(tokenIsUsable(token(), installation({ status: 'uninstalled' }), now).ok, false);
  assert.equal(tokenIsUsable(token(), null, now).ok, false);
  assert.equal(tokenIsUsable(token({ revokedAt: now }), installation(), now).ok, false);
  assert.equal(
    tokenIsUsable(token({ expiresAt: new Date('2026-01-01') }), installation(), now).ok,
    false,
  );
});

test('narrowing an install narrows the tokens already issued under it', () => {
  const now = new Date('2026-02-01');
  const wide = token({ scopes: ['read_products', 'write_products'] });

  assert.deepEqual(effectiveScopes(wide, installation()), ['read_products']);
  // Nothing left at all is a dead token, not a token with no scopes that still
  // authenticates.
  assert.equal(
    tokenIsUsable(wide, installation({ grantedScopes: ['read_customers'] }), now).ok,
    false,
  );
});

test('scopes become ordinary permissions at the edge', () => {
  const grants = (scope) =>
    ({
      read_products: ['catalog.products.read'],
      write_products: ['catalog.products.read', 'catalog.products.write'],
    })[scope] ?? [];

  // Overlapping grants are merged, not duplicated — past here the caller is
  // just a caller with permissions.
  assert.deepEqual(permissionsForScopes(['read_products', 'write_products'], grants), [
    'catalog.products.read',
    'catalog.products.write',
  ]);
  assert.deepEqual(permissionsForScopes([], grants), []);
});

test('reinstalling is a fresh consent', () => {
  assert.doesNotThrow(() => assertInstallTransition('installed', 'uninstalled'));
  assert.doesNotThrow(() => assertInstallTransition('uninstalled', 'installed'));
});

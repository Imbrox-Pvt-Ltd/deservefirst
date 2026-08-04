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
  assertChallengeValid,
  assertCodeUsable,
  assertPublishable,
  assertVerifier,
  challengeFor,
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
  webhookUrl: null,
  webhookSecret: null,
  suspendedReason: null,
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
  state: null,
  codeChallenge: null,
  codeChallengeMethod: null,
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

// --- PKCE --------------------------------------------------------------------

test('only S256 is accepted, because plain protects nothing', () => {
  const challenge = challengeFor('a'.repeat(64));

  assert.deepEqual(assertChallengeValid(challenge, 'S256'), { challenge, method: 'S256' });
  // A missing method with a challenge present means S256; that is the default.
  assert.deepEqual(assertChallengeValid(challenge, null), { challenge, method: 'S256' });

  // `plain` sends the verifier as the challenge, so anyone who saw the
  // authorization request can complete the exchange. Offering it would let a
  // client appear to use PKCE while opting out of it.
  assert.throws(() => assertChallengeValid(challenge, 'plain'), /Only the S256/);
  assert.throws(() => assertChallengeValid('short', 'S256'), /not a valid S256 digest/);
  assert.throws(() => assertChallengeValid(null, 'S256'), /needs a challenge/);
});

test('a code issued with a challenge cannot be spent without the verifier', () => {
  const verifier = 'v'.repeat(64);
  const guarded = code({ codeChallenge: challengeFor(verifier), codeChallengeMethod: 'S256' });

  assert.doesNotThrow(() => assertVerifier(guarded, verifier));

  // The most common way PKCE is implemented wrongly: an attacker who
  // intercepted the code simply omits the field and the protection evaporates.
  assert.throws(() => assertVerifier(guarded, null), /requires a code verifier/);
  assert.throws(() => assertVerifier(guarded, 'w'.repeat(64)), /does not match the challenge/);
  assert.throws(() => assertVerifier(guarded, 'short'), /wrong length/);
});

test('a code issued without a challenge rejects a verifier rather than ignoring it', () => {
  // Silently accepting one would hide a client that thinks it is protected.
  assert.throws(() => assertVerifier(code(), 'v'.repeat(64)), /not issued with a code challenge/);
  assert.doesNotThrow(() => assertVerifier(code(), null));
});

// --- restricted scopes -------------------------------------------------------

test('an app asking for a restricted scope cannot be published unapproved', () => {
  const restricted = (scope) => scope === 'read_customer_contact';

  assert.doesNotThrow(() => assertPublishable(app(), restricted, []));

  const sensitive = app({ requestedScopes: ['read_products', 'read_customer_contact'] });
  assert.throws(
    () => assertPublishable(sensitive, restricted, []),
    /read_customer_contact needs platform approval/,
  );
  // Approved for THIS app specifically, not for the scope globally.
  assert.doesNotThrow(() => assertPublishable(sensitive, restricted, ['read_customer_contact']));
});


test('suspending an app stops every token it holds, in every store', () => {
  const now = new Date('2026-02-01');
  const live = token();

  assert.equal(tokenIsUsable(live, installation(), now, app()).ok, true);

  // The installation rows know nothing about a suspension, so without reading
  // the app this would only have blocked NEW installs while every existing
  // token kept working — the opposite of what suspending is for.
  const stopped = tokenIsUsable(live, installation(), now, {
    status: 'suspended',
    suspendedReason: 'Exfiltrating customer data.',
  });
  assert.equal(stopped.ok, false);
  // The reason travels, so the app's author is told what actually happened
  // rather than a list of four things it might be.
  assert.match(stopped.reason, /Exfiltrating customer data/);
});

test('a suspended app cannot be installed either, and says why', () => {
  assert.throws(
    () => assertInstallable(app({ status: 'suspended', suspendedReason: 'Under review.' })),
    /Under review/,
  );
});

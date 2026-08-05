/**
 * Apps · tests/automation.test.mjs
 * What a build server's token may do, and what it must never do.
 *
 * Written on the assumption the token leaks. It lives in CI environment
 * variables, gets printed by a careless `env`, and ends up in a fork's pull
 * request — so the question these pin is not what it can do but how little.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTOMATION_CAPABILITIES,
  assertTokenValid,
  can,
  isUsable,
  pathIsAutomatable,
} from '../../../dist/apps/domain/index.js';

const token = (over = {}) => ({
  id: 't-1', appId: 'app-1', partnerId: 'prt-1', name: 'GitHub Actions',
  tokenHash: 'hash', capabilities: ['versions.write', 'functions.write'],
  lastUsedAt: null, expiresAt: null, revokedAt: null, ...over,
});

test('automation can deploy and nothing else — the list is closed', () => {
  // Anything involving a store is absent by construction, not by omission.
  assert.deepEqual([...AUTOMATION_CAPABILITIES], ['versions.write', 'functions.write']);
});

test('a capability that would read store data cannot be asked for', () => {
  assert.throws(
    () => assertTokenValid(token({ capabilities: ['orders.read'] })),
    /Automation deploys; it does not read store data/,
  );
  assert.throws(() => assertTokenValid(token({ capabilities: [] })), /should not exist/);
});

test('a token needs a name, because that is how you revoke the right one', () => {
  assert.throws(() => assertTokenValid(token({ name: '  ' })), /how you identify this token/);
});

test('revoked and expired are both unusable, and say which', () => {
  const now = new Date('2026-06-01');
  assert.equal(isUsable(token(), now).ok, true);
  assert.equal(isUsable(token({ revokedAt: new Date('2026-05-01') }), now).reason, 'This token was revoked.');
  assert.equal(isUsable(token({ expiresAt: new Date('2026-05-01') }), now).reason, 'This token has expired.');
  // No expiry is allowed: forcing one means every pipeline breaks on a date
  // nobody remembers, and the usual answer to that is a ten-year expiry.
  assert.equal(isUsable(token({ expiresAt: null }), now).ok, true);
});

test('the path gate refuses everything except deploying', () => {
  assert.equal(pathIsAutomatable('/2026-01/partners/p1/apps/a1/versions'), true);
  assert.equal(pathIsAutomatable('/2026-01/partners/p1/apps/a1/functions'), true);
  assert.equal(pathIsAutomatable('/2026-01/partners/p1/versions/v1/release'), true);

  // The cases that matter: a leaked CI token must reach none of these.
  assert.equal(pathIsAutomatable('/2026-01/catalog/products'), false);
  assert.equal(pathIsAutomatable('/2026-01/customers/customers'), false);
  assert.equal(pathIsAutomatable('/2026-01/partners'), false);
  assert.equal(pathIsAutomatable('/2026-01/partners/p1/stores'), false);
  assert.equal(pathIsAutomatable('/2026-01/billing/charges'), false);
});

test('capability and path are separate gates', () => {
  const deployOnly = token({ capabilities: ['versions.write'] });

  assert.equal(can(deployOnly, 'versions.write'), true);
  // Holding one capability is not holding the other, even on an allowed path.
  assert.equal(can(deployOnly, 'functions.write'), false);
});

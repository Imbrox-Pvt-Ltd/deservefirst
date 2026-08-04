/**
 * Auth · tests/partner.test.mjs
 * The two gates, and the ways they could be talked around.
 *
 * Most of these pin refusals rather than behaviour. That is the point: a partner
 * model is only worth anything if the paths it forbids stay forbidden, and every
 * one of these was reachable in some plausible implementation of the same shape.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  afterTransfer,
  assertCanRemoveStaff,
  assertLinkTransition,
  assertLinkValid,
  assertOwnerIsStaff,
  assertPartnerValid,
  assertStaffValid,
  canTransferStore,
  effectiveStorePermissions,
  linkGrantsAccess,
} from '../../../dist/auth/domain/index.js';

const partner = (over = {}) => ({
  id: 'prt-1',
  ownerUserId: 'usr-owner',
  name: 'Northbound Studio',
  status: 'active',
  payoutCurrency: 'GBP',
  websiteUrl: null,
  version: 1,
  ...over,
});

const staff = (over = {}) => ({
  id: 'stf-1',
  userId: 'usr-owner',
  role: 'owner',
  status: 'active',
  ...over,
});

const link = (over = {}) => ({
  id: 'lnk-1',
  storeId: 'sto-1',
  status: 'active',
  accessLevel: 'full',
  permissions: [],
  createdByPartner: false,
  requestedAt: new Date('2026-01-01'),
  decidedAt: new Date('2026-01-02'),
  revokedReason: null,
  ...over,
});

test('a partner needs a name and a real currency', () => {
  assert.throws(() => assertPartnerValid(partner({ name: '  ' })), /name: is required/);
  assert.throws(() => assertPartnerValid(partner({ payoutCurrency: 'GBP ' })), /ISO currency/);
  assert.throws(() => assertPartnerValid(partner({ websiteUrl: 'northbound.studio' })), /absolute URL/);
  // No payout details yet is a normal state, not an invalid one.
  assert.doesNotThrow(() => assertPartnerValid(partner({ payoutCurrency: null })));
});

test('the owner cannot be missing from their own staff list', () => {
  assert.throws(() => assertOwnerIsStaff(partner(), []), /must be a member/);
  assert.throws(
    () => assertOwnerIsStaff(partner(), [staff({ role: 'admin' })]),
    /must hold the owner role/,
  );
  // The failure this prevents is total: no role means no permission passes, and
  // the only person who could repair it is the one locked out.
  assert.throws(() => assertOwnerIsStaff(partner(), [staff({ status: 'removed' })]), /cannot be removed/);
});

test('one owner, and nobody listed twice', () => {
  assert.throws(
    () => assertStaffValid([staff(), staff({ id: 'stf-2', userId: 'usr-2', role: 'owner' })]),
    /only have one owner/,
  );
  assert.throws(
    // Same person, second seat — the role differs so this is the duplicate rule
    // biting, not the one-owner rule.
    () => assertStaffValid([staff(), staff({ id: 'stf-2', role: 'member' })]),
    /listed twice/,
  );
  // A removed member does not block re-inviting the same person.
  assert.doesNotThrow(() =>
    assertStaffValid([staff({ status: 'removed' }), staff({ id: 'stf-2' })]),
  );
});

test('the owner is transferred, never removed', () => {
  assert.throws(
    () => assertCanRemoveStaff(partner(), staff()),
    /transfer ownership first/,
  );
  assert.doesNotThrow(() =>
    assertCanRemoveStaff(partner(), staff({ id: 'stf-2', userId: 'usr-2', role: 'admin' })),
  );
});

test('a partner cannot let itself in', () => {
  // The whole model rests on this: pending grants nothing.
  assert.equal(linkGrantsAccess(link({ status: 'pending' })), false);
  assert.equal(linkGrantsAccess(link({ status: 'active' })), true);
  assert.equal(linkGrantsAccess(link({ status: 'revoked' })), false);
});

test('a store the partner built is theirs until it is not', () => {
  assert.equal(linkGrantsAccess(link({ status: 'pending', createdByPartner: true })), true);
  // Revoked still wins — a merchant who removed them after a transfer means it.
  assert.equal(
    linkGrantsAccess(link({ status: 'revoked', createdByPartner: true, revokedReason: 'ended' })),
    false,
  );
});

test('revoked is terminal', () => {
  assert.doesNotThrow(() => assertLinkTransition('pending', 'active'));
  assert.doesNotThrow(() => assertLinkTransition('active', 'revoked'));
  // Re-admitting a partner is a new grant decided now, not an old one waking up.
  assert.throws(() => assertLinkTransition('revoked', 'active'), /cannot go from revoked to active/);
  assert.throws(() => assertLinkTransition('revoked', 'pending'), /cannot go from revoked/);
});

test('a grant has to actually grant something', () => {
  assert.throws(
    () => assertLinkValid(link({ accessLevel: 'limited', permissions: [] })),
    /grants nothing/,
  );
  assert.throws(
    () => assertLinkValid(link({ accessLevel: 'full', permissions: ['catalog.products.read'] })),
    /would go stale/,
  );
  assert.throws(() => assertLinkValid(link({ status: 'revoked' })), /must say why/);
  // A pending link is a request, not a grant — nothing is filled in yet.
  assert.doesNotThrow(() =>
    assertLinkValid(link({ status: 'pending', accessLevel: 'limited', permissions: [] })),
  );
});

test("the owner's grant is the ceiling, not the floor", () => {
  const roleGrants = ['catalog.products.read', 'catalog.products.write', 'orders.read'];

  assert.deepEqual(effectiveStorePermissions(link(), staff(), roleGrants), roleGrants);

  // A partner ADMIN — the most powerful role the partner has — still cannot
  // reach past what the merchant agreed to.
  assert.deepEqual(
    effectiveStorePermissions(
      link({ accessLevel: 'limited', permissions: ['catalog.products.read'] }),
      staff({ role: 'admin' }),
      roleGrants,
    ),
    ['catalog.products.read'],
  );

  // A permission the merchant granted that the partner's own role does not
  // include is still not available: both gates, every time.
  assert.deepEqual(
    effectiveStorePermissions(
      link({ accessLevel: 'limited', permissions: ['billing.manage'] }),
      staff(),
      roleGrants,
    ),
    [],
  );
});

test('no link and no active membership mean nothing at all', () => {
  const roleGrants = ['catalog.products.read'];
  assert.deepEqual(
    effectiveStorePermissions(link({ status: 'pending' }), staff(), roleGrants),
    [],
  );
  assert.deepEqual(
    effectiveStorePermissions(link(), staff({ status: 'invited' }), roleGrants),
    [],
  );
});

test('only a store they built, and only an admin, can be transferred', () => {
  const built = link({ createdByPartner: true });

  assert.equal(canTransferStore(built, staff()).ok, true);
  assert.equal(canTransferStore(built, staff({ role: 'admin' })).ok, true);
  assert.equal(canTransferStore(built, staff({ role: 'member' })).ok, false);
  // Somebody else's store is not theirs to hand on.
  assert.equal(canTransferStore(link(), staff()).ok, false);
});

test('transfer ends the standing access it was built on', () => {
  const at = new Date('2026-06-01');
  const after = afterTransfer(link({ createdByPartner: true, status: 'active' }), at);

  assert.equal(after.createdByPartner, false);
  assert.equal(after.status, 'pending');
  // The client decides whether the partner stays, exactly as any other store
  // owner would — the partner does not keep a foothold by having built it.
  assert.equal(linkGrantsAccess(after), false);
  assert.equal(after.decidedAt, null);
  assert.doesNotThrow(() => assertLinkValid(after));
});

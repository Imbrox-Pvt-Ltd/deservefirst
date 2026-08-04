/**
 * Auth · tests/access-evaluator.test.mjs
 * The precedence rules of the single access decision. Order matters here: these
 * tests exist so a later refactor cannot quietly let a store enable outrank a
 * plan denial, or a support session outrank its own permission list.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AccessDeniedError, AccessEvaluator } from '../../../dist/auth/application/index.js';

const ports = (overrides = {}) => ({
  isModuleEnabledGlobally: async () => true,
  isModuleEnabledForStore: async () => true,
  isEntitled: async () => true,
  permissionRequiresApproval: () => false,
  supportSessionValid: async () => true,
  ...overrides,
});

const context = (overrides = {}) => ({
  requestId: 'r', correlationId: 'c', actorType: 'user', userId: 'u1',
  organizationId: 'o1', businessEntityId: null, storeId: 's1', partnerId: null,
  accessType: 'member', roleKeys: [], permissions: ['catalog.read'],
  supportSessionId: null, entitlementsHash: null, locale: 'en-US',
  timeZone: 'UTC', shardKey: null,
  ...overrides,
});

test('a store-scoped action without a store context is refused', async () => {
  const evaluator = new AccessEvaluator(ports());
  const decision = await evaluator.evaluate({
    context: context({ storeId: null }),
    permission: 'catalog.read',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'no-store-context');
});

test('organization membership alone does not grant store data access', async () => {
  const evaluator = new AccessEvaluator(ports());
  // Org context present, store context absent — still refused.
  const decision = await evaluator.evaluate({
    context: context({ storeId: null, organizationId: 'o1', permissions: ['catalog.read'] }),
    permission: 'catalog.read',
  });
  assert.equal(decision.allowed, false);
});

test('a request scoped to one store cannot act on another', async () => {
  const evaluator = new AccessEvaluator(ports());
  const decision = await evaluator.evaluate({
    context: context(),
    permission: 'catalog.read',
    targetStoreId: 's2',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'store-mismatch');
});

test('a missing permission is refused, and wildcards are not honoured', async () => {
  const evaluator = new AccessEvaluator(ports());

  const missing = await evaluator.evaluate({ context: context(), permission: 'catalog.write' });
  assert.equal(missing.reason, 'permission-missing');

  // "*" is how a support role quietly becomes an admin role.
  const wildcard = await evaluator.evaluate({
    context: context({ permissions: ['*'] }),
    permission: 'catalog.write',
  });
  assert.equal(wildcard.allowed, false);
});

test('an expired support session is no session, not a reduced one', async () => {
  const evaluator = new AccessEvaluator(ports({ supportSessionValid: async () => false }));
  const decision = await evaluator.evaluate({
    context: context({ supportSessionId: 'sup-1', accessType: 'support' }),
    permission: 'catalog.read',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'support-session-expired');
});

test('support access is bounded by its own explicit permission list', async () => {
  const evaluator = new AccessEvaluator(ports());
  const decision = await evaluator.evaluate({
    context: context({ supportSessionId: 'sup-1', accessType: 'support', permissions: ['store.read'] }),
    permission: 'customers.pii.read',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'permission-missing');
});

test('a global module disable outranks a store enable', async () => {
  const evaluator = new AccessEvaluator(
    ports({ isModuleEnabledGlobally: async () => false, isModuleEnabledForStore: async () => true }),
  );
  const decision = await evaluator.evaluate({
    context: context(),
    permission: 'catalog.read',
    moduleId: 'catalog',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'module-disabled');
});

test('a plan denial outranks a store enable', async () => {
  const evaluator = new AccessEvaluator(
    ports({ isModuleEnabledForStore: async () => true, isEntitled: async () => false }),
  );
  const decision = await evaluator.evaluate({
    context: context(),
    permission: 'catalog.read',
    moduleId: 'catalog',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'not-entitled');
});

test('permission is checked before entitlement, so billing is never the excuse for authz', async () => {
  const evaluator = new AccessEvaluator(ports({ isEntitled: async () => false }));
  const decision = await evaluator.evaluate({
    context: context({ permissions: [] }),
    permission: 'catalog.read',
    moduleId: 'catalog',
  });
  // Both would fail; the answer must be the authorisation one.
  assert.equal(decision.reason, 'permission-missing');
});

test('a sensitive action is allowed but flagged for approval', async () => {
  const evaluator = new AccessEvaluator(ports({ permissionRequiresApproval: () => true }));
  const decision = await evaluator.evaluate({
    context: context({ permissions: ['orders.refund'] }),
    permission: 'orders.refund',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, true);
});

test('assert throws with the right status for each denial class', async () => {
  const denied = new AccessEvaluator(ports());
  await assert.rejects(
    () => denied.assert({ context: context({ permissions: [] }), permission: 'catalog.read' }),
    (error) => error instanceof AccessDeniedError && error.status === 403,
  );

  // Entitlement is a billing problem, and the client should be able to tell.
  const unentitled = new AccessEvaluator(ports({ isEntitled: async () => false }));
  await assert.rejects(
    () => unentitled.assert({ context: context(), permission: 'catalog.read', moduleId: 'catalog' }),
    (error) => error instanceof AccessDeniedError && error.status === 402,
  );
});

test('a fully authorised action passes', async () => {
  const evaluator = new AccessEvaluator(ports());
  const decision = await evaluator.assert({
    context: context(),
    permission: 'catalog.read',
    moduleId: 'catalog',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, false);
});

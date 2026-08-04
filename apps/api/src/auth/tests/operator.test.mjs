/**
 * Auth · tests/operator.test.mjs
 * A merchant is not an operator, and an app is neither.
 *
 * Pins a live cross-tenant defect: `platform.*` permissions were declared in the
 * `organization` category, the seed granted every declared permission to the
 * store owner, and the guard checked only that the permission was present. Each
 * of those three alone would have been a bug; together, one merchant could
 * disable a module for every store on the platform.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPlatformPermission, TENANT_ROLE_CATEGORIES } from '../../../../../packages/contracts/dist/roles.js';

/** The guard the transport applies, stated once so it can be tested. */
function operatorGate(context, permission) {
  if (context.actorType === 'app') return { allow: false, status: 403, reason: 'app' };
  if (context.accessType !== 'platform') return { allow: false, status: 403, reason: 'not-operator' };
  if (!context.permissions.includes(permission)) {
    return { allow: false, status: 403, reason: 'missing-permission' };
  }
  return { allow: true };
}

const NEEDED = 'platform.modules.manage';

test('an operator holding the permission is allowed', () => {
  assert.deepEqual(
    operatorGate({ actorType: 'user', accessType: 'platform', permissions: [NEEDED] }, NEEDED),
    { allow: true },
  );
});

test('a merchant holding the permission is still refused', () => {
  // The case that was live. Even with the permission somehow granted, being a
  // member rather than an operator is disqualifying on its own — so the guard
  // does not depend on the grant having been prevented upstream.
  const verdict = operatorGate(
    { actorType: 'user', accessType: 'member', permissions: [NEEDED] },
    NEEDED,
  );
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'not-operator');
});

test('an app is refused even if its scopes somehow granted the permission', () => {
  const verdict = operatorGate(
    { actorType: 'app', accessType: 'platform', permissions: [NEEDED] },
    NEEDED,
  );
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'app');
});

test('an operator without the specific permission is refused', () => {
  const verdict = operatorGate(
    { actorType: 'user', accessType: 'platform', permissions: ['platform.settings.manage'] },
    NEEDED,
  );
  assert.equal(verdict.reason, 'missing-permission');
});

test('platform is not a tenant category', () => {
  // The rule that makes the grant impossible rather than merely refused.
  assert.equal(TENANT_ROLE_CATEGORIES.includes('platform'), false);
  assert.deepEqual([...TENANT_ROLE_CATEGORIES].sort(), [
    'organization',
    'partner',
    'point-of-sale',
    'store',
  ]);
});

test('what counts as a platform permission is a prefix, not a list', () => {
  // A list is what let the first two escape; a new platform.* permission is
  // covered the day it is declared.
  assert.equal(isPlatformPermission('platform.modules.manage'), true);
  assert.equal(isPlatformPermission('platform.anything.invented.tomorrow'), true);
  assert.equal(isPlatformPermission('store.apps.manage'), false);
  assert.equal(isPlatformPermission('partner.read'), false);
});

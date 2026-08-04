/**
 * Auth · tests/auth-domain.test.mjs
 * The security-critical pure rules. These are the tests most worth having on the
 * platform: a defect here is not a broken screen, it is an account takeover.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBusinessEntityBelongsToOrganization,
  assertPermissionsAllowed,
  assertStepTransition,
  assertStoreTypeTransition,
  assertValidEmail,
  assertValidStoreHandle,
  buildOtpAuthUrl,
  canTransact,
  checkPasswordPolicy,
  describeDevice,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashPassword,
  IdentityRuleError,
  LoginFlowError,
  needsRehash,
  normalizeEmail,
  PermissionCategoryError,
  permissionGroupsFor,
  redeemRecoveryCode,
  requiresApproval,
  sanitizeReturnPath,
  verifyPassword,
  verifyTotp,
} from '../../../dist/auth/domain/index.js';

// --- passwords --------------------------------------------------------------

test('a password hash verifies, and a wrong password does not', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('Correct horse battery staple', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('the same password hashes differently every time', async () => {
  const [a, b] = await Promise.all([hashPassword('a-long-enough-password'), hashPassword('a-long-enough-password')]);
  // Distinct salts — identical hashes would reveal that two users share a password.
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('a-long-enough-password', a), true);
  assert.equal(await verifyPassword('a-long-enough-password', b), true);
});

test('cost parameters travel with the hash so they can be raised later', async () => {
  const hash = await hashPassword('a-long-enough-password');
  assert.match(hash, /^scrypt\$65536\$8\$1\$/);
  assert.equal(needsRehash(hash), false);
  assert.equal(needsRehash('scrypt$16384$8$1$abc$def'), true, 'a weaker hash must be flagged');
  assert.equal(needsRehash('garbage'), true);
});

test('a malformed stored hash fails closed rather than throwing', async () => {
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$x$y$z$salt$hash'), false);
});

test('the password policy favours length over composition theatre', () => {
  assert.equal(checkPasswordPolicy('short').ok, false);
  assert.equal(checkPasswordPolicy('a-perfectly-fine-passphrase').ok, true);
  // No symbol, no digit, no uppercase — and still fine, because it is long.
  assert.equal(checkPasswordPolicy('correct horse battery staple').ok, true);
});

test('the policy rejects common passwords, repeats and self-reference', () => {
  assert.equal(checkPasswordPolicy('password123').ok, false);
  assert.equal(checkPasswordPolicy('aaaaaaaaaaaaaaaa').ok, false);
  const withEmail = checkPasswordPolicy('marcus-is-my-password', { email: 'marcus@example.test' });
  assert.equal(withEmail.ok, false);
  assert.ok(withEmail.problems.some((problem) => /email/.test(problem)));
});

test('an unbounded password is refused — a slow KDF is a DoS surface', () => {
  assert.equal(checkPasswordPolicy('x'.repeat(500)).ok, false);
});

// --- TOTP -------------------------------------------------------------------

test('a generated TOTP verifies, and a wrong one does not', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  assert.equal(verifyTotp(secret, generateTotp(secret, now), now), true);
  assert.equal(verifyTotp(secret, '000000', now), false);
});

test('TOTP tolerates one step of clock drift but not two', () => {
  const secret = generateTotpSecret();
  const now = 1_770_000_000_000;
  const code = generateTotp(secret, now);

  assert.equal(verifyTotp(secret, code, now + 30_000), true, 'one step ahead must pass');
  assert.equal(verifyTotp(secret, code, now - 30_000), true, 'one step behind must pass');
  assert.equal(verifyTotp(secret, code, now + 90_000), false, 'three steps must fail');
});

test('malformed TOTP input is rejected without throwing', () => {
  const secret = generateTotpSecret();
  for (const bad of ['', 'abcdef', '12345', '1234567', '12 34 56 78']) {
    assert.equal(verifyTotp(secret, bad), false);
  }
});

test('the otpauth URL carries the parameters an authenticator needs', () => {
  const url = buildOtpAuthUrl({ secret: 'ABCD', accountName: 'dev@example.test', issuer: 'Platform' });
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, /secret=ABCD/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);
});

// --- recovery codes ---------------------------------------------------------

test('recovery codes are single use', () => {
  const { plaintext, hashes } = generateRecoveryCodes(3);
  assert.equal(plaintext.length, 3);
  assert.equal(hashes.length, 3);

  const first = redeemRecoveryCode(plaintext[0], hashes);
  assert.equal(first.redeemed, true);
  assert.equal(first.remaining.length, 2);

  // The same code must not work twice.
  const again = redeemRecoveryCode(plaintext[0], first.remaining);
  assert.equal(again.redeemed, false);
  assert.equal(again.remaining.length, 2);
});

test('recovery codes ignore formatting and case as typed by a human', () => {
  const { plaintext, hashes } = generateRecoveryCodes(1);
  const messy = ` ${plaintext[0].toLowerCase().replace('-', ' ')} `;
  assert.equal(redeemRecoveryCode(messy, hashes).redeemed, true);
});

test('recovery codes avoid ambiguous characters', () => {
  const { plaintext } = generateRecoveryCodes(20);
  for (const code of plaintext) {
    assert.doesNotMatch(code, /[IO01]/, `"${code}" contains a character that is misread aloud`);
  }
});

// --- login flow -------------------------------------------------------------

test('a login flow may only move along declared steps', () => {
  assert.doesNotThrow(() => assertStepTransition('lookup', 'password', 'r1'));
  assert.doesNotThrow(() => assertStepTransition('password', 'mfa', 'r1'));
  // The critical one: you cannot skip the MFA challenge by posting to complete.
  assert.throws(() => assertStepTransition('lookup', 'complete', 'r1'), LoginFlowError);
  assert.throws(() => assertStepTransition('complete', 'password', 'r1'), LoginFlowError);
});

test('returnPath refuses anything that could become an open redirect', () => {
  assert.equal(sanitizeReturnPath('/store/acme/products'), '/store/acme/products');
  assert.equal(sanitizeReturnPath('%2Fstore%2Facme'), '/store/acme');

  for (const hostile of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/path\nSet-Cookie: x=y',
    null,
    undefined,
    '',
  ]) {
    assert.equal(sanitizeReturnPath(hostile), null, `"${hostile}" must not be returned to`);
  }
});

test('device labels are readable', () => {
  assert.equal(describeDevice(null), 'Unknown device');
  assert.match(describeDevice('Mozilla/5.0 (Macintosh) Chrome/120.0'), /Chrome on macOS/);
});

// --- identity rules ---------------------------------------------------------

test('emails normalise so one person cannot register twice', () => {
  assert.equal(normalizeEmail('  Dev@Example.TEST '), 'dev@example.test');
  assert.doesNotThrow(() => assertValidEmail('dev@example.test'));
  assert.throws(() => assertValidEmail('not-an-email'), IdentityRuleError);
});

test('store handles cannot shadow platform routes', () => {
  assert.doesNotThrow(() => assertValidStoreHandle('acme-supplies'));
  assert.throws(() => assertValidStoreHandle('settings'), /reserved/);
  assert.throws(() => assertValidStoreHandle('admin'), /reserved/);
  assert.throws(() => assertValidStoreHandle('-leading'), /must be 3–63/);
  assert.throws(() => assertValidStoreHandle('ab'), /must be 3–63/);
});

test('a store cannot borrow another organization\'s legal entity', () => {
  const store = { organizationId: 'org-1' };
  assert.doesNotThrow(() =>
    assertBusinessEntityBelongsToOrganization(store, { organizationId: 'org-1', archivedAt: null }),
  );
  assert.throws(
    () => assertBusinessEntityBelongsToOrganization(store, { organizationId: 'org-2', archivedAt: null }),
    /different organization/,
  );
  assert.throws(
    () => assertBusinessEntityBelongsToOrganization(store, { organizationId: 'org-1', archivedAt: new Date() }),
    /archived/,
  );
});

test('a development store cannot transact, and a live one needs a legal entity', () => {
  const base = {
    id: 's1', organizationId: 'o1', handle: 'acme', name: 'Acme',
    status: 'active', defaultLocale: 'en-US', timeZone: 'UTC',
    baseCurrency: 'USD', featurePreviews: [], createdAt: new Date(),
  };

  assert.equal(canTransact({ ...base, type: 'development', businessEntityId: 'be-1' }).ok, false);
  assert.equal(canTransact({ ...base, type: 'live', businessEntityId: null }).ok, false);
  assert.equal(canTransact({ ...base, type: 'live', businessEntityId: 'be-1' }).ok, true);
  assert.equal(canTransact({ ...base, type: 'live', businessEntityId: 'be-1', status: 'paused' }).ok, false);
});

test('store type transitions follow the declared path', () => {
  assert.doesNotThrow(() => assertStoreTypeTransition('development', 'live'));
  assert.doesNotThrow(() => assertStoreTypeTransition('client_transfer', 'live'));
  assert.throws(() => assertStoreTypeTransition('live', 'development'), /cannot move from live/);
});

// --- permissions ------------------------------------------------------------

test('role categories gate which permissions may be granted', () => {
  assert.doesNotThrow(() => assertPermissionsAllowed('organization', ['organization.users.manage']));
  assert.doesNotThrow(() => assertPermissionsAllowed('point-of-sale', ['pos.register.open']));

  // A register permission on an organization role would silently never apply.
  assert.throws(
    () => assertPermissionsAllowed('organization', ['pos.register.open']),
    PermissionCategoryError,
  );
  assert.throws(() => assertPermissionsAllowed('store', ['made.up.permission']), PermissionCategoryError);
});

test('each category exposes its own permission tree', () => {
  const pos = permissionGroupsFor('point-of-sale').map((group) => group.label);
  const org = permissionGroupsFor('organization').map((group) => group.label);

  assert.ok(pos.includes('Register'));
  assert.ok(pos.includes('Checkout'));
  assert.ok(!org.includes('Register'), 'register permissions must not appear on organization roles');
  assert.ok(org.includes('Organization'));
  assert.ok(org.includes('Stores'));
});

test('money-touching permissions are marked as needing approval', () => {
  assert.equal(requiresApproval('orders.refund'), true);
  assert.equal(requiresApproval('pos.register.cash.remove'), true);
  assert.equal(requiresApproval('customers.pii.read'), true);
  assert.equal(requiresApproval('orders.read'), false);
  assert.equal(requiresApproval('analytics.read'), false);
});

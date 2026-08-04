/**
 * Customers · tests/manifest.test.mjs
 * The cross-module composition proof, plus the consent rules — which are the
 * part of this module with legal consequences rather than merely functional ones.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@deservefirst/contracts';

import { ModuleRegistry } from '../../../../dist/core/module-registry/registry.js';
import { catalogManifest } from '../../../../dist/modules/catalog/catalog.manifest.js';
import { customersManifest } from '../../../../dist/modules/customers/customers.manifest.js';
import { customerResource } from '../../../../dist/modules/customers/contracts/index.js';
import {
  assertCustomerValid,
  assertSegmentValid,
  canEmailMarketing,
  canSmsMarketing,
  CustomerInvariantError,
  displayName,
  matchesSegment,
  normalizeCustomerEmail,
} from '../../../../dist/modules/customers/domain/index.js';

test('the manifest satisfies every capability contract it declares', () => {
  assert.deepEqual(validateManifest(customersManifest).errors, []);
});

// --- cross-module composition ----------------------------------------------

test('two independent modules compose into one admin', () => {
  const registry = new ModuleRegistry();
  registry.register(catalogManifest);
  registry.register(customersManifest);
  registry.seal();

  // Navigation merges and sorts by declared position, across modules.
  const nav = registry.navigation().map((entry) => `${entry.moduleId}:${entry.item.label}`);
  assert.deepEqual(nav, ['catalog:Products', 'catalog:Collections', 'customers:Customers']);

  // Settings from both modules land in their declared groups without either
  // module knowing the other exists.
  const groups = new Set(registry.settings().map((entry) => entry.item.group));
  assert.ok(groups.has('general'));
  assert.ok(groups.has('customer_accounts'));

  // Every route's permission resolves against the union of both manifests.
  const permissions = new Set(registry.permissions().map((entry) => entry.item.key));
  for (const entry of registry.routes()) {
    assert.ok(permissions.has(entry.item.permission), `undeclared ${entry.item.permission}`);
  }

  // Both modules' tables are store-scoped and none collide.
  const tables = registry.storeScopedTables();
  assert.equal(new Set(tables).size, tables.length, 'two modules claimed the same table');
  assert.ok(tables.includes('products'));
  assert.ok(tables.includes('customers'));
});

test('an unmet optional dependency degrades only the dependent module', () => {
  // Customers declares catalog optional. Without catalog registered, customers
  // degrades and the platform still boots.
  const registry = new ModuleRegistry();
  registry.register(customersManifest);
  const sealed = registry.seal();

  assert.equal(sealed[0].enabled, false);
  assert.match(sealed[0].degradedReason, /depends on "catalog"/);
});

test('with catalog present, customers is enabled', () => {
  const registry = new ModuleRegistry();
  registry.register(catalogManifest);
  registry.register(customersManifest);
  registry.seal();
  assert.equal(registry.get('customers').enabled, true);
});

test('a private field never reaches the public surface', () => {
  const note = customerResource.fields.find((field) => field.name === 'note');
  assert.equal(note.visibility, 'private');
});

// --- consent ----------------------------------------------------------------

const customer = (overrides = {}) => ({
  id: 'c1',
  email: 'shopper@example.test',
  phone: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  state: 'active',
  emailConsent: 'unknown',
  smsConsent: 'unknown',
  locale: 'en-US',
  note: null,
  taxExempt: false,
  defaultAddress: null,
  addresses: [],
  ordersCount: 0,
  totalSpent: { amountMinor: 0n, currency: 'USD' },
  version: 1,
  ...overrides,
});

test('only an explicit subscription permits marketing', () => {
  // "unknown" and "pending" are not consent, and treating them as such is how a
  // platform earns a fine.
  for (const state of ['unknown', 'pending', 'not-subscribed']) {
    assert.equal(canEmailMarketing(customer({ emailConsent: state })), false, state);
  }
  assert.equal(canEmailMarketing(customer({ emailConsent: 'subscribed' })), true);
});

test('consent without a reachable channel is not consent', () => {
  // Subscribed but no address to send to.
  assert.equal(canEmailMarketing(customer({ emailConsent: 'subscribed', email: null, phone: '123' })), false);
  assert.equal(canSmsMarketing(customer({ smsConsent: 'subscribed', phone: null })), false);
  assert.equal(canSmsMarketing(customer({ smsConsent: 'subscribed', phone: '+15550000' })), true);
});

// --- invariants -------------------------------------------------------------

test('a customer must be contactable somehow', () => {
  assert.throws(
    () => assertCustomerValid(customer({ email: null, phone: null })),
    /needs an email address or a phone number/,
  );
  assert.doesNotThrow(() => assertCustomerValid(customer({ email: null, phone: '+15550000' })));
});

test('a malformed email is refused', () => {
  assert.throws(() => assertCustomerValid(customer({ email: 'not-an-email' })), CustomerInvariantError);
});

test('negative spend or order counts are refused', () => {
  assert.throws(
    () => assertCustomerValid(customer({ totalSpent: { amountMinor: -1n, currency: 'USD' } })),
    /cannot be negative/,
  );
  assert.throws(() => assertCustomerValid(customer({ ordersCount: -1 })), /cannot be negative/);
});

test('addresses need a street, a city and an ISO country', () => {
  const address = { firstName: null, lastName: null, company: null, line1: '1 Main St', line2: null, city: 'Denver', province: 'CO', countryCode: 'US', postalCode: '80202', phone: null };
  assert.doesNotThrow(() => assertCustomerValid(customer({ addresses: [address] })));
  assert.throws(() => assertCustomerValid(customer({ addresses: [{ ...address, line1: '  ' }] })), /street address/);
  assert.throws(() => assertCustomerValid(customer({ addresses: [{ ...address, countryCode: 'USA' }] })), /two-letter ISO/);
});

test('emails normalise so one shopper is not two records', () => {
  assert.equal(normalizeCustomerEmail('  Shopper@Example.TEST '), 'shopper@example.test');
});

test('display name falls back rather than showing blank', () => {
  assert.equal(displayName(customer()), 'Ada Lovelace');
  assert.equal(displayName(customer({ firstName: null, lastName: null })), 'shopper@example.test');
  assert.equal(displayName(customer({ firstName: null, lastName: null, email: null, phone: '+1' })), '+1');
});

// --- segments ---------------------------------------------------------------

test('segments match on exact minor units, not formatted money', () => {
  const segment = {
    id: 's1', name: 'Big spenders', match: 'all',
    conditions: [{ field: 'totalSpent', operator: 'greaterThan', value: '10000' }],
  };
  assert.equal(matchesSegment(customer({ totalSpent: { amountMinor: 15000n, currency: 'USD' } }), segment), true);
  assert.equal(matchesSegment(customer({ totalSpent: { amountMinor: 5000n, currency: 'USD' } }), segment), false);
});

test('segment match modes behave', () => {
  const conditions = [
    { field: 'ordersCount', operator: 'greaterThan', value: '0' },
    { field: 'emailConsent', operator: 'equals', value: 'subscribed' },
  ];
  const subject = customer({ ordersCount: 3, emailConsent: 'unknown' });

  assert.equal(matchesSegment(subject, { id: 's', name: 'n', match: 'all', conditions }), false);
  assert.equal(matchesSegment(subject, { id: 's', name: 'n', match: 'any', conditions }), true);
});

test('a segment needs a name and at least one condition', () => {
  assert.throws(() => assertSegmentValid({ id: 's', name: '', match: 'all', conditions: [] }), /needs a name/);
  assert.throws(
    () => assertSegmentValid({ id: 's', name: 'n', match: 'all', conditions: [] }),
    /at least one condition/,
  );
});

test('numeric operators are refused on text segment fields', () => {
  assert.throws(
    () =>
      assertSegmentValid({
        id: 's', name: 'n', match: 'all',
        conditions: [{ field: 'state', operator: 'greaterThan', value: '1' }],
      }),
    /only applies to numeric fields/,
  );
});

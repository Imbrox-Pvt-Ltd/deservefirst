/**
 * Customers · tests/company.test.mjs
 * The B2B aggregate's invariants.
 *
 * These pin the rules that only bite at the worst moment — an order with no
 * default location to ship to, a viewer who can commit money, a closed account
 * quietly reopening on its old credit limit.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertCompanyValid,
  assertStatusTransition,
  canOrder,
  defaultLocation,
  locationsFor,
} from '../../../../dist/modules/customers/domain/index.js';

const location = (over = {}) => ({
  id: 'loc-1',
  name: 'Head office',
  addressLine1: null,
  city: null,
  countryCode: 'GB',
  paymentTerms: 'net-30',
  creditLimitMinor: null,
  isDefault: true,
  ...over,
});

const contact = (over = {}) => ({
  id: 'con-1',
  customerId: 'cus-1',
  role: 'ordering',
  locationIds: [],
  isPrimary: true,
  ...over,
});

const company = (over = {}) => ({
  id: 'co-1',
  name: 'Northwind Trading',
  externalId: null,
  status: 'active',
  note: null,
  locations: [location()],
  contacts: [contact()],
  version: 1,
  ...over,
});

test('a trading company needs somewhere to ship', () => {
  assert.throws(() => assertCompanyValid(company({ locations: [], contacts: [] })), /at least one location/);
  // A closed one does not: the relationship has ended, and demanding an address
  // for it would block closing the account.
  assert.doesNotThrow(() =>
    assertCompanyValid(company({ status: 'closed', locations: [], contacts: [] })),
  );
});

test('exactly one location is the default', () => {
  assert.throws(
    () =>
      assertCompanyValid(
        company({ locations: [location(), location({ id: 'loc-2', name: 'Depot' })] }),
      ),
    /only one location can be the default/,
  );
  assert.throws(
    () => assertCompanyValid(company({ locations: [location({ isDefault: false })] })),
    /one location must be the default/,
  );
});

test('two locations cannot share a name', () => {
  assert.throws(
    () =>
      assertCompanyValid(
        company({
          locations: [location(), location({ id: 'loc-2', name: 'head office', isDefault: false })],
        }),
      ),
    /both called/,
  );
});

test('a location needs a real country and a non-negative limit', () => {
  assert.throws(
    () => assertCompanyValid(company({ locations: [location({ countryCode: 'GBR' })] })),
    /two-letter ISO country code/,
  );
  assert.throws(
    () => assertCompanyValid(company({ locations: [location({ creditLimitMinor: -1n })] })),
    /negative credit limit/,
  );
  // Null is "no agreed ceiling", which is not a ceiling of zero.
  assert.doesNotThrow(() =>
    assertCompanyValid(company({ locations: [location({ creditLimitMinor: null })] })),
  );
});

test('the same person is not listed twice', () => {
  assert.throws(
    () =>
      assertCompanyValid(
        company({ contacts: [contact(), contact({ id: 'con-2', isPrimary: false })] }),
      ),
    /listed twice/,
  );
});

test('a contact cannot be assigned to a location the company does not have', () => {
  assert.throws(
    () => assertCompanyValid(company({ contacts: [contact({ locationIds: ['loc-nope'] })] })),
    /a location this company does not have/,
  );
});

test('only one contact is primary', () => {
  assert.throws(
    () =>
      assertCompanyValid(
        company({
          contacts: [contact(), contact({ id: 'con-2', customerId: 'cus-2', isPrimary: true })],
        }),
      ),
    /only one contact can be the primary/,
  );
});

test('an empty assignment means every location, not none', () => {
  const record = company({
    locations: [location(), location({ id: 'loc-2', name: 'Depot', isDefault: false })],
  });

  assert.equal(locationsFor(record, contact({ locationIds: [] })).length, 2);
  assert.equal(locationsFor(record, contact({ locationIds: ['loc-2'] })).length, 1);
});

test('ordering needs a trading company, the right role, and the right location', () => {
  const record = company({
    locations: [location(), location({ id: 'loc-2', name: 'Depot', isDefault: false })],
  });

  assert.equal(canOrder(record, contact({ locationIds: ['loc-1'] }), 'loc-1'), true);
  // Assigned to one site does not mean able to commit money at another.
  assert.equal(canOrder(record, contact({ locationIds: ['loc-1'] }), 'loc-2'), false);
  assert.equal(canOrder(record, contact({ role: 'viewing' }), 'loc-1'), false);
  assert.equal(canOrder(company({ status: 'on-hold' }), contact(), 'loc-1'), false);
});

test('on hold stops orders without ending the relationship', () => {
  assert.doesNotThrow(() => assertStatusTransition('active', 'on-hold'));
  assert.doesNotThrow(() => assertStatusTransition('on-hold', 'active'));
  // The terms are still there when it resumes.
  assert.equal(defaultLocation(company({ status: 'on-hold' }))?.paymentTerms, 'net-30');
});

test('closed is final', () => {
  assert.doesNotThrow(() => assertStatusTransition('active', 'closed'));
  assert.throws(() => assertStatusTransition('closed', 'active'), /cannot go from closed to active/);
  // Reopening is a new relationship with new terms; silently restoring the old
  // credit limit is how a lapsed one comes back.
  assert.throws(() => assertStatusTransition('closed', 'on-hold'), /cannot go from closed/);
});

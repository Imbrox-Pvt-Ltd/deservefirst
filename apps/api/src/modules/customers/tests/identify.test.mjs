/**
 * Customers · tests/identify.test.mjs
 * The person behind an enquiry.
 *
 * Phase 1 is request-only (§25): a shopper leaves an email with a request and
 * never signs in. Without this a merchant receiving three enquiries from one
 * address saw three unrelated rows and no customer at all — a pile of forms
 * rather than a contact list.
 *
 * The two things that must not go wrong are both about consent and identity:
 * enquiring twice must not create two people, and enquiring at all must not
 * subscribe anybody to anything.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CustomerService } from '../../../../dist/modules/customers/application/index.js';

/** An in-memory contact list, keyed the way the real repository keys it. */
function repository(seed = []) {
  const rows = [...seed];
  return {
    rows,
    async findByEmail(email) {
      return rows.find((row) => row.email === email) ?? null;
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async insert(customer) {
      rows.push(customer);
      return customer;
    },
    async update(customer) {
      const at = rows.findIndex((row) => row.id === customer.id);
      rows[at] = customer;
      return customer;
    },
  };
}

const emitted = [];

function serviceOn(repo) {
  let next = 0;
  return new CustomerService(
    repo,
    {
      newId: () => `cus_${++next}`,
      now: () => new Date('2026-08-06T00:00:00.000Z'),
      recordTimeline: async () => {},
      emit: async (type, payload) => {
        emitted.push({ type, payload });
      },
    },
    'store_1',
  );
}

test('a first enquiry creates the person', async () => {
  const repo = repository();
  const customer = await serviceOn(repo).identify({
    email: 'grace@example.com',
    name: 'Grace Hopper',
  });

  assert.equal(customer.email, 'grace@example.com');
  assert.equal(repo.rows.length, 1);
});

test('enquiring twice is one person, not two', async () => {
  /**
   * `create` refuses a duplicate, correctly — staff adding somebody who already
   * exists have made a mistake. A shopper enquiring for the second time has
   * not, and refusing them would lose the enquiry.
   */
  const repo = repository();
  const service = serviceOn(repo);

  const first = await service.identify({ email: 'grace@example.com', name: 'Grace' });
  const second = await service.identify({ email: 'grace@example.com', name: 'Grace Hopper' });

  assert.equal(first.id, second.id);
  assert.equal(repo.rows.length, 1, 'one record, however many times they ask');
});

test('an address is matched however it was typed', async () => {
  const repo = repository();
  const service = serviceOn(repo);

  const first = await service.identify({ email: 'Grace@Example.com' });
  const second = await service.identify({ email: '  grace@example.com ' });

  assert.equal(first.id, second.id);
  assert.equal(repo.rows.length, 1);
});

test('leaving an email to ask a question is not subscribing', async () => {
  /**
   * The consequence of getting this wrong is a marketing send to somebody who
   * only ever asked a question — which is the kind of mistake that arrives as a
   * complaint rather than a bug report.
   */
  const customer = await serviceOn(repository()).identify({ email: 'grace@example.com' });
  assert.equal(customer.emailConsent, 'unknown');
  assert.equal(customer.smsConsent, 'unknown');
});

test('an enquiry never resubscribes somebody who opted out', async () => {
  /**
   * The existing record is returned untouched. Re-creating it, or "refreshing"
   * consent from an enquiry, would silently undo a withdrawal.
   */
  const repo = repository([
    {
      id: 'cus_existing', email: 'grace@example.com', emailConsent: 'not_subscribed',
      smsConsent: 'not_subscribed', firstName: 'Grace', lastName: null, version: 4,
    },
  ]);

  const customer = await serviceOn(repo).identify({ email: 'grace@example.com', name: 'Someone' });

  assert.equal(customer.id, 'cus_existing');
  assert.equal(customer.emailConsent, 'not_subscribed', 'still opted out');
  assert.equal(customer.firstName, 'Grace', 'and their own name is not overwritten');
});

test('an enquirer has no account', async () => {
  /**
   * They never signed in and have no password — `disabled` is the honest state
   * for somebody the merchant has heard from but who cannot log in, and Phase 1
   * has nowhere for them to log in to.
   */
  const customer = await serviceOn(repository()).identify({ email: 'grace@example.com' });
  assert.equal(customer.state, 'disabled');
});

test('a name given as one field is never split', async () => {
  /**
   * We were handed one string and have no way to know which part is a family
   * name. Plenty of names do not divide into two at a space, and guessing
   * renders somebody's name back to them wrong.
   */
  const customer = await serviceOn(repository()).identify({
    email: 'grace@example.com',
    name: 'Grace Brewster Murray Hopper',
  });

  assert.equal(customer.firstName, 'Grace Brewster Murray Hopper');
  assert.equal(customer.lastName, null);
});

test('an enquiry with no name still records the person', async () => {
  const customer = await serviceOn(repository()).identify({ email: 'grace@example.com', name: '  ' });
  assert.equal(customer.firstName, null);
  assert.equal(customer.email, 'grace@example.com');
});

/**
 * Billing · tests/charge.test.mjs
 * The rules that decide whether a merchant was charged what they agreed to.
 *
 * Every case here is a way money moves that nobody approved, or fails to move
 * when it should. They are written as refusals because that is what most of
 * this module is: the permissive version of each rule is a one-line change and
 * none of them would show up as a broken screen.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { money, toDecimalString } from '../../../../../packages/contracts/dist/money.js';
import {
  amountDue,
  approve,
  assertChargeValid,
  assertTransition,
  cancel,
  isBillable,
  recordUsage,
  remainingCap,
  startNextPeriod,
  unusedCredit,
} from '../../../dist/billing/domain/index.js';

const usd = (minor) => money(BigInt(minor), 'USD');

const charge = (over = {}) => ({
  id: 'ch-1', appId: 'app-1', storeId: 'sto-1', kind: 'recurring', name: 'Pro plan',
  status: 'pending', price: usd(2900), interval: 'every_30_days', cappedAmount: null,
  balanceUsed: usd(0), trialDays: 0, activatedAt: null, currentPeriodEnd: null,
  cancelledAt: null, isTest: false, version: 1, ...over,
});

test('a charge needs a name the merchant can read before approving', () => {
  assert.throws(() => assertChargeValid(charge({ name: '  ' })), /the merchant reads it/);
});

test('uncapped usage billing is refused — it is a blank cheque', () => {
  assert.throws(
    () => assertChargeValid(charge({ kind: 'usage', cappedAmount: null })),
    /needs a cap the merchant approves/,
  );
  assert.doesNotThrow(() =>
    assertChargeValid(charge({ kind: 'usage', cappedAmount: usd(10000) })),
  );
  // The cap and the price must be the same currency, or the comparison that
  // enforces it is meaningless.
  assert.throws(
    () => assertChargeValid(charge({ kind: 'usage', cappedAmount: money(10000n, 'EUR') })),
    /same currency/,
  );
});

test('a recurring charge of nothing is not a charge', () => {
  assert.throws(() => assertChargeValid(charge({ price: usd(0) })), /should not be a charge/);
  assert.throws(() => assertChargeValid(charge({ interval: null })), /needs an interval/);
  assert.throws(() => assertChargeValid(charge({ price: usd(-100) })), /cannot be negative/);
});

test('a one-time charge neither repeats nor trials', () => {
  assert.doesNotThrow(() =>
    assertChargeValid(charge({ kind: 'one_time', interval: null, trialDays: 0 })),
  );
  assert.throws(
    () => assertChargeValid(charge({ kind: 'one_time', trialDays: 7, interval: null })),
    /cannot have a trial/,
  );
  assert.throws(() => assertChargeValid(charge({ kind: 'one_time' })), /does not repeat/);
});

test('declined and cancelled are terminal, and distinct', () => {
  assert.doesNotThrow(() => assertTransition('pending', 'active'));
  assert.doesNotThrow(() => assertTransition('active', 'cancelled'));

  // Re-approving a declined charge would let an app re-ask by flipping a status
  // rather than creating a new charge the merchant sees fresh.
  assert.throws(() => assertTransition('declined', 'active'), /cannot go from declined to active/);
  assert.throws(() => assertTransition('cancelled', 'active'), /cannot go from cancelled/);
});

test('the trial runs from approval, not from creation', () => {
  const created = new Date('2026-01-01');
  const approvedAt = new Date('2026-01-08');
  const active = approve(charge({ trialDays: 14 }), approvedAt);

  // An app that leaves a charge pending for a week must not silently consume
  // the merchant's trial.
  assert.equal(isBillable(active, new Date('2026-01-20')), false, 'still in trial');
  assert.equal(isBillable(active, new Date('2026-01-23')), true, 'trial over');
  assert.equal(active.activatedAt?.toISOString(), approvedAt.toISOString());
  assert.notEqual(created.getTime(), approvedAt.getTime());
});

test('an active charge cannot be approved again', () => {
  const active = approve(charge({ trialDays: 14 }), new Date('2026-01-01'));

  // `assertTransition` returns early when nothing changes, which is right for
  // an idempotent status set and wrong here: approving recomputes the trial and
  // the period end, so a second click would grant another free trial and move
  // the billing date. Money, from a double-submit.
  assert.throws(() => approve(active, new Date('2026-02-01')), /already approved/);
});

test('usage over the cap is refused, never truncated', () => {
  const at = new Date('2026-01-10');
  const active = approve(
    charge({ kind: 'usage', price: usd(0), cappedAmount: usd(5000) }),
    new Date('2026-01-01'),
  );

  const used = recordUsage(active, usd(3000), at);
  assert.equal(toDecimalString(used.balanceUsed), '30.00');
  assert.equal(toDecimalString(remainingCap(used)), '20.00');

  // Truncating would bill the cap and discard the rest — it reads as working
  // until somebody reconciles, and the app cannot tell it happened.
  assert.throws(() => recordUsage(used, usd(2500), at), /exceed the cap/);
  // Exactly the cap is fine.
  assert.doesNotThrow(() => recordUsage(used, usd(2000), at));
});

test('usage cannot be recorded against the wrong thing, or after the period', () => {
  const active = approve(
    charge({ kind: 'usage', price: usd(0), cappedAmount: usd(5000) }),
    new Date('2026-01-01'),
  );

  assert.throws(() => recordUsage(charge(), usd(100), new Date()), /usage charge/);
  assert.throws(
    () => recordUsage({ ...active, status: 'pending' }, usd(100), new Date('2026-01-10')),
    /not active/,
  );
  assert.throws(
    () => recordUsage(active, money(100n, 'EUR'), new Date('2026-01-10')),
    /charge currency/,
  );
  assert.throws(() => recordUsage(active, usd(0), new Date('2026-01-10')), /must be positive/);
  assert.throws(() => recordUsage(active, usd(100), new Date('2026-06-01')), /period has ended/);
});

test('the cap resets with the period rather than rolling over', () => {
  const active = approve(
    charge({ kind: 'usage', price: usd(0), cappedAmount: usd(5000) }),
    new Date('2026-01-01'),
  );
  const used = recordUsage(active, usd(4000), new Date('2026-01-10'));
  const next = startNextPeriod(used, new Date('2026-01-31'));

  assert.equal(toDecimalString(next.balanceUsed), '0.00');
  assert.equal(toDecimalString(remainingCap(next)), '50.00');
});

test('leaving mid-period credits the unused whole days', () => {
  const active = approve(charge({ price: usd(3000) }), new Date('2026-01-01'));
  // 30-day period, 29.00 charged. Halfway leaves roughly half.
  const halfway = unusedCredit(active, new Date('2026-01-16'));
  assert.equal(toDecimalString(halfway), '15.00');

  // Past the end is not a credit — owing money back for time already used is a
  // refund, and that is a decision a person makes.
  assert.equal(toDecimalString(unusedCredit(active, new Date('2026-03-01'))), '0.00');
  // A charge nobody approved has nothing to credit.
  assert.equal(toDecimalString(unusedCredit(charge(), new Date('2026-01-16'))), '0.00');
});

test('a test charge never bills, however active it looks', () => {
  const live = approve(charge(), new Date('2026-01-01'));
  const test = approve(charge({ isTest: true }), new Date('2026-01-01'));
  const at = new Date('2026-01-15');

  assert.equal(isBillable(live, at), true);
  assert.equal(toDecimalString(amountDue(live, at)), '29.00');

  // Forgetting this check is how a partner's demo becomes a merchant's invoice.
  assert.equal(isBillable(test, at), false);
  assert.equal(toDecimalString(amountDue(test, at)), '0.00');
});

test('a usage charge bills what was used, a recurring one bills its price', () => {
  const at = new Date('2026-01-15');
  const usage = recordUsage(
    approve(charge({ kind: 'usage', price: usd(0), cappedAmount: usd(9000) }), new Date('2026-01-01')),
    usd(1234),
    at,
  );

  assert.equal(toDecimalString(amountDue(usage, at)), '12.34');
  assert.equal(toDecimalString(amountDue(cancel(usage, at), at)), '0.00');
});

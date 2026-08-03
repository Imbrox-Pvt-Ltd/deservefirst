/**
 * Contracts · tests/money.test.mjs
 * Money is integer minor units by law (§15.2). These tests pin the behaviour that
 * makes that worth having: no float drift, no silent cross-currency arithmetic,
 * and no implicit rounding.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMoney,
  applyRate,
  compareMoney,
  currencyExponent,
  money,
  moneyFromDecimalString,
  multiplyMoney,
  subtractMoney,
  toDecimalString,
} from '../dist/index.js';

test('parses decimal strings without touching a float', () => {
  assert.equal(moneyFromDecimalString('19.99', 'USD').amountMinor, 1999n);
  assert.equal(moneyFromDecimalString('0.01', 'USD').amountMinor, 1n);
  assert.equal(moneyFromDecimalString('-5.50', 'USD').amountMinor, -550n);
  assert.equal(moneyFromDecimalString('1000', 'JPY').amountMinor, 1000n);
  assert.equal(moneyFromDecimalString('1.234', 'KWD').amountMinor, 1234n);
});

test('rejects amounts more precise than the currency allows', () => {
  assert.throws(() => moneyFromDecimalString('1.999', 'USD'), /more precision than USD/);
  assert.throws(() => moneyFromDecimalString('1.5', 'JPY'), /more precision than JPY/);
});

test('knows currency exponents', () => {
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('KWD'), 3);
});

test('refuses to combine different currencies', () => {
  const usd = money(100n, 'USD');
  const inr = money(100n, 'INR');
  assert.throws(() => addMoney(usd, inr), /Cannot combine USD with INR/);
  assert.throws(() => subtractMoney(usd, inr), /Cannot combine/);
  assert.throws(() => compareMoney(usd, inr), /Cannot combine/);
});

test('the classic float trap does not apply', () => {
  // 0.1 + 0.2 !== 0.3 in binary floating point; in minor units it is exact.
  const total = addMoney(moneyFromDecimalString('0.10', 'USD'), moneyFromDecimalString('0.20', 'USD'));
  assert.equal(total.amountMinor, 30n);
  assert.equal(toDecimalString(total), '0.30');
});

test('multiplies by integer quantity and refuses fractions', () => {
  assert.equal(multiplyMoney(money(1999n, 'USD'), 3).amountMinor, 5997n);
  assert.throws(() => multiplyMoney(money(100n, 'USD'), 1.5), /integer quantity/);
});

test('applies rates with an explicit rounding mode', () => {
  const price = money(1000n, 'USD');
  assert.equal(applyRate(price, 0.085, 'half-up').amountMinor, 85n);
  assert.equal(applyRate(money(5n, 'USD'), 0.5, 'half-up').amountMinor, 3n);
  assert.equal(applyRate(money(5n, 'USD'), 0.5, 'half-even').amountMinor, 2n);
  assert.equal(applyRate(money(5n, 'USD'), 0.5, 'down').amountMinor, 2n);
});

test('round-trips through a decimal string', () => {
  for (const [amount, currency] of [['19.99', 'USD'], ['1000', 'JPY'], ['1.234', 'KWD'], ['-0.05', 'EUR']]) {
    const value = moneyFromDecimalString(amount, currency);
    assert.equal(toDecimalString(value), amount === '1000' ? '1000' : amount);
  }
});

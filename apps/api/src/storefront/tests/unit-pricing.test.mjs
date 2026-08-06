/**
 * Storefront · tests/unit-pricing.test.mjs
 * "£8.00 / kg" — the price of a thing per unit of the thing.
 *
 * Required by law in much of the world for goods sold by weight or volume, and
 * §25.1 names perishable food as this platform's wedge — so a wrong number here
 * is not a cosmetic bug, it is a price a shopper compares against a shelf edge
 * and a regulator can act on.
 *
 * Almost every test below asserts that something returns NULL. That is the
 * design: each refusal is a case where a number could have been produced and
 * would have been wrong, and a missing unit price costs a shopper nothing while
 * a confidently wrong one misleads them.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isKnownUnit, unitPriceOf } from '../../../dist/storefront/domain/index.js';

const per = (unit, value = 1) => ({ referenceValue: value, referenceUnit: unit });
const of = (value, unit) => ({ quantityValue: value, quantityUnit: unit });

test('a smaller package is priced up to the reference unit', async () => {
  // 500 g at £4.00 is £8.00 per kilo.
  const pricing = unitPriceOf(400, { ...of(500, 'g'), ...per('kg') });
  assert.equal(pricing.unitPriceMinor, 800);
  assert.equal(pricing.measurement.measuredType, 'weight');
});

test('a larger package is priced down to it', async () => {
  // 2 kg at £10.00 is £5.00 per kilo.
  assert.equal(unitPriceOf(1000, { ...of(2, 'kg'), ...per('kg') }).unitPriceMinor, 500);
});

test('the reference may be more than one unit', async () => {
  // 250 g at £3.00 is £1.20 per 100 g.
  assert.equal(unitPriceOf(300, { ...of(250, 'g'), ...per('g', 100) }).unitPriceMinor, 120);
});

test('volume works the same way', async () => {
  // 750 ml at £9.00 is £12.00 per litre.
  const pricing = unitPriceOf(900, { ...of(750, 'ml'), ...per('l') });
  assert.equal(pricing.unitPriceMinor, 1200);
  assert.equal(pricing.measurement.measuredType, 'volume');
});

test('the kind of measurement is derived, never taken on trust', async () => {
  /**
   * Storing the kind beside the units invites the one row this cannot afford:
   * "weight" with a unit of `ml`, which renders a confident price per kilo for
   * something sold by the millilitre. A unit already knows what it measures.
   */
  assert.equal(unitPriceOf(100, { ...of(1, 'kg'), ...per('kg') }).measurement.measuredType, 'weight');
  assert.equal(unitPriceOf(100, { ...of(1, 'l'), ...per('l') }).measurement.measuredType, 'volume');
  assert.equal(unitPriceOf(100, { ...of(1, 'm'), ...per('m') }).measurement.measuredType, 'length');
});

// --------------------------------------------- every way it refuses to answer

test('grams priced per litre is a mistake, not a conversion', async () => {
  assert.equal(unitPriceOf(400, { ...of(500, 'g'), ...per('l') }), null);
});

test('a unit nobody knows produces no price rather than a guess', async () => {
  assert.equal(unitPriceOf(400, { ...of(500, 'furlong'), ...per('kg') }), null);
  assert.equal(unitPriceOf(400, { ...of(500, 'g'), ...per('bushel') }), null);
});

test('a zero quantity is a division by zero wearing a disguise', async () => {
  assert.equal(unitPriceOf(400, { ...of(0, 'g'), ...per('kg') }), null);
  assert.equal(unitPriceOf(400, { ...of(-500, 'g'), ...per('kg') }), null);
});

test('a product with no measurement simply has no unit price', async () => {
  /**
   * The common case: most things are sold as a thing rather than by weight,
   * and a theme hides the whole line when this is null.
   */
  assert.equal(unitPriceOf(400, {}), null);
  assert.equal(unitPriceOf(400, { ...of(500, 'g') }), null, 'a quantity with nothing to price per');
  assert.equal(unitPriceOf(400, per('kg')), null, 'a reference with nothing measured');
});

test('a value that is not a number never reaches the arithmetic', async () => {
  assert.equal(unitPriceOf(400, { ...of('heavy', 'g'), ...per('kg') }), null);
  assert.equal(unitPriceOf('free', { ...of(500, 'g'), ...per('kg') }), null);
});

test('a free product still has a unit price of zero', async () => {
  /**
   * Zero is a real price, distinct from the absence of one — a sample given
   * away is still priced per kilo at nothing.
   */
  assert.equal(unitPriceOf(0, { ...of(500, 'g'), ...per('kg') }).unitPriceMinor, 0);
});

test('the result is whole minor units', async () => {
  /**
   * 333 g at £1.00 per kilo is £3.003…, and a price with a fraction of a penny
   * in it is not one anybody can be charged or compare.
   */
  const pricing = unitPriceOf(100, { ...of(333, 'g'), ...per('kg') });
  assert.equal(Number.isInteger(pricing.unitPriceMinor), true);
  assert.equal(pricing.unitPriceMinor, 300);
});

test('units are matched case-insensitively and trimmed', async () => {
  // A merchant typing "KG " means kilograms.
  assert.equal(unitPriceOf(400, { ...of(500, 'G'), ...per(' kg ') }).unitPriceMinor, 800);
});

test('the known units are the ones a merchant may price by', async () => {
  for (const unit of ['g', 'kg', 'ml', 'l', 'cm', 'm', 'item']) {
    assert.equal(isKnownUnit(unit), true, unit);
  }
  for (const unit of ['', 'furlong', null, undefined, 42]) {
    assert.equal(isKnownUnit(unit), false, String(unit));
  }
});

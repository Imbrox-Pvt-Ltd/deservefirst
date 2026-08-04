/**
 * Catalog · tests/variants.test.mjs
 * The variant matrix.
 *
 * The rule that matters is the carry-over: regenerating the matrix must not
 * discard prices and SKUs someone already typed, because adding one colour to a
 * product with five sizes would otherwise blank an afternoon's work.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildVariantMatrix } from '../../../../dist/modules/catalog/domain/index.js';
import { money } from '../../../../../../packages/contracts/dist/money.js';

const PRICE = money(1000n, 'USD');
let counter = 0;
const defaults = { price: PRICE, newId: () => `v${++counter}` };

const signature = (variant, names) => names.map((name) => variant.optionValues[name]).join('/');

test('one option produces one variant per value', () => {
  const variants = buildVariantMatrix([{ name: 'Size', values: ['S', 'M', 'L'] }], [], defaults);

  assert.equal(variants.length, 3);
  assert.deepEqual(variants.map((v) => v.optionValues.Size), ['S', 'M', 'L']);
  // A new combination inherits the product price rather than zero.
  assert.equal(variants[0].price.amountMinor, PRICE.amountMinor);
});

test('two options produce every combination once', () => {
  const variants = buildVariantMatrix(
    [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ],
    [],
    defaults,
  );

  assert.equal(variants.length, 4);
  assert.deepEqual(
    variants.map((v) => signature(v, ['Size', 'Colour'])).sort(),
    ['M/Blue', 'M/Red', 'S/Blue', 'S/Red'],
  );
});

test('existing prices and SKUs survive adding an option value', () => {
  const before = buildVariantMatrix([{ name: 'Size', values: ['S', 'M'] }], [], defaults);
  const priced = before.map((variant, index) =>
    variant.optionValues.Size === 'S'
      ? { ...variant, sku: 'SHIRT-S', price: money(2500n, 'USD'), inventoryQuantity: 7 }
      : { ...variant, sku: `SKU-${index}` },
  );

  const after = buildVariantMatrix([{ name: 'Size', values: ['S', 'M', 'L'] }], priced, defaults);

  const small = after.find((variant) => variant.optionValues.Size === 'S');
  assert.equal(small.sku, 'SHIRT-S');
  assert.equal(small.price.amountMinor, 2500n);
  assert.equal(small.inventoryQuantity, 7);
  // The new size is new, so it starts from the product price.
  assert.equal(after.find((v) => v.optionValues.Size === 'L').price.amountMinor, PRICE.amountMinor);
});

test('a removed option value drops exactly its combinations', () => {
  const before = buildVariantMatrix(
    [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ],
    [],
    defaults,
  );
  const priced = before.map((variant) => ({ ...variant, sku: signature(variant, ['Size', 'Colour']) }));

  const after = buildVariantMatrix(
    [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red'] },
    ],
    priced,
    defaults,
  );

  assert.equal(after.length, 2);
  assert.deepEqual(after.map((v) => v.sku).sort(), ['M/Red', 'S/Red']);
});

test('removing every option leaves no variants', () => {
  const before = buildVariantMatrix([{ name: 'Size', values: ['S'] }], [], defaults);
  assert.deepEqual(buildVariantMatrix([], before, defaults), []);
});

test('an option with no values is ignored rather than producing nothing', () => {
  // A half-typed second option must not wipe the first one's variants.
  const variants = buildVariantMatrix(
    [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: [] },
    ],
    [],
    defaults,
  );

  assert.equal(variants.length, 2);
  assert.deepEqual(Object.keys(variants[0].optionValues), ['Size']);
});

test('a repeated option value is refused', () => {
  assert.throws(
    () => buildVariantMatrix([{ name: 'Size', values: ['S', 's'] }], [], defaults),
    /repeats a value/,
  );
});

test('more than three options is refused', () => {
  assert.throws(
    () =>
      buildVariantMatrix(
        [
          { name: 'A', values: ['1'] },
          { name: 'B', values: ['1'] },
          { name: 'C', values: ['1'] },
          { name: 'D', values: ['1'] },
        ],
        [],
        defaults,
      ),
    /at most 3 options/,
  );
});

test('a matrix too large to price by hand is refused', () => {
  assert.throws(
    () =>
      buildVariantMatrix(
        [
          { name: 'A', values: Array.from({ length: 10 }, (_, i) => `a${i}`) },
          { name: 'B', values: Array.from({ length: 11 }, (_, i) => `b${i}`) },
        ],
        [],
        defaults,
      ),
    /more than the 100 allowed/,
  );
});

test('collapsing an option keeps the first matching variant, predictably', () => {
  // "S/Red" and "S/Blue" both collapse onto "S". Either choice loses a price;
  // first-wins is the one a merchant can predict from the order on screen.
  const before = buildVariantMatrix(
    [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ],
    [],
    defaults,
  );
  const priced = before.map((variant) => ({
    ...variant,
    sku: signature(variant, ['Size', 'Colour']),
  }));

  const after = buildVariantMatrix([{ name: 'Size', values: ['S', 'M'] }], priced, defaults);

  assert.equal(after.length, 2);
  assert.deepEqual(after.map((variant) => variant.sku), ['S/Red', 'M/Red']);
  // The collapsed variant no longer claims a colour it does not have.
  assert.deepEqual(Object.keys(after[0].optionValues), ['Size']);
});

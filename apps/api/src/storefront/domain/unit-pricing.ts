/**
 * Storefront · domain/unit-pricing.ts
 * "£8.00 / kg" — the price of a thing per unit of the thing.
 *
 * Required by law in much of the world for goods sold by weight or volume, and
 * §25.1 names perishable food as this platform's wedge, so it is catalogue work
 * rather than a nicety: a shop selling 500g bags has to show the price per
 * kilo, and a shopper comparing two of them cannot do it any other way.
 *
 * The measured type is DERIVED from the units rather than stored beside them.
 * Storing both invites the one bug this cannot afford — a row saying `weight`
 * with a unit of `ml`, which would render a confidently wrong price per kilo
 * for something sold by the millilitre. A unit already knows what it measures.
 *
 * Everything here is integer arithmetic on minor units. A unit price is a price
 * a shopper compares against a shelf edge, and floating point on money is how
 * "£8.00 / kg" becomes "£7.999999 / kg".
 * Layer: domain (pure).
 */

/** What a unit measures, and how many base units it is worth. */
interface UnitDefinition {
  readonly measures: 'weight' | 'volume' | 'length' | 'area' | 'count';
  /** In the base unit of its kind — grams, millilitres, millimetres, cm², items. */
  readonly base: number;
}

/**
 * The units a merchant may price by.
 *
 * A closed table: an unknown unit produces no unit price at all rather than a
 * guess, because the failure mode of guessing is a wrong number next to a
 * price, which a shopper will act on.
 */
const UNITS: Readonly<Record<string, UnitDefinition>> = {
  // Weight, base gram.
  mg: { measures: 'weight', base: 0.001 },
  g: { measures: 'weight', base: 1 },
  kg: { measures: 'weight', base: 1000 },
  oz: { measures: 'weight', base: 28.349523125 },
  lb: { measures: 'weight', base: 453.59237 },

  // Volume, base millilitre.
  ml: { measures: 'volume', base: 1 },
  cl: { measures: 'volume', base: 10 },
  l: { measures: 'volume', base: 1000 },

  // Length, base millimetre.
  mm: { measures: 'length', base: 1 },
  cm: { measures: 'length', base: 10 },
  m: { measures: 'length', base: 1000 },

  // Area, base square centimetre.
  cm2: { measures: 'area', base: 1 },
  m2: { measures: 'area', base: 10000 },

  // Count, base one item.
  item: { measures: 'count', base: 1 },
};

export interface UnitMeasurement {
  /** Derived from the units, never stored — see the file note. */
  readonly measuredType: UnitDefinition['measures'];
  /** How much is in the package: 500 of `g`. */
  readonly quantityValue: number;
  readonly quantityUnit: string;
  /** What the price is quoted per: 1 of `kg`. */
  readonly referenceValue: number;
  readonly referenceUnit: string;
}

export interface UnitPricing {
  /** The price of one reference quantity, in minor units. */
  readonly unitPriceMinor: number;
  readonly measurement: UnitMeasurement;
}

/** What a variant carries, before it is known to make sense together. */
export interface UnitFields {
  readonly quantityValue?: number | string | null;
  readonly quantityUnit?: string | null;
  readonly referenceValue?: number | string | null;
  readonly referenceUnit?: string | null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The unit price of a variant, or null if it does not have one.
 *
 * Null is the common case and the theme tests for it — most products are sold
 * as a thing rather than by weight. Every reason to return null is a reason the
 * number would otherwise be wrong:
 *
 *   · a unit we do not know, so the conversion factor is unknown
 *   · units that measure different things — grams priced per litre
 *   · a quantity of zero, which is a division by zero wearing a disguise
 *
 * The arithmetic is `price × (reference in base units ÷ quantity in base
 * units)`: 500 g at £4.00 priced per kg is 400 × (1000 ÷ 500) = 800.
 */
export function unitPriceOf(priceMinor: unknown, fields: UnitFields): UnitPricing | null {
  const price = Number(priceMinor);
  if (!Number.isFinite(price) || price < 0) return null;

  const quantityValue = positiveNumber(fields.quantityValue);
  const referenceValue = positiveNumber(fields.referenceValue);
  if (quantityValue === null || referenceValue === null) return null;

  const quantityUnit = String(fields.quantityUnit ?? '').trim().toLowerCase();
  const referenceUnit = String(fields.referenceUnit ?? '').trim().toLowerCase();

  const quantity = UNITS[quantityUnit];
  const reference = UNITS[referenceUnit];
  if (!quantity || !reference) return null;

  // Grams priced per litre is not a conversion, it is a data entry mistake.
  if (quantity.measures !== reference.measures) return null;

  const quantityInBase = quantityValue * quantity.base;
  const referenceInBase = referenceValue * reference.base;
  if (quantityInBase <= 0) return null;

  return {
    // Rounded to a whole minor unit, because a price with a fraction of a penny
    // in it is not a price anybody can be charged or compare.
    unitPriceMinor: Math.round(price * (referenceInBase / quantityInBase)),
    measurement: {
      measuredType: quantity.measures,
      quantityValue,
      quantityUnit,
      referenceValue,
      referenceUnit,
    },
  };
}

/** Whether a unit is one a merchant may price by. Used to validate input. */
export function isKnownUnit(unit: unknown): boolean {
  return typeof unit === 'string' && unit.trim().toLowerCase() in UNITS;
}

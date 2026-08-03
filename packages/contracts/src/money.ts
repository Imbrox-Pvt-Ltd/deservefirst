/**
 * Contracts · money.ts
 * The Money value object (§15.2). Every monetary value on the platform is integer
 * minor units plus an ISO-4217 code — never a float, never a bare number. No
 * module implements its own currency maths; a fitness rule flags any that tries.
 * Layer: contracts (pure, no I/O).
 */

/** ISO-4217 alphabetic code, e.g. "USD", "INR", "JPY". */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

export interface Money {
  /** Amount in the currency's smallest unit: cents, paise, yen. */
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** Currencies whose smallest unit is the unit itself (no decimal places). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Currencies with three decimal places. */
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyExponent(currency: CurrencyCode): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export function money(amountMinor: bigint | number, currency: string): Money {
  return {
    amountMinor: typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.round(amountMinor)),
    currency: currency.toUpperCase() as CurrencyCode,
  };
}

/**
 * Parses a decimal string ("19.99") into minor units without ever touching a
 * float — string arithmetic only, because 19.99 is not representable in binary.
 */
export function moneyFromDecimalString(value: string, currency: string): Money {
  const code = currency.toUpperCase() as CurrencyCode;
  const exponent = currencyExponent(code);
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`Invalid decimal amount: "${value}"`);
  }
  if (fraction.length > exponent) {
    throw new Error(
      `Amount "${value}" has more precision than ${code} allows (${exponent} decimal places)`,
    );
  }

  const padded = fraction.padEnd(exponent, '0');
  const minor = BigInt(`${whole}${padded}` || '0');
  return { amountMinor: negative ? -minor : minor, currency: code };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine ${a.currency} with ${b.currency} — convert explicitly first`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/** Multiplies by an integer quantity. Fractional rates need an explicit rounding mode. */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new Error('multiplyMoney takes an integer quantity; use applyRate for fractional rates');
  }
  return { amountMinor: value.amountMinor * BigInt(quantity), currency: value.currency };
}

export type RoundingMode = 'half-up' | 'half-even' | 'down';

/**
 * Applies a fractional rate (tax, discount, FX) with an explicit rounding mode.
 * Rounding is never implicit — that is how cent-drift bugs are born.
 */
export function applyRate(value: Money, rate: number, mode: RoundingMode = 'half-up'): Money {
  const scale = 1_000_000n;
  const scaledRate = BigInt(Math.round(rate * Number(scale)));
  const product = value.amountMinor * scaledRate;

  let result: bigint;
  switch (mode) {
    case 'down':
      result = product / scale;
      break;
    case 'half-even': {
      const quotient = product / scale;
      const remainder = product % scale;
      const twice = remainder * 2n;
      if (twice > scale || (twice === scale && quotient % 2n !== 0n)) {
        result = quotient + (product < 0n ? -1n : 1n);
      } else {
        result = quotient;
      }
      break;
    }
    case 'half-up':
    default: {
      const quotient = product / scale;
      const remainder = product % scale;
      const twice = (remainder < 0n ? -remainder : remainder) * 2n;
      result = twice >= scale ? quotient + (product < 0n ? -1n : 1n) : quotient;
      break;
    }
  }

  return { amountMinor: result, currency: value.currency };
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0n;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/**
 * Renders as a plain decimal string for storage or transport. Presentation
 * formatting (symbols, grouping, locale) belongs to the i18n service, not here.
 */
export function toDecimalString(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amountMinor < 0n;
  const digits = (negative ? -value.amountMinor : value.amountMinor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent) || '0';
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

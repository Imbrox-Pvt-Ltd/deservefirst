/**
 * Storefront · engine/filters/money.ts
 * The four money filters, and the format language they share.
 *
 * These matter more than their count suggests. A storefront that renders prices
 * wrongly is not a cosmetic bug, and this is the one place on the platform where
 * a number becomes a price a customer reads. So it goes through `Money` (§15.2)
 * like everything else: minor units in, `toDecimalString` for the exact decimal,
 * and the grouping applied to a string that was never a float.
 *
 * The input is minor units, matching the reference product — `{{ 1000 | money }}`
 * is ten dollars, not a thousand. Themes are written against that and a theme
 * that showed prices 100× too high would be noticed, so it is not a guess.
 * Layer: engine.
 */

import { currencyExponent, money as makeMoney, toDecimalString } from '@deservefirst/contracts';

import type { RenderContext } from '../context';
import type { FilterArgs, FilterDefinition, FilterGroup } from '../types';

/**
 * How a merchant's format string names the number it wants.
 *
 * Each placeholder is a (thousands separator, decimal separator, keep decimals)
 * decision. A store in Germany writes `{{amount_with_comma_separator}}` and
 * expects `1.134,65`; the same store's data is identical, only the rendering
 * differs, which is exactly why this is a format string and not a locale lookup.
 */
const PLACEHOLDERS: Readonly<
  Record<string, { group: string; decimal: string; decimals: boolean }>
> = {
  amount: { group: ',', decimal: '.', decimals: true },
  amount_no_decimals: { group: ',', decimal: '.', decimals: false },
  amount_with_comma_separator: { group: '.', decimal: ',', decimals: true },
  amount_no_decimals_with_comma_separator: { group: '.', decimal: ',', decimals: false },
  amount_with_apostrophe_separator: { group: "'", decimal: '.', decimals: true },
  amount_no_decimals_with_apostrophe_separator: { group: "'", decimal: '.', decimals: false },
  amount_with_space_separator: { group: ' ', decimal: ',', decimals: true },
  amount_no_decimals_with_space_separator: { group: ' ', decimal: '.', decimals: false },
  amount_with_period_and_space_separator: { group: ' ', decimal: '.', decimals: true },
};

/**
 * Groups the whole part in threes.
 *
 * On the string, never the number. `(1234567.89).toLocaleString()` would be the
 * shorter version and would also route the value through a float on the way.
 */
function group(whole: string, separator: string): string {
  if (separator === '') return whole;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * Renders minor units through one of the merchant's format strings.
 *
 * Rounding for the no-decimals placeholders happens in integer minor units —
 * half-up on the remainder — so it never depends on how a decimal string parsed.
 */
function formatAmount(minor: bigint, currency: string, placeholder: string): string {
  const style = PLACEHOLDERS[placeholder];
  if (!style) return '';

  const exponent = currencyExponent(currency as never);
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;

  if (!style.decimals && exponent > 0) {
    const scale = 10n ** BigInt(exponent);
    const units = magnitude / scale;
    const remainder = magnitude % scale;
    // Half-up, decided on integers rather than by formatting a float.
    const rounded = remainder * 2n >= scale ? units + 1n : units;
    return `${negative ? '-' : ''}${group(rounded.toString(), style.group)}`;
  }

  const decimal = toDecimalString(makeMoney(magnitude, currency));
  const [whole = '0', fraction] = decimal.split('.');
  const grouped = group(whole, style.group);
  const body = fraction !== undefined && style.decimals ? `${grouped}${style.decimal}${fraction}` : grouped;
  return `${negative ? '-' : ''}${body}`;
}

/**
 * Substitutes every placeholder in a merchant's format string.
 *
 * Unknown placeholders are left as written. A merchant who typed
 * `{{amount_with_dots}}` should see their mistake on the page rather than have
 * it silently disappear, which is the failure that gets reported as "the price
 * is missing".
 */
function applyFormat(format: string, minor: bigint, currency: string): string {
  return format.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    const rendered = formatAmount(minor, currency, name);
    return PLACEHOLDERS[name] ? rendered : whole;
  });
}

/**
 * A theme's value as minor units.
 *
 * Themes pass numbers, numeric strings, and occasionally a money object from a
 * drop. All three have to work; a price that renders as blank because a drop
 * handed over an object is a bug the merchant sees and we do not.
 */
function toMinorUnits(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? BigInt(Math.round(value)) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    return BigInt(Math.round(Number(trimmed)));
  }
  if (value && typeof value === 'object' && 'amountMinor' in value) {
    const amount = (value as { amountMinor: unknown }).amountMinor;
    return typeof amount === 'bigint' ? amount : toMinorUnits(amount);
  }
  return null;
}

/** The currency for this value: its own if it carries one, else the store's. */
function currencyFor(context: RenderContext, value: unknown): string {
  if (value && typeof value === 'object' && 'currency' in value) {
    const currency = (value as { currency: unknown }).currency;
    if (typeof currency === 'string' && currency !== '') return currency;
  }
  return context.currency;
}

function moneyFilter(
  name: string,
  render: (context: RenderContext, minor: bigint, currency: string, args: FilterArgs) => string,
): FilterDefinition {
  return {
    name,
    apply: (context, value, args) => {
      const minor = toMinorUnits(value);
      // Nothing, rather than "NaN" or "$0.00". A theme showing a price for a
      // product that has none is worse than one showing nothing.
      if (minor === null) return '';
      return render(context, minor, currencyFor(context, value), args);
    },
  };
}

export const moneyFilters: FilterGroup = {
  name: 'money',
  filters: [
    moneyFilter('money', (context, minor, currency) =>
      applyFormat(context.moneyFormats.money, minor, currency),
    ),

    moneyFilter('money_with_currency', (context, minor, currency) =>
      applyFormat(context.moneyFormats.moneyWithCurrency, minor, currency),
    ),

    /**
     * The number alone — no symbol, no code.
     *
     * Themes use this inside `content_for_header` metadata and in data
     * attributes their JavaScript reads, so it has to be the plain grouped
     * number the merchant's format would have produced.
     */
    moneyFilter('money_without_currency', (context, minor, currency) =>
      formatAmount(minor, currency, placeholderOf(context.moneyFormats.money)),
    ),

    /**
     * Whole amounts lose their decimals; fractional ones keep them.
     *
     * `$10` and `$10.50` in the same list, which is the point — it is for price
     * displays where trailing `.00` is noise.
     */
    moneyFilter('money_without_trailing_zeros', (context, minor, currency) => {
      const exponent = currencyExponent(currency as never);
      const scale = 10n ** BigInt(exponent);
      const whole = exponent === 0 || minor % scale === 0n;
      const format = context.moneyFormats.money;
      if (!whole) return applyFormat(format, minor, currency);

      // Swap each placeholder for its no-decimals twin, keeping the merchant's
      // separators and their symbol placement intact.
      const withoutDecimals = format.replace(/\{\{\s*(\w+)\s*\}\}/g, (original, name: string) => {
        const twin = noDecimalsTwin(name);
        return twin ? `{{${twin}}}` : original;
      });
      return applyFormat(withoutDecimals, minor, currency);
    }),
  ],
};

/** Which placeholder a format string uses, for the bare-number filter. */
function placeholderOf(format: string): string {
  const match = /\{\{\s*(\w+)\s*\}\}/.exec(format);
  const name = match?.[1];
  return name && PLACEHOLDERS[name] ? name : 'amount';
}

/** The no-decimals variant of a placeholder, where one exists. */
function noDecimalsTwin(name: string): string | null {
  if (!PLACEHOLDERS[name] || name.includes('no_decimals')) return null;
  const twin = name === 'amount' ? 'amount_no_decimals' : name.replace('amount_with', 'amount_no_decimals_with');
  return PLACEHOLDERS[twin] ? twin : null;
}

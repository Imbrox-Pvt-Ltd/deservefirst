/**
 * Storefront · domain/drops/localization.ts
 * Which language and currency this page is in, and what else is on offer.
 *
 * These exist so a theme can render a country and language picker, which means
 * they carry the *available* options as well as the current one. That is the
 * only reason a storefront needs to know the store trades in eleven currencies.
 *
 * Currency here is the code and its presentation, never a rate. A theme that
 * could read an exchange rate would be a theme that could compute a price, and
 * prices are converted server-side through `Money` (§15.2) precisely so there is
 * one answer rather than one per theme.
 * Layer: domain (pure).
 */

import { defineDrop, dropList } from './define';

export interface CurrencyRow {
  readonly isoCode: string;
  readonly name?: string | null;
  readonly symbol?: string | null;
}

export interface CountryRow {
  readonly isoCode: string;
  readonly name: string;
  readonly currency?: CurrencyRow | null;
  readonly available?: boolean;
}

export interface LanguageRow {
  readonly isoCode: string;
  readonly endonym?: string | null;
  readonly name?: string | null;
  readonly primary?: boolean;
}

export interface LocalizationState {
  readonly country: CountryRow;
  readonly language: LanguageRow;
  readonly availableCountries?: readonly CountryRow[];
  readonly availableLanguages?: readonly LanguageRow[];
}

export const currencyDrop = defineDrop<CurrencyRow>('currency', {
  iso_code: (currency) => currency.isoCode,
  name: (currency) => currency.name ?? currency.isoCode,
  symbol: (currency) => currency.symbol ?? '',
});

export const countryDrop = defineDrop<CountryRow>('country', {
  iso_code: (country) => country.isoCode,
  name: (country) => country.name,
  currency: (country, context) =>
    country.currency ? currencyDrop(country.currency, context) : null,
  available: (country) => country.available ?? true,
});

export const languageDrop = defineDrop<LanguageRow>('language', {
  iso_code: (language) => language.isoCode,
  /**
   * The language's name in its own language — "Deutsch", not "German".
   *
   * A picker written in the language the shopper cannot read is not a picker.
   * Themes reach for `endonym_name` first for exactly this reason.
   */
  endonym_name: (language) => language.endonym ?? language.name ?? language.isoCode,
  name: (language) => language.name ?? language.isoCode,
  primary: (language) => language.primary ?? false,
});

export const localizationDrop = defineDrop<LocalizationState>('localization', {
  country: (state, context) => countryDrop(state.country, context),
  language: (state, context) => languageDrop(state.language, context),
  available_countries: (state, context) =>
    dropList(countryDrop, state.availableCountries ?? [state.country], context),
  available_languages: (state, context) =>
    dropList(languageDrop, state.availableLanguages ?? [state.language], context),
  /** Whether a picker is worth rendering at all. */
  market: (state) => state.country.isoCode,
});

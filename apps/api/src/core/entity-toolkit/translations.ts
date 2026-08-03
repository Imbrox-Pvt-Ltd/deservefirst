/**
 * Core · entity-toolkit/translations.ts
 * Content i18n (§15.5): the central translation store, keyed by
 * (store, resource type, resource id, field, locale). Entities declare which
 * fields are translatable and Core handles storage, lookup and fallback — so
 * every module gets content i18n for free rather than inventing its own.
 * Layer: core.
 */

import type { StoreId } from '@deservefirst/contracts';

export type TranslationStatus = 'draft' | 'published';

export interface TranslationRecord {
  readonly storeId: StoreId;
  readonly resourceEntity: string;
  readonly resourceId: string;
  readonly field: string;
  readonly locale: string;
  readonly value: string;
  readonly status: TranslationStatus;
  /**
   * Set when the source field changes after this translation was written, so the
   * editor can show "needs review" instead of silently serving stale copy.
   */
  readonly outdated: boolean;
  readonly updatedAt: Date;
}

export interface LocaleResolution {
  readonly locale: string;
  readonly fallbackChain: readonly string[];
}

/**
 * Resolves the locale chain for a request (§15.3). Order matters: the user's own
 * preference wins over the store default, which wins over the request header.
 */
export function resolveLocaleChain(input: {
  userLocale?: string | null;
  storeDefaultLocale: string;
  acceptLanguage?: string | null;
}): LocaleResolution {
  const candidates = [
    input.userLocale,
    input.storeDefaultLocale,
    ...parseAcceptLanguage(input.acceptLanguage ?? ''),
  ].filter((value): value is string => Boolean(value));

  const chain: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (!chain.includes(normalized)) chain.push(normalized);
    // "fr-CA" should also try "fr" before giving up.
    const language = normalized.split('-')[0];
    if (language && !chain.includes(language)) chain.push(language);
  }

  return { locale: chain[0] ?? input.storeDefaultLocale, fallbackChain: chain };
}

/** BCP-47 shape: lowercase language, uppercase region. */
export function normalizeLocale(locale: string): string {
  const [language, region] = locale.trim().split(/[-_]/);
  if (!language) return locale;
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, quality] = part.trim().split(';q=');
      return { tag: (tag ?? '').trim(), quality: quality ? Number.parseFloat(quality) : 1 };
    })
    .filter((entry) => entry.tag.length > 0 && !Number.isNaN(entry.quality))
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}

/**
 * Picks the best available translation, walking the fallback chain and finally
 * returning the source value. A missing translation shows the default locale's
 * text — never an empty field, which reads as a bug to the merchant.
 */
export function resolveTranslation(
  translations: readonly TranslationRecord[],
  field: string,
  chain: readonly string[],
  sourceValue: string,
): { value: string; locale: string | null; outdated: boolean } {
  const byLocale = new Map(
    translations
      .filter((record) => record.field === field && record.status === 'published')
      .map((record) => [record.locale, record]),
  );

  for (const locale of chain) {
    const match = byLocale.get(locale);
    if (match) {
      return { value: match.value, locale: match.locale, outdated: match.outdated };
    }
  }

  return { value: sourceValue, locale: null, outdated: false };
}

/**
 * Marks every translation of a field outdated when its source changes. Without
 * this the merchant has no way to know which translations drifted.
 */
export function markOutdated(
  translations: readonly TranslationRecord[],
  changedFields: readonly string[],
): TranslationRecord[] {
  const changed = new Set(changedFields);
  return translations.map((record) =>
    changed.has(record.field) && !record.outdated ? { ...record, outdated: true } : record,
  );
}

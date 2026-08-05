/**
 * Storefront · domain/translations.ts
 * A theme's own wording, from its locale files.
 *
 * Nothing loaded them. `defaultContext` set `translations: {}` and no caller
 * ever replaced it, so every `{{ 'x' | t }}` missed — and the `t` filter's
 * missing-key behaviour is to print `translation missing: en.some.key` onto the
 * page, which is correct during development and is what a customer was
 * reading. The reference theme's homepage showed 21 copies of
 * "translation missing: en.home_page.onboarding.product_title" and about fifty
 * of them in total.
 *
 * It is a good illustration of why the filter prints rather than falls silent:
 * a blank space would have hidden this indefinitely.
 *
 * Two decisions worth stating:
 *
 * **Flattened to dotted keys.** A theme writes `'general.accessibility.close'`
 * as one string, so a nested lookup would mean splitting and walking on every
 * call. Flattening once per theme version is the same work done once.
 *
 * **The file for a locale is chosen, not merged.** `en.default.json` and
 * `fr.json` are alternatives; merging them would produce a page half in each
 * language whenever a key was missing from one.
 * Layer: domain (pure).
 */

/**
 * Turns nested locale JSON into the dotted keys a theme asks for.
 *
 * Values that are not strings are dropped rather than stringified. A locale
 * file's `date_formats` holds strings, but an array or a number reaching a
 * template would render as `[object Object]` or a bare digit where a sentence
 * belongs — and that is harder to spot than a missing translation, which at
 * least says so.
 */
export function flattenTranslations(
  value: unknown,
  prefix = '',
  into: Record<string, string> = {},
): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return into;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;

    if (typeof child === 'string') {
      into[path] = child;
    } else if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flattenTranslations(child, path, into);
    }
  }

  return into;
}

/**
 * Which locale file to read, given what the theme ships.
 *
 * The order is what a merchant would expect: their language, then the theme's
 * declared default, then whatever default exists. A theme with no locale files
 * at all returns null and the storefront renders with none — which is how it
 * behaved before this existed, and is better than refusing to serve a page.
 *
 * `*.schema.json` files are excluded deliberately: those are the editor's
 * labels for a theme's settings, not the storefront's wording, and loading them
 * would put "Colour scheme" into the translation table under keys no page asks
 * for.
 */
export function localeFileFor(
  available: readonly string[],
  locale: string,
): string | null {
  const files = available.filter(
    (name) => name.endsWith('.json') && !name.endsWith('.schema.json'),
  );

  const wanted = [
    `${locale}.default.json`,
    `${locale}.json`,
    // A regional tag falls back to its language: `en-GB` reads `en`.
    `${locale.split('-')[0]}.default.json`,
    `${locale.split('-')[0]}.json`,
  ];

  for (const candidate of wanted) {
    if (files.includes(candidate)) return candidate;
  }

  // Whatever the theme calls its default, whichever language that is. A page in
  // the wrong language is still a page; one full of `translation missing` is
  // not.
  return files.find((name) => name.endsWith('.default.json')) ?? null;
}

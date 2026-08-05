/**
 * Storefront · engine/filters/localization.ts
 * `t` and `format_address`.
 *
 * `t` is used 501 times in the reference theme — more than the next four filters
 * combined — so its edge cases are not edge cases. Two in particular:
 * interpolation (`{{ count }}` inside a translation) and pluralisation (a key
 * resolving to `.one` or `.other` depending on a count). A `t` without them
 * renders literal braces on the page.
 * Layer: engine.
 */

import { escapeHtml } from '../markup';
import { stringify, type FilterGroup } from '../types';

/**
 * Which plural form a count selects.
 *
 * English rules, applied to every locale, and that is a real limitation: Polish
 * has three forms and Arabic six. The translation files carry whichever keys the
 * translator wrote, so the fix is a CLDR plural-rule table here rather than
 * anything themes do differently — recorded so the next person does not have to
 * rediscover why Polish counts read oddly.
 */
function pluralKey(count: number): string {
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  return 'other';
}

export const localizationFilters: FilterGroup = {
  name: 'localization',
  filters: [
    {
      name: 't',
      apply: (context, value, args) => {
        const key = stringify(value);
        if (key === '') return '';

        const named = args.named;
        const count = named.count;

        // A count makes the key a family: `cart.item_count.one` and `.other`.
        let translation = context.translations[key];
        if (count !== undefined) {
          const numeric = typeof count === 'number' ? count : Number(stringify(count));
          const plural = context.translations[`${key}.${pluralKey(numeric)}`];
          if (plural !== undefined) translation = plural;
          else if (translation === undefined) {
            translation = context.translations[`${key}.other`];
          }
        }

        /**
         * A missing key renders as `translation missing: <locale>.<key>`.
         *
         * The reference product's behaviour, and the right one: it is visible on
         * the page during development and it names exactly what to add. Silence
         * would leave a blank space nobody attributes to a missing translation.
         */
        if (translation === undefined) {
          return `translation missing: ${context.locale}.${key}`;
        }

        return interpolate(translation, named);
      },
    },

    /**
     * An address in its country's own order.
     *
     * Ordering is per-country data rather than one template, because "street
     * then city then postcode" is not universal — Japan writes the postcode
     * first and the prefecture before the city, and an address in the wrong
     * order is one a postal service cannot read.
     */
    {
      name: 'format_address',
      returnsHtml: true,
      apply: (_context, value) => {
        const address = value as Record<string, unknown> | null;
        if (!address || typeof address !== 'object') return '';

        const field = (name: string): string => stringify(address[name]).trim();
        const country = field('country_code').toUpperCase();

        const lines =
          ORDERS[country]?.(field) ??
          [
            [field('first_name'), field('last_name')].filter(Boolean).join(' '),
            field('company'),
            field('address1'),
            field('address2'),
            [field('city'), field('province'), field('zip')].filter(Boolean).join(' '),
            field('country'),
          ];

        return lines
          .filter((line) => line !== '')
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('');
      },
    },
  ],
};

/** Per-country line orders, for the ones that differ meaningfully. */
const ORDERS: Readonly<Record<string, (field: (name: string) => string) => string[]>> = {
  JP: (field) => [
    field('zip'),
    [field('province'), field('city')].filter(Boolean).join(' '),
    field('address1'),
    field('address2'),
    field('company'),
    [field('last_name'), field('first_name')].filter(Boolean).join(' '),
    field('country'),
  ],
  GB: (field) => [
    [field('first_name'), field('last_name')].filter(Boolean).join(' '),
    field('company'),
    field('address1'),
    field('address2'),
    field('city'),
    field('province'),
    field('zip'),
    field('country'),
  ],
  IN: (field) => [
    [field('first_name'), field('last_name')].filter(Boolean).join(' '),
    field('company'),
    field('address1'),
    field('address2'),
    [field('city'), field('zip')].filter(Boolean).join(' - '),
    field('province'),
    field('country'),
  ],
};

/**
 * Substitutes `{{ name }}` inside a translation.
 *
 * Translations are authored by the merchant or the theme, and the values come
 * from the theme — neither is escaped here, because the engine escapes `t`'s
 * output like any other filter. Marking `t` as returning HTML would be the bug:
 * a product title inside a translated string would then go out raw.
 */
function interpolate(template: string, named: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    const value = named[name];
    return value === undefined ? whole : stringify(value);
  });
}

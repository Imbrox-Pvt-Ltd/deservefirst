/**
 * Storefront · engine/filters/string.ts
 * String filters the reference product has and liquidjs does not.
 *
 * Small, but `handle` is not optional: it is how a theme turns a title into the
 * URL segment the router will later look up, so our handleize and the one that
 * generated the stored handle have to agree exactly. They do, because both go
 * through `handleize` here.
 * Layer: engine.
 */

import { createHash } from 'node:crypto';

import { arg, stringify, type FilterGroup } from '../types';

/**
 * A title as a URL segment.
 *
 * Accents are decomposed and stripped rather than transliterated, matching the
 * reference product: "Café" becomes "cafe", not "cafe-" or "caf". Anything that
 * is not a letter, digit or underscore becomes a hyphen, runs collapse, and the
 * ends are trimmed — so "  Hello, World!  " is "hello-world".
 */
export function handleize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const stringFilters: FilterGroup = {
  name: 'string',
  filters: [
    { name: 'handle', apply: (_context, value) => handleize(stringify(value)) },
    { name: 'handleize', apply: (_context, value) => handleize(stringify(value)) },

    { name: 'md5', apply: (_context, value) => createHash('md5').update(stringify(value)).digest('hex') },
    { name: 'sha1', apply: (_context, value) => createHash('sha1').update(stringify(value)).digest('hex') },

    { name: 'camelize', apply: (_context, value) => camelize(stringify(value)) },

    /**
     * Picks the singular or plural word for a count.
     *
     * English rules only, which is a real limitation and the reason themes pair
     * it with `t` for anything user-facing — languages with three plural forms
     * cannot be served by a two-argument filter, and pretending otherwise would
     * be worse than the limit.
     */
    {
      name: 'pluralize',
      apply: (_context, value, args) => {
        const count = typeof value === 'number' ? value : Number(stringify(value));
        const singular = stringify(arg(args, 0));
        const plural = stringify(arg(args, 1));
        return count === 1 ? singular : plural;
      },
    },

    /**
     * A gift-card code in readable groups of four.
     *
     * Someone is typing this off a screen, so `ABCD EFGH IJKL MNOP` rather than
     * sixteen unbroken characters.
     */
    {
      name: 'format_code',
      apply: (_context, value) =>
        stringify(value)
          .replace(/\s+/g, '')
          .replace(/(.{4})/g, '$1 ')
          .trim(),
    },
  ],
};

function camelize(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/^(.)/, (_match, char: string) => char.toUpperCase());
}

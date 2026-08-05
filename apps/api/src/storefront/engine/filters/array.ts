/**
 * Storefront · engine/filters/array.ts
 * Making an array, which Liquid is genuinely bad at.
 *
 * Liquid has no array literal. `{% assign a = [1, 2, 3] %}` does not error — it
 * quietly produces nothing, so the loop below it runs zero times and the page
 * renders with a section missing. Measured, not assumed: it renders as the empty
 * string with `size` 0.
 *
 * The established workaround is `{% assign a = '' | split: ',' %}`, which works
 * and reads like a trick. These filters give it a name instead. The linter in
 * `domain/template-lint.ts` is the other half: it catches the literal at upload
 * and says which idiom to use.
 *
 * Nothing here mutates its input. That is not merely tidy — a drop can hand a
 * theme an array the platform also holds, and a filter that sorted it in place
 * would let one theme reorder data for every request afterwards. liquidjs's own
 * array filters were checked for this and all copy; a test pins it so a future
 * version cannot regress it silently.
 * Layer: engine.
 */

import { stringify, type FilterGroup } from '../types';

/**
 * Anything as an array, without surprises.
 *
 * `nil` becomes empty rather than `[nil]`, because the whole point is starting
 * an accumulator — `{% assign list = nil | array %}` should give you nothing to
 * begin with, not a list containing one blank.
 */
function toArray(value: unknown): unknown[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return [...value];
  return [value];
}

export const arrayFilters: FilterGroup = {
  name: 'array',
  filters: [
    /**
     * Builds an array from the value and any further arguments.
     *
     * `{% assign list = nil | array %}` starts an empty one;
     * `{% assign list = 'a' | array: 'b', 'c' %}` starts a full one. Both read
     * as what they are, which `'' | split: ','` does not.
     */
    {
      name: 'array',
      apply: (_context, value, args) => [...toArray(value), ...args.positional],
    },

    /**
     * Where a value sits in an array, or -1.
     *
     * Themes need this to render "step 2 of 5" and to mark the current item in
     * a list. Comparison is by string, matching how Liquid compares elsewhere,
     * so a numeric id from JSON and one from a setting still match.
     */
    {
      name: 'index_of',
      apply: (_context, value, args) => {
        const list = toArray(value);
        const needle = stringify(args.positional[0]);
        return list.findIndex((entry) => stringify(entry) === needle);
      },
    },

    /**
     * Every element except the ones matching.
     *
     * The complement of `where`, which only keeps matches. Filtering the current
     * product out of a related-products list is the case that keeps coming up,
     * and doing it with `where` requires a property that means "not me".
     */
    {
      name: 'without',
      apply: (_context, value, args) => {
        const list = toArray(value);
        const [first, second] = args.positional;

        // `list | without: 'id', 5` removes by property; `list | without: 'a'`
        // removes by value. Two shapes because themes need both and Liquid has
        // no way to express an anonymous predicate.
        if (args.positional.length >= 2) {
          const property = stringify(first);
          const needle = stringify(second);
          return list.filter((entry) => {
            const held = (entry as Record<string, unknown> | null)?.[property];
            return stringify(held) !== needle;
          });
        }

        const needle = stringify(first);
        return list.filter((entry) => stringify(entry) !== needle);
      },
    },
  ],
};

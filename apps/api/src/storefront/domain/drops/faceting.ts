/**
 * Storefront · domain/drops/faceting.ts
 * Filters and sort options on a collection or a search page.
 *
 * The whole design of these drops is that the theme never builds a URL. Each
 * value carries the URL that applies it and the URL that removes it, computed
 * here from the request that is already in hand.
 *
 * That is not a convenience. A theme assembling filter URLs by string
 * concatenation gets it wrong for the second filter, loses the sort order, or
 * drops the page reset — and the symptom is a shopper who ticks "Blue" and
 * lands on page four of an unfiltered list. Doing it once here means every
 * theme gets the same working behaviour.
 * Layer: domain (pure).
 */

import { defineDrop, dropList } from './define';

export interface FilterValueRow {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  /** The query parameter this value belongs to, e.g. `filter.v.option.colour`. */
  readonly param: string;
}

export interface FilterRow {
  readonly label: string;
  readonly param: string;
  /** `list`, `price_range` or `boolean`. */
  readonly filterType: string;
  readonly values: readonly FilterValueRow[];
  readonly minValue?: number | null;
  readonly maxValue?: number | null;
}

export interface SortOptionRow {
  readonly value: string;
  readonly label: string;
  readonly active?: boolean;
}

export interface FacetState {
  /** The path and query the page was requested with. */
  readonly currentUrl: string;
  readonly filters: readonly FilterRow[];
  readonly sortOptions?: readonly SortOptionRow[];
  readonly currentSort?: string | null;
}

/**
 * The current URL with one parameter added or removed.
 *
 * `page` is always dropped: changing a filter and staying on page four shows an
 * empty result set for a filter that has matches, which reads as a broken
 * filter rather than a stale page number.
 */
function urlWith(
  currentUrl: string,
  changes: readonly { param: string; value: string; add: boolean }[],
): string {
  const [path = '/', query = ''] = currentUrl.split('?');
  const params = new URLSearchParams(query);

  for (const change of changes) {
    if (change.add) {
      params.append(change.param, change.value);
      continue;
    }
    const remaining = params.getAll(change.param).filter((held) => held !== change.value);
    params.delete(change.param);
    for (const held of remaining) params.append(change.param, held);
  }

  params.delete('page');

  const rendered = params.toString();
  return rendered === '' ? path : `${path}?${rendered}`;
}

export const filterValueDrop = defineDrop<FilterValueRow & { currentUrl: string }>('filter_value', {
  value: (row) => row.value,
  label: (row) => row.label,
  /**
   * How many products this would leave.
   *
   * Themes grey out a zero-count value; without the count they render a choice
   * that leads to an empty page.
   */
  count: (row) => row.count,
  active: (row) => row.active,
  param_name: (row) => row.param,
  /** Tick this value, keeping every other filter and the sort order. */
  url_to_add: (row) => urlWith(row.currentUrl, [{ param: row.param, value: row.value, add: true }]),
  url_to_remove: (row) =>
    urlWith(row.currentUrl, [{ param: row.param, value: row.value, add: false }]),
});

export const filterDrop = defineDrop<FilterRow & { currentUrl: string }>('filter', {
  label: (row) => row.label,
  param_name: (row) => row.param,
  type: (row) => row.filterType,
  values: (row, context) =>
    dropList(
      filterValueDrop,
      row.values.map((value) => ({ ...value, currentUrl: row.currentUrl })),
      context,
    ),
  active_values: (row, context) =>
    dropList(
      filterValueDrop,
      row.values.filter((value) => value.active).map((value) => ({ ...value, currentUrl: row.currentUrl })),
      context,
    ),
  /** Clears every value of this one filter, leaving the others alone. */
  url_to_remove: (row) =>
    urlWith(
      row.currentUrl,
      row.values.filter((value) => value.active).map((value) => ({
        param: row.param,
        value: value.value,
        add: false,
      })),
    ),
  min_value: (row) => row.minValue ?? null,
  max_value: (row) => row.maxValue ?? null,
});

export const sortOptionDrop = defineDrop<SortOptionRow>('sort_option', {
  value: (option) => option.value,
  name: (option) => option.label,
  active: (option) => option.active ?? false,
});

export const facetsDrop = defineDrop<FacetState>('facets', {
  filters: (state, context) =>
    dropList(
      filterDrop,
      state.filters.map((filter) => ({ ...filter, currentUrl: state.currentUrl })),
      context,
    ),
  sort_options: (state, context) => dropList(sortOptionDrop, state.sortOptions ?? [], context),
  sort_by: (state) => state.currentSort ?? null,
  /** Whether anything is filtered, so a theme can offer "clear all". */
  filtered: (state) => state.filters.some((filter) => filter.values.some((value) => value.active)),
  url_to_clear: (state) => {
    const [path = '/', query = ''] = state.currentUrl.split('?');
    const params = new URLSearchParams(query);
    for (const key of [...params.keys()]) {
      if (key.startsWith('filter')) params.delete(key);
    }
    params.delete('page');
    const rendered = params.toString();
    return rendered === '' ? path : `${path}?${rendered}`;
  },
});

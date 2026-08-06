/**
 * Storefront · domain/facets.ts
 * Reading a shopper's filter and sort choices out of a URL.
 *
 * The parameter names are fixed and boring on purpose. A theme ported from
 * another platform arrives with its filter links already written, and a naming
 * scheme of our own would mean every one of them silently filtering nothing —
 * so the shape a merchant's existing theme already sends is the shape we read.
 *
 * Everything here is a narrowing. A query string is the least trustworthy input
 * a storefront takes: it is public, guessable and pasted into links. So a sort
 * key that is not in the list becomes the default rather than reaching SQL, and
 * a price that is not a number is dropped rather than compared. Nothing in this
 * file can widen a result set.
 *
 * Facet URLs are deliberately NOT canonical (§37.6). A filtered collection is
 * the same collection, and letting search engines index one page per
 * combination of ticks is how a catalogue of 200 products becomes 40,000 thin
 * pages competing with each other. The base collection URL is the canonical
 * one; see `facetsAreActive`.
 * Layer: domain (pure).
 */

/** What a shopper has narrowed the list to. Empty means "everything". */
export interface FilterCriteria {
  readonly productTypes: readonly string[];
  readonly vendors: readonly string[];
  readonly tags: readonly string[];
  /** Inclusive bounds in minor units, as prices are stored. */
  readonly priceMin: number | null;
  readonly priceMax: number | null;
}

export const NO_FILTERS: FilterCriteria = {
  productTypes: [], vendors: [], tags: [], priceMin: null, priceMax: null,
};

/** The parameter each facet reads, which is also what the drops hand back. */
export const FILTER_PARAMS = {
  productType: 'filter.p.product_type',
  vendor: 'filter.p.vendor',
  tag: 'filter.p.tag',
  priceMin: 'filter.v.price.gte',
  priceMax: 'filter.v.price.lte',
} as const;

/**
 * How a merchant may order a collection.
 *
 * A closed list, because the value reaches an ORDER BY. Anything outside it is
 * not an error to report — a shopper who edited the URL gets the default
 * order, which is the same thing they would have seen without touching it.
 */
export const SORT_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'manual', label: 'Featured' },
  { value: 'best-selling', label: 'Best selling' },
  { value: 'title-ascending', label: 'Alphabetically, A–Z' },
  { value: 'title-descending', label: 'Alphabetically, Z–A' },
  { value: 'price-ascending', label: 'Price, low to high' },
  { value: 'price-descending', label: 'Price, high to low' },
  { value: 'created-ascending', label: 'Date, old to new' },
  { value: 'created-descending', label: 'Date, new to old' },
];

export const DEFAULT_SORT = 'manual';

/** How many distinct values one facet may narrow by, so a URL cannot be a query plan. */
const MAX_VALUES_PER_FACET = 50;

/**
 * A price from the query string, in minor units.
 *
 * Returns null for anything that is not a finite, non-negative number — which
 * is dropped rather than passed on, because a NaN in a comparison silently
 * matches nothing and reads to a shopper as an empty catalogue.
 */
function priceFrom(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

/** Deduplicated, bounded, and stripped of empties. */
function valuesOf(params: URLSearchParams, name: string): readonly string[] {
  const unique = new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean));
  return [...unique].slice(0, MAX_VALUES_PER_FACET);
}

export function parseFilterCriteria(query: string): FilterCriteria {
  const params = new URLSearchParams(query);

  const priceMin = priceFrom(params.get(FILTER_PARAMS.priceMin));
  const priceMax = priceFrom(params.get(FILTER_PARAMS.priceMax));

  return {
    productTypes: valuesOf(params, FILTER_PARAMS.productType),
    vendors: valuesOf(params, FILTER_PARAMS.vendor),
    tags: valuesOf(params, FILTER_PARAMS.tag),
    /**
     * A reversed range is read as no range at all.
     *
     * "From 100 to 50" is a slider dragged past itself or a hand-edited URL.
     * Passing it through produces an empty page that looks like a broken
     * catalogue rather than an impossible request.
     */
    priceMin: priceMax !== null && priceMin !== null && priceMin > priceMax ? null : priceMin,
    priceMax: priceMax !== null && priceMin !== null && priceMin > priceMax ? null : priceMax,
  };
}

/**
 * Whether anything is filtered.
 *
 * Drives the canonical tag and `noindex` (§37.6): a filtered view is the same
 * collection seen through a narrower window, and every combination of ticks
 * indexed separately is duplicate content the merchant never asked for.
 */
export function facetsAreActive(criteria: FilterCriteria): boolean {
  return (
    criteria.productTypes.length > 0 ||
    criteria.vendors.length > 0 ||
    criteria.tags.length > 0 ||
    criteria.priceMin !== null ||
    criteria.priceMax !== null
  );
}

/** A sort key from the query string, or the default if it is not one we know. */
export function parseSort(query: string, fallback: string = DEFAULT_SORT): string {
  const requested = new URLSearchParams(query).get('sort_by')?.trim() ?? '';
  const known = SORT_OPTIONS.some((option) => option.value === requested);
  return known ? requested : fallback;
}

/** The sort list with the current one marked, which is what a theme renders. */
export function sortOptionsFor(
  current: string,
): readonly { value: string; label: string; active: boolean }[] {
  return SORT_OPTIONS.map((option) => ({ ...option, active: option.value === current }));
}

/**
 * Every parameter that changes what a collection page shows.
 *
 * The page cache keys on the parameters a render READ, learned by watching a
 * theme touch `request.params`. These are read by the platform rather than by
 * the theme, so nothing would record them — and a filtered page would be
 * stored under, and served from, the unfiltered key. Listed unconditionally,
 * because absence is one of a parameter's values: a page rendered without
 * `sort_by` must not answer a request that has one.
 */
export const FACET_PARAM_KEYS: readonly string[] = [
  ...Object.values(FILTER_PARAMS),
  'sort_by',
];

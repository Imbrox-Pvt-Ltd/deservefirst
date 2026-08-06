/**
 * Storefront · domain/drops/search.ts
 * What a shopper is probably looking for, while they are still typing.
 *
 * The theme's search field fetches this on every keystroke and renders whatever
 * comes back into a dropdown. It asks for five kinds of thing at once —
 * products, collections, pages, articles, and previous queries — because a
 * shopper typing "ret" may want the returns POLICY rather than any product,
 * and a dropdown that only ever offers products cannot help them.
 *
 * `resources` is a nested object rather than five accessors, which looks like
 * ceremony and is not: the theme counts them all before rendering anything —
 *
 *     assign product_count = predictive_search.resources.products.size
 *
 * — so the shape is what a theme reads, and flattening it would mean every
 * theme written elsewhere needed editing.
 * Layer: domain (pure).
 */

import { defineDrop, dropList, type DropContext } from './define';
import { collectionDrop, productDrop, type CollectionRow, type ProductRow } from './catalog';
import { articleDrop, pageDrop, type ArticleRow, type PageRow } from './content';

export interface SearchResults {
  readonly products: readonly ProductRow[];
  readonly collections: readonly CollectionRow[];
  readonly pages: readonly PageRow[];
  readonly articles: readonly ArticleRow[];
  /**
   * Suggested completions of what they are typing.
   *
   * Empty until the platform records what people search for. Present as a key
   * because the theme counts it, and a missing count breaks the arithmetic that
   * decides how many columns the dropdown has.
   */
  readonly queries: readonly { readonly text: string; readonly url: string }[];
}

export interface PredictiveSearchRow {
  /** Whether a search was actually run. False before anyone has typed. */
  readonly performed: boolean;
  readonly terms: string;
  readonly results: SearchResults;
}

const queryDrop = defineDrop<{ text: string; url: string }>('search_query', {
  text: (query) => query.text,
  /** What the theme highlights — the part the shopper has not typed yet. */
  styled_text: (query) => query.text,
  url: (query) => query.url,
});

const resourcesDrop = defineDrop<SearchResults>('predictive_search_resources', {
  products: (results, context: DropContext) => dropList(productDrop, results.products, context),
  collections: (results, context: DropContext) =>
    dropList(collectionDrop, results.collections, context),
  pages: (results, context: DropContext) => dropList(pageDrop, results.pages, context),
  articles: (results, context: DropContext) => dropList(articleDrop, results.articles, context),
  queries: (results, context: DropContext) => dropList(queryDrop, results.queries, context),
});

export const predictiveSearchDrop = defineDrop<PredictiveSearchRow>('predictive_search', {
  performed: (row) => row.performed,
  terms: (row) => row.terms,
  resources: (row, context) => resourcesDrop(row.results, context),
});

/** Nothing searched for, which is every page that is not the suggest endpoint. */
export const NO_SEARCH: PredictiveSearchRow = {
  performed: false,
  terms: '',
  results: { products: [], collections: [], pages: [], articles: [], queries: [] },
};

/**
 * A shopper's search term, made safe to put in a `LIKE`.
 *
 * The wildcards are escaped rather than stripped: somebody searching for "50%"
 * means those characters, and `%` left alone matches the entire catalogue —
 * which reads as a search box that ignores what you typed.
 *
 * Bounded because it arrives in a query string on every keystroke.
 */
export function normaliseSearchTerms(input: unknown): string {
  return String(input ?? '')
    .trim()
    .slice(0, 100)
    .replace(/[%_\\]/g, (character) => `\\${character}`);
}

/**
 * Storefront · domain/drops/recommendations.ts
 * Products worth showing beside this one.
 *
 * The theme's UI for this is already built and has been waiting: its product
 * page renders a `related-products` element whose script fetches a section and
 * drops the result into the page. Nothing answered that fetch, so the element
 * sat empty on every product page.
 *
 * `performed` is the property that matters and the reason this is an object
 * rather than a list. A theme asks:
 *
 *     {% if recommendations.performed and recommendations.products_count > 0 %}
 *
 * because the same template renders in two situations: on the product page,
 * where recommendations have NOT been asked for, and inside the section
 * fetched afterwards, where they have. Without `performed` a theme cannot tell
 * "nobody asked yet" from "asked, and there are none" — and would render an
 * empty carousel on every product page while it waited.
 * Layer: domain (pure).
 */

import { defineDrop, dropList, type DropContext } from './define';
import { productDrop, type ProductRow } from './catalog';

export interface RecommendationsRow {
  /**
   * Whether a recommendation was actually requested.
   *
   * False on an ordinary product page. True only inside the section rendered
   * for the recommendations route.
   */
  readonly performed: boolean;
  /** `related` or `complementary` — what the caller asked for. */
  readonly intent: string;
  readonly products: readonly ProductRow[];
}

export const recommendationsDrop = defineDrop<RecommendationsRow>('recommendations', {
  performed: (row) => row.performed,
  intent: (row) => row.intent,
  products: (row, context: DropContext) => dropList(productDrop, row.products, context),
  products_count: (row) => row.products.length,
});

/**
 * What a page has when nobody has asked for recommendations.
 *
 * Present rather than absent, and that is the point. An undefined
 * `recommendations` makes `{% if recommendations.performed %}` false too, so a
 * theme behaves the same either way — but only by accident, and the accident
 * stops holding the moment a theme writes `{% unless recommendations.performed %}`
 * or reads `products_count` directly. Saying "asked: no" is an answer; saying
 * nothing is a guess that happens to look like one.
 */
export const NOT_PERFORMED: RecommendationsRow = {
  performed: false,
  intent: 'related',
  products: [],
};

/**
 * The intents a caller may ask for.
 *
 * An allow-list because the value arrives in a query string and is echoed back
 * into the rendered section. Anything else is treated as `related`, which is
 * the ordinary case, rather than refused — a theme asking for an intent we do
 * not know should get products, not an error.
 */
export function normaliseIntent(value: unknown): string {
  const intent = String(value ?? '').trim().toLowerCase();
  return intent === 'complementary' ? 'complementary' : 'related';
}

/**
 * How many products to return.
 *
 * Bounded because the number arrives in a query string. The reference theme
 * asks for ten; a request for ten thousand is either a mistake or an attempt to
 * make one query expensive.
 */
export function normaliseLimit(value: unknown, fallback = 10, max = 50): number {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}

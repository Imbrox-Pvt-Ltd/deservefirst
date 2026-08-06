/**
 * Storefront · domain/drops/routes.ts
 * Where things live on a storefront, as a theme asks for them.
 *
 * Themes never hardcode `/cart` or `/search`. They write `{{ routes.cart_url }}`,
 * because the paths differ by locale and by platform — and a theme that
 * hardcoded them would break on the first store that was not in English.
 *
 * There was no `routes` drop, so every one of those rendered EMPTY. The
 * reference theme puts them into a JavaScript config block on every page:
 *
 *     routes: { cart_url: '', cart_add_url: '', search_url: '', … }
 *
 * Empty strings, on every page, feeding every script that fetches anything. A
 * `fetch('')` requests the current page, so a theme's cart and search calls
 * were not failing loudly — they were quietly requesting the page they were
 * already on and parsing the result as JSON.
 *
 * The paths are the reference product's, because themes are written against
 * them. `/cart/add.js` is not our naming choice to make: a theme's JavaScript
 * posts there whether or not we would have picked it.
 * Layer: domain (pure).
 */

import { defineDrop } from './define';

/**
 * The storefront's own routes.
 *
 * A source of nothing — every value is derived — so the row is empty and the
 * drop is really a named table of constants. It is a drop rather than a plain
 * object so a theme reading `routes.something_we_do_not_have` gets the same
 * treatment as any other unknown property, and so `theme:check` can see it.
 */
export interface RoutesRow {
  /**
   * The prefix every path hangs off.
   *
   * Empty for a store at the domain root, which is every store today. It exists
   * because localised storefronts serve `/fr/products/…`, and a theme that
   * built its own URLs would send a French customer to the English page.
   */
  readonly root?: string;
}

const path = (root: string | undefined, rest: string): string => `${root ?? ''}${rest}`;

export const routesDrop = defineDrop<RoutesRow>('routes', {
  /**
   * `/` rather than the empty string.
   *
   * A theme writes `href="{{ routes.root_url }}"`, and an empty value there is
   * a link to the current page — so the logo would stop going home.
   */
  root_url: (routes) => path(routes.root, '/') || '/',

  all_products_collection_url: (routes) => path(routes.root, '/collections/all'),
  collections_url: (routes) => path(routes.root, '/collections'),

  search_url: (routes) => path(routes.root, '/search'),
  /** Where a type-ahead asks for suggestions. */
  predictive_search_url: (routes) => path(routes.root, '/search/suggest'),

  cart_url: (routes) => path(routes.root, '/cart'),
  /**
   * The `.js` endpoints, spelled as themes expect.
   *
   * A theme's JavaScript posts to these by name; the extension is part of the
   * contract rather than a file type. Naming them anything else would mean
   * every theme needed editing to add a product to a cart.
   */
  cart_add_url: (routes) => path(routes.root, '/cart/add'),
  cart_change_url: (routes) => path(routes.root, '/cart/change'),
  cart_update_url: (routes) => path(routes.root, '/cart/update'),
  cart_clear_url: (routes) => path(routes.root, '/cart/clear'),

  /** The section-rendering endpoint the related-products script fetches. */
  product_recommendations_url: (routes) => path(routes.root, '/recommendations/products'),

  account_url: (routes) => path(routes.root, '/account'),
  account_login_url: (routes) => path(routes.root, '/account/login'),
  account_logout_url: (routes) => path(routes.root, '/account/logout'),
  account_register_url: (routes) => path(routes.root, '/account/register'),
  account_addresses_url: (routes) => path(routes.root, '/account/addresses'),
  account_recover_url: (routes) => path(routes.root, '/account/recover'),
});

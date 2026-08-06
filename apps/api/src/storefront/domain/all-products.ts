/**
 * Storefront · domain/all-products.ts
 * The collection every store has without anybody creating it.
 *
 * `/collections/all` is not a merchant's collection. It is the automatic one
 * holding every product they sell, and themes link to it constantly — "Shop
 * all", the empty-search fallback, the menu item a theme ships with. The
 * reference theme's own settings point at it six times.
 *
 * We answered 404. A store with products had a "Shop all" link leading nowhere,
 * which is worse than a missing link: the navigation promises a page that does
 * not exist.
 *
 * The handle is reserved rather than invented — a merchant who has genuinely
 * created a collection called `all` keeps it. That ordering matters more than
 * it looks: silently shadowing a real collection would hide products a merchant
 * deliberately grouped, and they would have no way to tell why.
 * Layer: domain (pure).
 */

import type { CollectionRow } from './drops';

/**
 * The handle, and the id the synthetic row carries.
 *
 * The same string for both, because there is no row to have an id of its own
 * and the relation loaders need something to key on. `productsOfCollection`
 * recognises it and answers with the whole catalogue.
 */
export const ALL_PRODUCTS_HANDLE = 'all';

/** Whether a handle refers to the automatic collection. */
export function isAllProducts(handle: string): boolean {
  return handle === ALL_PRODUCTS_HANDLE;
}

/**
 * The collection row for `/collections/all`.
 *
 * `title` is the store's own name for it rather than a hardcoded English
 * string, because a theme renders `{{ collection.title }}` as the page heading
 * and "All products" on a French storefront is a bug a merchant cannot fix.
 * The caller passes what the shop calls it.
 */
export function allProductsCollection(title: string): CollectionRow {
  return {
    id: ALL_PRODUCTS_HANDLE,
    handle: ALL_PRODUCTS_HANDLE,
    title,
    description: null,
    imageId: null,
  };
}

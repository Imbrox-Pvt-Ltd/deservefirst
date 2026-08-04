/**
 * Web · lib/stores.ts
 * Which store a handle refers to, and the list-state plumbing every list screen
 * repeats.
 *
 * The handle → id map was copied into every page and every action file. That is
 * fine while it is a stub and actively harmful the moment it is not: the real
 * lookup is a session concern, and it needs one place to become one.
 * Layer: web/lib.
 */

import type { SavedView } from '@deservefirst/contracts';

/** Seeded stores, until the identity API serves the operator's real list. */
export const STORES: readonly { id: string; handle: string; name: string }[] = [
  { id: 'seed-store-us', handle: 'acme-us', name: 'Acme US' },
  { id: 'seed-store-in', handle: 'acme-in', name: 'Acme India' },
];

export function storeIdFor(handle: string): string {
  return STORES.find((store) => store.handle === handle)?.id ?? STORES[0]!.id;
}

/**
 * Next hands search params as `string | string[] | undefined`; the list engine
 * wants a URLSearchParams. Repeated arrays take their first value — a duplicated
 * `?query=` is a malformed URL, not a request to filter twice.
 */
export function listQueryFrom(
  search: Record<string, string | string[] | undefined>,
  views: readonly SavedView[] = [],
): URLSearchParams {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  // A saved view supplies the filter only when the URL does not already carry
  // one, so editing filters while a view is selected does not snap back.
  const view = views.find((entry) => entry.id === query.get('savedViewId'));
  if (view?.query && !query.get('query')) query.set('query', view.query);

  return query;
}

/** The full store-operator permission set, until sessions carry real grants. */
export const ALL_PERMISSIONS = [
  'store.read', 'store.settings.read', 'store.settings.manage',
  'catalog.read', 'catalog.write',
  'orders.read', 'orders.manage', 'orders.quote',
  'customers.read', 'customers.manage',
  'inventory.read', 'inventory.adjust', 'inventory.manage',
  'content.read', 'content.manage', 'content.publish',
];

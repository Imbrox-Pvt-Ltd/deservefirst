/**
 * Storefront · domain/drops/availability.ts
 * Whether a customer can collect this from somewhere near them.
 *
 * A theme asks `variant.store_availabilities`, filters it to the locations that
 * take collections, and shows the nearest one — "Pick up available at Camden,
 * usually ready in 24 hours". The reference theme fetches it as a section the
 * moment a variant is chosen.
 *
 * The list is per VARIANT rather than per product, and that is the whole point:
 * a shop has the medium in stock and not the large, and an answer about the
 * product would tell a customer they can collect something they cannot.
 *
 * `available` and `pick_up_enabled` are separate. A location may take
 * collections and have none of this variant; a warehouse may have plenty and
 * accept no visitors. Collapsing them into one flag loses whichever half the
 * merchant would have wanted to explain.
 * Layer: domain (pure).
 */

import { defineDrop } from './define';

export interface LocationRow {
  readonly id: string;
  readonly name: string;
  readonly address?: string | null;
  readonly countryCode?: string | null;
}

export interface StoreAvailabilityRow {
  /** Stock of THIS variant at THIS location, not the product's total. */
  readonly available: boolean;
  readonly pickUpEnabled: boolean;
  /** The merchant's own promise: "Usually ready in 24 hours". */
  readonly pickUpTime?: string | null;
  readonly location: LocationRow;
}

export const locationDrop = defineDrop<LocationRow>('location', {
  id: (location) => location.id,
  name: (location) => location.name,
  /**
   * The address as the merchant wrote it.
   *
   * A theme renders it beside the shop name, and a structured address would
   * mean deciding the order of its lines — which differs by country and is the
   * merchant's business rather than ours.
   */
  address: (location) => location.address ?? '',
});

export const storeAvailabilityDrop = defineDrop<StoreAvailabilityRow>('store_availability', {
  available: (row) => row.available,
  pick_up_enabled: (row) => row.pickUpEnabled,
  /**
   * Empty rather than a default like "Usually ready in 24 hours".
   *
   * Inventing a collection time would put a promise on a merchant's storefront
   * that nobody at that shop has agreed to keep.
   */
  pick_up_time: (row) => row.pickUpTime ?? '',
  location: (row, context) => locationDrop(row.location, context),
});

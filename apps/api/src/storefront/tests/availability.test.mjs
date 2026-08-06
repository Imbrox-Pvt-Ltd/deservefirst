/**
 * Storefront · tests/availability.test.mjs
 * Whether a customer can collect this from somewhere near them.
 *
 * The distinction that shapes everything here: a location may take collections
 * and have none of this variant, and a warehouse may have plenty and accept no
 * visitors. Collapsing those into one flag loses whichever half the merchant
 * would have wanted to explain — and putting a fulfilment centre's address on a
 * storefront is the version of that mistake customers notice.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDropContext,
  storeAvailabilityDrop,
  variantDrop,
} from '../../../dist/storefront/domain/index.js';

const shop = (over = {}) => ({
  available: true,
  pickUpEnabled: true,
  pickUpTime: 'Usually ready in 24 hours',
  location: { id: 'l1', name: 'Camden Shop', address: '12 Camden High St' },
  ...over,
});

const context = (availabilities = []) =>
  createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: () => [], productCountOfCollection: () => 0,
      availabilitiesOfVariant: () => availabilities,
    },
  });

test('stock and collection are separate answers', () => {
  /**
   * A warehouse with the whole catalogue and no public door is
   * `available: true, pick_up_enabled: false`. A shop that takes collections
   * and has sold out is the reverse. One flag cannot say either.
   */
  const warehouse = storeAvailabilityDrop(
    shop({ available: true, pickUpEnabled: false, location: { id: 'l2', name: 'Depot' } }),
    context(),
  );
  assert.equal(warehouse.available, true);
  assert.equal(warehouse.pick_up_enabled, false);

  const soldOut = storeAvailabilityDrop(shop({ available: false }), context());
  assert.equal(soldOut.available, false);
  assert.equal(soldOut.pick_up_enabled, true);
});

test('the collection time is the merchant’s own words, or nothing', () => {
  // Inventing "usually ready in 24 hours" would put a promise on a storefront
  // that nobody at that shop has agreed to keep.
  assert.equal(storeAvailabilityDrop(shop(), context()).pick_up_time, 'Usually ready in 24 hours');
  assert.equal(storeAvailabilityDrop(shop({ pickUpTime: null }), context()).pick_up_time, '');
});

test('the location renders as the merchant wrote it', () => {
  const availability = storeAvailabilityDrop(shop(), context());
  const location = availability.location;
  assert.equal(location.name, 'Camden Shop');
  assert.equal(location.address, '12 Camden High St');
});

test('a location with no address renders empty, not "undefined"', () => {
  const availability = storeAvailabilityDrop(
    shop({ location: { id: 'l3', name: 'Pop-up' } }),
    context(),
  );
  assert.equal(availability.location.address, '');
});

test('availabilities hang off the VARIANT, not the product', async () => {
  /**
   * A shop has the medium and not the large. An answer about the product would
   * tell a customer they can collect something they cannot.
   */
  const variant = variantDrop({ id: 'v1', productId: 'p1' }, context([shop(), shop({ available: false })]));
  const availabilities = await variant.store_availabilities;

  assert.equal(availabilities.length, 2);
  assert.equal(await availabilities[0].available, true);
  assert.equal(await availabilities[1].available, false);
});

test('a variant nobody stocks anywhere has an empty list, not a failure', async () => {
  // The theme guards on `.size > 0` and renders nothing, which is the right
  // answer for a store that has no shops at all.
  const variant = variantDrop({ id: 'v1', productId: 'p1' }, context([]));
  assert.equal((await variant.store_availabilities).length, 0);
});

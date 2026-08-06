/**
 * Storefront · tests/recommendations.test.mjs
 * Products worth showing beside another one.
 *
 * The theme's UI for this was already built and waiting: a `related-products`
 * element whose script fetches a section and splices the result into the page.
 * Nothing answered that fetch, and `routes.product_recommendations_url` was
 * empty besides — so the script was fetching '' , which is the current page.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDropContext,
  NOT_PERFORMED,
  normaliseIntent,
  normaliseLimit,
  recommendationsDrop,
  routesDrop,
} from '../../../dist/storefront/domain/index.js';

const context = () =>
  createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: () => [], productCountOfCollection: () => 0,
    },
  });

const product = (id, title) => ({ id, title, handle: id, priceAmountMinor: '1000', inventoryQuantity: 1 });

// ------------------------------------------------------------- the object

test('`performed` distinguishes "not asked" from "asked, none found"', async () => {
  /**
   * The property the whole design turns on. The same theme template renders on
   * the product page, where nobody has asked, and inside the section fetched
   * afterwards, where somebody has. Without it a theme cannot tell the two
   * apart and renders an empty carousel while it waits.
   */
  const notAsked = recommendationsDrop(NOT_PERFORMED, context());
  assert.equal(notAsked.performed, false);
  assert.equal(notAsked.products_count, 0);

  const askedAndEmpty = recommendationsDrop(
    { performed: true, intent: 'related', products: [] },
    context(),
  );
  assert.equal(askedAndEmpty.performed, true, 'asked');
  assert.equal(askedAndEmpty.products_count, 0, 'and there were none');
});

test('the products come back as drops a theme can render', async () => {
  const recommendations = recommendationsDrop(
    { performed: true, intent: 'related', products: [product('tee', 'Tee'), product('coat', 'Coat')] },
    context(),
  );

  assert.equal(recommendations.products_count, 2);
  const products = await recommendations.products;
  assert.equal(await products[0].title, 'Tee');
  assert.equal(await products[0].url, '/products/tee');
});

test('an intent we do not know is treated as related, not refused', () => {
  // It arrives in a query string and is echoed into the rendered section. A
  // theme asking for something unfamiliar should get products, not an error.
  assert.equal(normaliseIntent('complementary'), 'complementary');
  assert.equal(normaliseIntent('related'), 'related');
  assert.equal(normaliseIntent('COMPLEMENTARY'), 'complementary');
  assert.equal(normaliseIntent('nonsense'), 'related');
  assert.equal(normaliseIntent(undefined), 'related');
});

test('the limit is bounded, because it arrives in a query string', () => {
  assert.equal(normaliseLimit('4'), 4);
  assert.equal(normaliseLimit(undefined), 10, 'the theme asks for ten');
  assert.equal(normaliseLimit('0'), 10);
  assert.equal(normaliseLimit('-5'), 10);
  assert.equal(normaliseLimit('nonsense'), 10);
  // A request for ten thousand is a mistake or an attempt to make one query
  // expensive.
  assert.equal(normaliseLimit('10000'), 50);
});

// ------------------------------------------------------------- the routes

test('every route a theme reads has a value', async () => {
  /**
   * There was no `routes` drop at all, so each of these rendered EMPTY — and
   * the reference theme writes them into a JavaScript config on every page. A
   * `fetch('')` requests the current page, so the theme's cart and search calls
   * were quietly fetching the page they were already on.
   */
  const routes = routesDrop({}, context());

  for (const [name, expected] of Object.entries({
    root_url: '/',
    cart_url: '/cart',
    cart_add_url: '/cart/add',
    cart_change_url: '/cart/change',
    cart_update_url: '/cart/update',
    search_url: '/search',
    predictive_search_url: '/search/suggest',
    product_recommendations_url: '/recommendations/products',
    all_products_collection_url: '/collections/all',
    account_url: '/account',
    account_addresses_url: '/account/addresses',
  })) {
    assert.equal(routes[name], expected, name);
  }
});

test('root_url is a slash, never the empty string', () => {
  // A theme writes `href="{{ routes.root_url }}"`, and an empty value there is
  // a link to the current page — so the logo would stop going home.
  assert.equal(routesDrop({}, context()).root_url, '/');
});

test('a localised store prefixes every route', () => {
  // The reason themes never hardcode these: a French customer following a
  // theme-built URL would land on the English page.
  const routes = routesDrop({ root: '/fr' }, context());
  assert.equal(routes.root_url, '/fr/');
  assert.equal(routes.cart_url, '/fr/cart');
  assert.equal(routes.product_recommendations_url, '/fr/recommendations/products');
});

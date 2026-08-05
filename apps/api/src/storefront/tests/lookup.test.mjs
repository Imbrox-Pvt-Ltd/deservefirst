/**
 * Storefront · tests/lookup.test.mjs
 * `all_products[handle]`, and the three guards that make it safe to expose.
 *
 * The feature is two lines in a theme. The guards are the work:
 *
 *   published only — a by-handle lookup is a handle oracle, so a loader that
 *                    returned drafts would let anyone read an unreleased
 *                    catalogue by guessing names
 *   a budget       — one lookup is a query; a lookup in a loop is a thousand
 *   normalised     — whatever arrives becomes a handle before it reaches a
 *                    loader, so nothing can be smuggled into a query
 *
 * Each is tested from the outside: real Liquid, through the real engine.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import {
  createDropContext,
  createLookupBudget,
  handleize,
  lookupDrop,
  MAX_LOOKUPS_PER_RENDER,
  productDrop,
  readableParams,
  requestDrop,
} from '../../../dist/storefront/domain/index.js';

const engine = createThemeEngine(defaultContext());

/** Two published products and one draft, which must never be reachable. */
const catalogue = {
  'my-product-handle': {
    id: 'p1', handle: 'my-product-handle', title: 'Linen Shirt',
    priceAmountMinor: '4500', status: 'active', inventoryQuantity: 3,
  },
  'summer-hat': {
    id: 'p2', handle: 'summer-hat', title: 'Summer Hat',
    priceAmountMinor: '2000', status: 'active', inventoryQuantity: 1,
  },
  'unreleased-jacket': {
    id: 'p3', handle: 'unreleased-jacket', title: 'Unreleased Jacket',
    priceAmountMinor: '9900', status: 'draft', inventoryQuantity: 0,
  },
};

let queries = 0;

/** The loader the composition root supplies: store-scoped AND published-only. */
function publishedLoader(handle) {
  queries++;
  const row = catalogue[handle];
  return row && row.status === 'active' ? row : null;
}

function scopeFor(budget = createLookupBudget()) {
  const context = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://shop.test',
    load: { variantsOfProduct: () => [], imagesOfProduct: () => [] },
  });
  return {
    budget,
    all_products: lookupDrop(
      { load: publishedLoader, factory: productDrop, budget, publishedOnly: true },
      context,
    ),
  };
}

// ------------------------------------------------------- the feature works

test('a query parameter can drive a product lookup', async () => {
  /**
   * The whole request, end to end: a URL parameter becomes a handle becomes a
   * rendered product.
   */
  queries = 0;
  const { params } = readableParams('product-handle=my-product-handle');
  const { all_products } = scopeFor();
  const request = requestDrop(
    { path: '/pages/blogs', host: 'h', origin: 'https://h', pageType: 'page',
      locale: 'en', currency: 'USD', designMode: false, params },
    createDropContext({ currency: 'USD', locale: 'en', baseUrl: '', load: {} }),
  );

  const html = await engine.render(
    `{% assign handle = request.params['product-handle'] %}` +
      `{% assign product = all_products[handle] %}` +
      `{% if product %}{{ product.title }} — {{ product.price | money }}{% else %}not found{% endif %}`,
    { request, all_products },
  );

  assert.equal(html, 'Linen Shirt — $45.00');
  assert.equal(queries, 1);
});

test('an absent handle renders the theme fallback rather than failing', async () => {
  const { all_products } = scopeFor();
  const html = await engine.render(
    `{% assign p = all_products['no-such-thing'] %}{% if p %}{{ p.title }}{% else %}not found{% endif %}`,
    { all_products },
  );
  assert.equal(html, 'not found');
});

// -------------------------------------------------------- published only

test('a draft product is not reachable by handle', async () => {
  /**
   * The enumeration risk. Someone who guesses or scrapes a name must not be
   * able to read an unreleased product — this is why the reference product's
   * `all_products` is published-only, and why ours takes a loader that is.
   */
  const { all_products } = scopeFor();
  const html = await engine.render(
    `{% assign p = all_products['unreleased-jacket'] %}{% if p %}LEAKED {{ p.title }}{% else %}hidden{% endif %}`,
    { all_products },
  );
  assert.equal(html, 'hidden');
});

test('the draft really is in the catalogue, so the test above means something', () => {
  assert.equal(catalogue['unreleased-jacket'].title, 'Unreleased Jacket');
});

// --------------------------------------------------------------- budget

test('a lookup inside a loop cannot run away', async () => {
  /**
   * The performance risk, and the reason a ceiling exists at all. Without it
   * this template is a thousand queries from one HTTP request.
   */
  queries = 0;
  const { all_products, budget } = scopeFor();

  const html = await engine.render(
    `{% for i in (1..1000) %}` +
      `{% assign p = all_products[i] %}{% if p %}x{% endif %}` +
      `{% endfor %}done`,
    { all_products },
  );

  assert.equal(html, 'done');
  assert.equal(budget.used(), MAX_LOOKUPS_PER_RENDER);
  assert.ok(queries <= MAX_LOOKUPS_PER_RENDER, `${queries} queries ran`);
});

test('repeating one handle is free', async () => {
  // The budget counts distinct handles, so a theme reading the same product in
  // a header, a card and a footer pays once.
  queries = 0;
  const { all_products, budget } = scopeFor();

  await engine.render(
    `{% for i in (1..50) %}{{ all_products['summer-hat'].title }}{% endfor %}`,
    { all_products },
  );

  assert.equal(budget.used(), 1);
  assert.equal(queries, 1);
});

test('going over budget yields nil, not an error', async () => {
  // A theme that loops too far should render an incomplete page rather than a
  // failed one, and `{% if product %}` already handles nil.
  const budget = createLookupBudget(2);
  const { all_products } = scopeFor(budget);

  const html = await engine.render(
    `{{ all_products['my-product-handle'].title }}|` +
      `{{ all_products['summer-hat'].title }}|` +
      `{% assign third = all_products['another'] %}{% if third %}yes{% else %}no{% endif %}`,
    { all_products },
  );

  assert.equal(html, 'Linen Shirt|Summer Hat|no');
  assert.deepEqual(budget.refused(), ['another']);
});

// ------------------------------------------------------- normalised keys

test('a hostile handle is normalised before it reaches the loader', async () => {
  const seen = [];
  const context = createDropContext({ currency: 'USD', locale: 'en', baseUrl: '', load: {} });
  const all_products = lookupDrop(
    {
      load: (handle) => { seen.push(handle); return null; },
      factory: productDrop,
      budget: createLookupBudget(),
      publishedOnly: true,
    },
    context,
  );

  await engine.render(
    `{{ all_products['../../etc/passwd'] }}{{ all_products["' OR 1=1 --"] }}`,
    { all_products },
  );

  // Whatever arrived, the loader only ever saw a handle.
  for (const handle of seen) {
    assert.match(handle, /^[a-z0-9_-]*$/, `loader received "${handle}"`);
  }
  assert.ok(!seen.some((h) => h.includes('..')), seen.join(','));
});

test('an escaped parameter still resolves a real handle', async () => {
  /**
   * Worth pinning: parameters are HTML-escaped before a theme sees them, and a
   * lookup key goes through handleize. Neither step may break the ordinary
   * case, which is a plain lowercase handle.
   */
  const { params } = readableParams('h=my-product-handle');
  assert.equal(params.h, 'my-product-handle');
  assert.equal(handleize(params.h), 'my-product-handle');
});

test('the lookup object cannot be enumerated', async () => {
  /**
   * `{% for p in all_products %}` would otherwise be a request to load the
   * whole catalogue — the one thing a by-handle object must never become.
   */
  queries = 0;
  const { all_products } = scopeFor();
  const html = await engine.render(
    `{% for p in all_products %}{{ p.title }}{% endfor %}[done]`,
    { all_products },
  );
  assert.equal(html, '[done]');
  assert.equal(queries, 0);
});

test('the engine probing the object does not spend budget', async () => {
  // liquidjs looks for `then`, `next` and `toLiquid` on rendered values; each
  // would otherwise be a wasted query against a handle nobody asked for.
  const { all_products, budget } = scopeFor();
  await engine.render(`{{ all_products['summer-hat'].title }}`, { all_products });
  assert.equal(budget.used(), 1);
});

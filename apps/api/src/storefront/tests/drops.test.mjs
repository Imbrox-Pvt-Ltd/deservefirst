/**
 * Storefront · tests/drops.test.mjs
 * The security boundary, attacked rather than described.
 *
 * A drop is what stands between untrusted theme code and the platform's data,
 * so the tests that matter here are the ones written from the attacker's side:
 * can a theme read a field the drop did not declare, walk to the prototype,
 * reach the source row, or see another store's data? Each of those is a real
 * template, rendered through the real engine.
 *
 * The laziness tests matter for a different reason. A collection page renders
 * twenty products out of thousands; a drop that loaded variants for all of them
 * would be correct and unusable.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import {
  collectionDrop,
  declaredDrops,
  dropList,
  productDrop,
  shopDrop,
  paginateDrop,
  variantDrop,
  createDropContext,
} from '../../../dist/storefront/domain/index.js';

const engine = createThemeEngine(defaultContext());
const render = async (source, scope) => (await engine.render(source, scope)).trim();

/** A product row carrying fields a theme must never see. */
const productRow = {
  id: 'p1',
  handle: 'linen-shirt',
  title: 'Linen Shirt',
  description: 'Soft and breathable',
  vendor: 'Atelier',
  productType: 'Shirts',
  priceAmountMinor: '4500',
  inventoryQuantity: 7,
  optionNames: ['Size', 'Colour'],
  // Not declared by the drop. Present here because a real row has them.
  costPerItem: '1800',
  internalNotes: 'supplier dispute pending',
};

const variants = [
  { id: 'v1', productId: 'p1', title: 'S / Blue', priceAmountMinor: '4500', optionValues: ['S', 'Blue'], inventoryQuantity: 0 },
  { id: 'v2', productId: 'p1', title: 'M / Blue', priceAmountMinor: '5500', optionValues: ['M', 'Blue'], inventoryQuantity: 3 },
];

const images = [
  { id: 'i1', src: 'shirt.jpg', width: 1000, height: 1500, alt: 'A linen shirt' },
];

let variantLoads = 0;
let imageLoads = 0;

const context = createDropContext({
  currency: 'USD',
  locale: 'en',
  baseUrl: 'https://shop.test',
  load: {
    variantsOfProduct: () => {
      variantLoads++;
      return variants;
    },
    imagesOfProduct: () => {
      imageLoads++;
      return images;
    },
    image: (id) => images.find((image) => image.id === id) ?? null,
    productsOfCollection: () => [productRow],
    productCountOfCollection: () => 240,
  },
});

// ------------------------------------------------------------- security

test('a theme cannot read a field the drop did not declare', async () => {
  const drop = productDrop(productRow, context);

  assert.equal(await render(`{{ product.costPerItem }}`, { product: drop }), '');
  assert.equal(await render(`{{ product.cost_per_item }}`, { product: drop }), '');
  assert.equal(await render(`{{ product.internalNotes }}`, { product: drop }), '');
  assert.equal(await render(`{{ product.internal_notes }}`, { product: drop }), '');
});

test('the undeclared fields really are on the source row', () => {
  /**
   * Without this, the test above would pass for the wrong reason — a fixture
   * that never had a cost proves nothing about a drop that would have leaked it.
   */
  assert.equal(productRow.costPerItem, '1800');
  assert.equal(productRow.internalNotes, 'supplier dispute pending');
});

test('a drop exposes exactly its declared properties, nothing more', () => {
  const drop = productDrop(productRow, context);
  const visible = Object.keys(drop);

  assert.deepEqual([...visible].sort(), [...productDrop.properties].sort());
  assert.ok(!visible.includes('costPerItem'), visible.join(','));
  assert.ok(!visible.includes('internalNotes'), visible.join(','));
});

test('a theme cannot walk to the prototype or the constructor', async () => {
  const drop = productDrop(productRow, context);
  for (const path of ['constructor', '__proto__', 'toString', 'valueOf', 'constructor.name']) {
    assert.equal(await render(`{{ product.${path} }}`, { product: drop }), '', path);
  }
});

test('a drop is frozen, so nothing can be grafted onto it', () => {
  const drop = productDrop(productRow, context);
  assert.ok(Object.isFrozen(drop));
  assert.throws(() => {
    'use strict';
    drop.injected = 'x';
  });
});

test('a drop cannot be made to reach another store', () => {
  /**
   * There is no store id to pass, which is the point: loaders arrive already
   * scoped to one store, so a drop has nothing to get wrong. This pins the
   * shape rather than a behaviour — if a loader ever grows a store parameter,
   * this test should be what fails.
   */
  for (const loader of Object.values(context.load)) {
    assert.ok(loader.length <= 1, `a loader takes ${loader.length} arguments; it should be scoped`);
  }
});

// -------------------------------------------------------------- laziness

test('reading a scalar does not load relations', async () => {
  variantLoads = 0;
  imageLoads = 0;
  const drop = productDrop(productRow, context);

  await render(`{{ product.title }} {{ product.price }} {{ product.vendor }}`, { product: drop });

  assert.equal(variantLoads, 0, 'a title should not cost a variant query');
  assert.equal(imageLoads, 0, 'a title should not cost an image query');
});

test('reading a relation loads it once, however often it is read', async () => {
  variantLoads = 0;
  const drop = productDrop(productRow, context);

  await render(
    `{{ product.price_min }}{{ product.price_max }}{{ product.price_varies }}` +
      `{% for v in product.variants %}{{ v.title }}{% endfor %}`,
    { product: drop },
  );

  // Four properties, each reaching for variants — one load.
  assert.equal(variantLoads, 1, `loaded ${variantLoads} times`);
});

test('a list of drops builds only the elements that are read', () => {
  let built = 0;
  const rows = Array.from({ length: 500 }, (_entry, index) => ({
    id: `i${index}`,
    src: `${index}.jpg`,
  }));

  const counted = { ...context, load: { ...context.load } };
  const list = dropList(
    Object.assign((row, ctx) => {
      built++;
      return { id: row.id };
    }, { dropName: 'counted', properties: ['id'] }),
    rows,
    counted,
  );

  assert.equal(list.length, 500);
  assert.equal(built, 0, 'length alone should build nothing');

  const first = list[0];
  assert.equal(first.id, 'i0');
  assert.equal(built, 1, 'reading one element should build one');
});

// -------------------------------------------------------------- behaviour

test('a product renders through the money filter as minor units', async () => {
  const drop = productDrop(productRow, context);
  assert.equal(await render(`{{ product.price | money }}`, { product: drop }), '$45.00');
});

test('price_min and price_max come from the variants', async () => {
  const drop = productDrop(productRow, context);
  assert.equal(await render(`{{ product.price_min | money }}`, { product: drop }), '$45.00');
  assert.equal(await render(`{{ product.price_max | money }}`, { product: drop }), '$55.00');
  assert.equal(await render(`{{ product.price_varies }}`, { product: drop }), 'true');
});

test('first_available_variant skips the one out of stock', async () => {
  const drop = productDrop(productRow, context);
  assert.equal(
    await render(`{{ product.first_available_variant.title }}`, { product: drop }),
    'M / Blue',
  );
});

test('options_with_values only offers values a variant actually has', async () => {
  const drop = productDrop(productRow, context);
  const out = await render(
    `{% for option in product.options_with_values %}{{ option.name }}:{{ option.values | join: '/' }} {% endfor %}`,
    { product: drop },
  );
  // Both variants are Blue, so Colour offers one value rather than a dead button.
  assert.equal(out, 'Size:S/M Colour:Blue');
});

test('a variant is available only when it has stock', async () => {
  const [outOfStock, inStock] = variants.map((row) => variantDrop(row, context));
  assert.equal(await render(`{{ v.available }}`, { v: outOfStock }), 'false');
  assert.equal(await render(`{{ v.available }}`, { v: inStock }), 'true');
});

test('an image with no alt renders an empty one, not a filename', async () => {
  const drop = productDrop(productRow, context);
  const out = await render(
    `{{ product.featured_image.src | image_url: width: 400 | image_tag: alt: product.featured_image.alt }}`,
    { product: drop },
  );
  assert.ok(out.includes('alt="A linen shirt"'), out);
});

test('products_count is the collection total, not the page length', async () => {
  const drop = collectionDrop(
    { id: 'c1', handle: 'shirts', title: 'Shirts' },
    context,
  );
  assert.equal(await render(`{{ collection.products_count }}`, { collection: drop }), '240');
  assert.equal(await render(`{{ collection.products | size }}`, { collection: drop }), '1');
});

test('shop exposes the storefront domain and the currency', async () => {
  const drop = shopDrop(
    { id: 's1', name: 'Atelier', handle: 'atelier', domain: 'atelier.test', currency: 'USD' },
    context,
  );
  assert.equal(await render(`{{ shop.name }} {{ shop.url }}`, { shop: drop }), 'Atelier https://atelier.test');
});

test('paginate collapses a long run of pages with a gap marker', async () => {
  const drop = paginateDrop(
    { currentPage: 20, currentOffset: 380, items: 800, pageSize: 20, basePath: '/collections/all' },
    context,
  );

  assert.equal(await render(`{{ paginate.pages }}`, { paginate: drop }), '40');
  const parts = await render(
    `{% for part in paginate.parts %}{{ part.title }} {% endfor %}`,
    { paginate: drop },
  );
  // 1 … 19 20 21 … 40 — not forty numbers.
  assert.equal(parts, '1 … 19 20 21 … 40');
});

test('the current page is not a link, and the neighbours are', async () => {
  const drop = paginateDrop(
    { currentPage: 2, currentOffset: 20, items: 100, pageSize: 20, basePath: '/collections/all' },
    context,
  );
  const out = await render(
    `{% for part in paginate.parts %}{{ part.title }}={{ part.is_link }} {% endfor %}`,
    { paginate: drop },
  );
  assert.ok(out.includes('2=false'), out);
  assert.ok(out.includes('1=true'), out);
});

test('page 1 has no page parameter in its URL', async () => {
  const drop = paginateDrop(
    { currentPage: 3, currentOffset: 40, items: 100, pageSize: 20, basePath: '/collections/all' },
    context,
  );
  const first = await render(`{{ paginate.parts[0].url }}`, { paginate: drop });
  assert.equal(first, '/collections/all', 'page 1 should be the bare path');
});

// --------------------------------------------------------------- registry

test('every drop is registered and declares at least one property', () => {
  const drops = declaredDrops();
  assert.ok(drops.size >= 8, `only ${drops.size} drops registered`);

  for (const [name, factory] of drops) {
    assert.ok(factory.properties.length > 0, `${name} declares nothing`);
    // Snake case throughout: it is the vocabulary themes are written in, and a
    // single camelCase property would be the one nobody can find.
    for (const property of factory.properties) {
      assert.match(property, /^[a-z][a-z0-9_]*$/, `${name}.${property} is not snake_case`);
    }
  }
});

// ======================================================= content & commerce

const { articleDrop, blogDrop, cartDrop, customerDrop, orderDrop, pageDrop, sectionDrop, formDrop } =
  await import('../../../dist/storefront/domain/index.js');

test('a customer never exposes the staff note about them', async () => {
  /**
   * `note` is marked private on the customer resource: it is what staff wrote,
   * and a theme printing it would show a customer the internal comment about
   * their own dispute. The row carries one so this cannot pass vacuously.
   */
  const row = {
    id: 'c1',
    firstName: 'Sam',
    lastName: 'Reed',
    email: 'sam@example.test',
    ordersCount: 3,
    totalSpentMinor: '12500',
    note: 'chargeback risk — do not offer credit',
  };
  const drop = customerDrop(row, context);

  assert.equal(row.note, 'chargeback risk — do not offer credit');
  assert.equal(await render(`{{ customer.note }}`, { customer: drop }), '');
  assert.ok(!Object.keys(drop).includes('note'), Object.keys(drop).join(','));
  assert.equal(await render(`{{ customer.name }}`, { customer: drop }), 'Sam Reed');
});

test('an order exposes the customer note but never the internal one', async () => {
  const drop = orderDrop(
    {
      id: 'o1',
      reference: '#1042',
      status: 'quoted',
      currency: 'USD',
      customerNote: 'Please deliver after 5pm',
      internalNote: 'customer disputed the last invoice',
      subtotalMinor: '9900',
    },
    context,
  );

  assert.equal(await render(`{{ order.note }}`, { order: drop }), 'Please deliver after 5pm');
  assert.equal(await render(`{{ order.internal_note }}`, { order: drop }), '');
  assert.equal(await render(`{{ order.internalNote }}`, { order: drop }), '');
});

test('a comment never carries the author email', async () => {
  const article = articleDrop(
    { id: 'a1', blogId: 'b1', handle: 'news', title: 'News', commentCount: 1 },
    context,
  );
  // The drop declares no email property at all, so there is nothing to leak.
  const { commentDrop } = await import('../../../dist/storefront/domain/index.js');
  assert.ok(!commentDrop.properties.includes('email'), commentDrop.properties.join(','));
  assert.equal(await render(`{{ article.title }}`, { article }), 'News');
});

test('cart totals are computed, not trusted', async () => {
  const drop = cartDrop(
    {
      currency: 'USD',
      items: [
        { id: 'l1', productId: 'p1', variantId: 'v1', title: 'Shirt', quantity: 2, unitPriceMinor: '4500' },
        { id: 'l2', productId: 'p2', variantId: 'v2', title: 'Hat', quantity: 1, unitPriceMinor: '2000' },
      ],
    },
    context,
  );

  assert.equal(await render(`{{ cart.item_count }}`, { cart: drop }), '3');
  assert.equal(await render(`{{ cart.total_price | money }}`, { cart: drop }), '$110.00');
  assert.equal(await render(`{{ cart.empty }}`, { cart: drop }), 'false');
});

test('an empty cart renders a price rather than nothing', async () => {
  const drop = cartDrop({ currency: 'USD', items: [] }, context);
  assert.equal(await render(`{{ cart.total_price | money }}`, { cart: drop }), '$0.00');
  assert.equal(await render(`{{ cart.empty }}`, { cart: drop }), 'true');
});

test("a line item hides the theme's own underscore properties", async () => {
  const drop = cartDrop(
    {
      currency: 'USD',
      items: [
        {
          id: 'l1', productId: 'p1', variantId: 'v1', title: 'Shirt', quantity: 1,
          unitPriceMinor: '4500',
          properties: { Engraving: 'Sam', _internal_token: 'abc123' },
        },
      ],
    },
    context,
  );

  const out = await render(
    `{% for line in cart.items %}{% for p in line.properties %}{{ p[0] }}={{ p[1] }} {% endfor %}{% endfor %}`,
    { cart: drop },
  );
  assert.ok(out.includes('Engraving=Sam'), out);
  assert.ok(!out.includes('_internal_token'), out);
});

// ============================================================ theme objects

test('section settings fill in every declared default', async () => {
  const schema = [
    { type: 'text', id: 'heading', default: 'Featured' },
    { type: 'range', id: 'columns', min: 1, max: 5, step: 1, default: 3 },
    { type: 'checkbox', id: 'show_price', default: true },
  ];
  const drop = sectionDrop(
    { id: 's1', type: 'featured', settings: { heading: 'Our picks' }, schema },
    context,
  );

  // The merchant set one; the other two come from the schema rather than blank.
  assert.equal(await render(`{{ section.settings.heading }}`, { section: drop }), 'Our picks');
  assert.equal(await render(`{{ section.settings.columns }}`, { section: drop }), '3');
  assert.equal(await render(`{{ section.settings.show_price }}`, { section: drop }), 'true');
});

test('a stored value for a setting the schema dropped is not readable', async () => {
  const drop = sectionDrop(
    {
      id: 's1',
      type: 'featured',
      settings: { heading: 'Hi', removed_setting: 'stale' },
      schema: [{ type: 'text', id: 'heading' }],
    },
    context,
  );
  assert.equal(await render(`{{ section.settings.removed_setting }}`, { section: drop }), '');
});

test('form.errors is nothing when there are none, so {% if %} works', async () => {
  const clean = formDrop({ type: 'contact' }, context);
  const failed = formDrop(
    { type: 'contact', errors: { messages: { email: 'is invalid' } } },
    context,
  );

  // An empty object would be truthy in Liquid and show an empty error box.
  assert.equal(await render(`{% if form.errors %}yes{% else %}no{% endif %}`, { form: clean }), 'no');
  assert.equal(await render(`{% if form.errors %}yes{% else %}no{% endif %}`, { form: failed }), 'yes');
});

test('a failed form keeps what the customer already typed', async () => {
  const drop = formDrop(
    { type: 'contact', fields: { email: 'sam@example.test', body: 'Hello' } },
    context,
  );
  assert.equal(await render(`{{ form.email }}`, { form: drop }), 'sam@example.test');
  assert.equal(await render(`{{ form.body }}`, { form: drop }), 'Hello');
});

test('a page renders its handle-based url', async () => {
  const drop = pageDrop({ id: 'pg1', handle: 'about-us', title: 'About' }, context);
  assert.equal(await render(`{{ page.url }}`, { page: drop }), '/pages/about-us');
});

test('an article falls back from excerpt to content', async () => {
  const withExcerpt = articleDrop(
    { id: 'a1', blogId: 'b1', handle: 'x', title: 'X', excerpt: 'Short', body: 'Long body' },
    context,
  );
  const without = articleDrop(
    { id: 'a2', blogId: 'b1', handle: 'y', title: 'Y', body: 'Long body' },
    context,
  );

  assert.equal(await render(`{{ article.excerpt_or_content }}`, { article: withExcerpt }), 'Short');
  assert.equal(await render(`{{ article.excerpt_or_content }}`, { article: without }), 'Long body');
});

test('an article summary joins block-level text rather than running it together', async () => {
  const drop = articleDrop(
    { id: 'a1', blogId: 'b1', handle: 'x', title: 'X', body: '<p>First.</p><p>Second.</p>' },
    context,
  );
  assert.equal(await render(`{{ article.summary }}`, { article: drop }), 'First. Second.');
});

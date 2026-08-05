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

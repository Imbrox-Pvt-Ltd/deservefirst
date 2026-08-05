/**
 * Storefront · tests/theme-settings.test.mjs
 * A merchant's choices about how their theme looks.
 *
 * `StorefrontData.settings()` returned `{}` with a comment saying the theme
 * source reads them, and nothing did — so every `{{ settings.x }}` was empty
 * and the reference theme's 521 settings reads all came back as nothing. Less
 * visible than the missing translations, and worse for it: a missing
 * translation announces itself on the page, while a missing setting renders a
 * slightly different design nobody can prove is wrong.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fontFromHandle,
  resolveFontSettings,
  resolveThemeSettings,
} from '../../../dist/storefront/domain/index.js';

// ------------------------------------------------------------- the file

test('the live settings come from `current`', () => {
  const settings = resolveThemeSettings({
    current: { color_scheme: 'scheme-1', menu_bg_color: '#fcfbf9' },
    presets: { Other: { color_scheme: 'scheme-9' } },
  });

  assert.equal(settings.color_scheme, 'scheme-1');
  assert.equal(settings.menu_bg_color, '#fcfbf9');
});

test('`current` naming a preset resolves to that preset', () => {
  /**
   * How a theme ships before anyone opens the editor. Reading only the object
   * form would give a freshly installed store no settings at all — which is
   * exactly when they matter most.
   */
  const settings = resolveThemeSettings({
    current: 'Broadcast',
    presets: { Broadcast: { color_scheme: 'scheme-1' }, Relay: { color_scheme: 'scheme-2' } },
  });

  assert.equal(settings.color_scheme, 'scheme-1');
});

test('a broken settings file costs colours, not the storefront', () => {
  // The theme's own defaults are still a page.
  for (const raw of [null, undefined, 'nonsense', 42, [], {}, { current: 'Missing', presets: {} }]) {
    assert.deepEqual(resolveThemeSettings(raw), {}, JSON.stringify(raw));
  }
});

// ------------------------------------------------------------- the fonts

test('a font handle becomes the object a theme reads', () => {
  /**
   * A theme uses a font setting as an OBJECT — `.family`, `.system?`,
   * `| font_modify`. Nothing turned the stored string into one, so every
   * property read as nothing and the page rendered `font-family: , ;`, which
   * browsers discard entirely.
   */
  assert.deepEqual(fontFromHandle('dm_sans_n4'), {
    family: 'DM Sans',
    weight: 400,
    style: 'normal',
    fallback_families: 'sans-serif',
    system: false,
  });
});

test('the trailing group carries the style and the weight', () => {
  assert.equal(fontFromHandle('bricolage_grotesque_n7').weight, 700);
  assert.equal(fontFromHandle('playfair_display_i5').style, 'italic');
  assert.equal(fontFromHandle('playfair_display_i5').weight, 500);
});

test('short consonant-only words are acronyms, not words', () => {
  // `Dm Sans` in a heading is the kind of detail that makes a platform look
  // careless.
  assert.equal(fontFromHandle('dm_sans_n4').family, 'DM Sans');
  assert.equal(fontFromHandle('pt_serif_n4').family, 'PT Serif');
  assert.equal(fontFromHandle('karla_n4').family, 'Karla');
});

test('the fallback matches the family’s character', () => {
  /**
   * `sans-serif` for everything would put a serif heading into Arial, which
   * reads as broken typography rather than as plain typography.
   */
  assert.equal(fontFromHandle('playfair_display_n4').fallback_families, 'serif');
  assert.equal(fontFromHandle('dm_sans_n4').fallback_families, 'sans-serif');
  assert.equal(fontFromHandle('roboto_mono_n4').fallback_families, 'monospace');
});

test('a family every device has is marked as a system font', () => {
  // Themes branch on `system?` to skip an @font-face for it.
  assert.equal(fontFromHandle('helvetica_n4').system, true);
  assert.equal(fontFromHandle('dm_sans_n4').system, false);
});

test('anything that is not a handle is left alone', () => {
  /**
   * Without the trailing `_n4` there is nothing to distinguish `dm_sans` the
   * handle from "DM Sans" the family a merchant typed, and guessing would
   * rewrite one of them wrongly.
   */
  for (const value of ['Open Sans', 'dm_sans', '', null, undefined, 42, {}]) {
    assert.equal(fontFromHandle(value), null, JSON.stringify(value));
  }
});

test('only font-named settings are converted', () => {
  /**
   * By key name rather than by sniffing values: a colour or a product code that
   * happens to end in `_n4` is not a typeface.
   */
  const resolved = resolveFontSettings({
    type_base_font: 'dm_sans_n4',
    sku_default: 'widget_n4',
    menu_bg_color: '#fcfbf9',
  });

  assert.equal(resolved.type_base_font.family, 'DM Sans');
  assert.equal(resolved.sku_default, 'widget_n4', 'left exactly as it was');
  assert.equal(resolved.menu_bg_color, '#fcfbf9');
});

test('a font setting holding a plain name survives conversion', () => {
  // The checkout settings do this, and mangling them into a font with a weight
  // nobody asked for would be worse than leaving them.
  const resolved = resolveFontSettings({ checkout_body_font: 'Open Sans' });
  assert.equal(resolved.checkout_body_font, 'Open Sans');
});

// ------------------------------------------------ a product's default variant

import { createDropContext, productDrop } from '../../../dist/storefront/domain/index.js';
import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

const noRelations = {
  variantsOfProduct: () => [], imagesOfProduct: () => [], productsOfCollection: () => [],
  productCountOfCollection: () => 0, image: () => null,
};
const drops = () =>
  createDropContext({ currency: 'USD', locale: 'en', baseUrl: 'https://x.test', load: noRelations });

const shirt = {
  id: 'p1', title: 'Linen Shirt', handle: 'linen-shirt',
  priceAmountMinor: '4500', inventoryQuantity: 7, status: 'active',
};

test('a product with no variant rows still has one', async () => {
  /**
   * Every product in the reference product HAS a variant, and themes are
   * written knowing it. The reference theme prints its price through
   * `product.selected_or_first_available_variant.price`, so a product without
   * variant rows rendered a page with NO PRICE — not an error, not a zero, just
   * nothing where the price belongs.
   */
  const product = productDrop(shirt, drops());
  const variant = await product.selected_or_first_available_variant;

  assert.ok(variant, 'there is always a variant');
  assert.equal(await variant.price, 4500);
  assert.equal(await variant.available, true);
  assert.equal(await variant.title, 'Default Title', 'themes compare against exactly this');
  assert.equal((await product.variants).length, 1);
});

test('the default variant is the product, so a form posts the right id', async () => {
  const product = productDrop(shirt, drops());
  const variant = await product.selected_or_first_available_variant;
  assert.equal(await variant.id, 'p1');
});

test('real variant rows are used instead of a synthetic one', async () => {
  const withRows = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      ...noRelations,
      variantsOfProduct: () => [
        { id: 'v1', productId: 'p1', title: 'Small', priceAmountMinor: '4500', inventoryQuantity: 0 },
        { id: 'v2', productId: 'p1', title: 'Large', priceAmountMinor: '5500', inventoryQuantity: 3 },
      ],
    },
  });

  const product = productDrop(shirt, withRows);
  assert.equal((await product.variants).length, 2);
  // The first AVAILABLE one, not simply the first.
  assert.equal(await (await product.selected_or_first_available_variant).title, 'Large');
});

// ------------------------------------------------ structured data prices

test('structured data carries the decimal price, not the minor units', async () => {
  /**
   * `product.price` is 4500 for a $45 shirt, which is correct for a theme —
   * it pipes it through `money`. Emitted raw into JSON-LD it told search
   * engines the shirt cost $4,500, and the markup was valid so nothing
   * complained. A rich result showing the wrong price is worse than none.
   */
  const engine = createThemeEngine(defaultContext({ currency: 'USD' }));
  const out = await engine.render(`{{ p | structured_data }}`, {
    p: { title: 'Linen Shirt', price: 4500, available: true, vendor: 'Atelier' },
  });

  const data = JSON.parse(out.replace(/\\u003c/g, '<'));
  assert.equal(data.offers.price, '45.00');
  assert.equal(data.offers.priceCurrency, 'USD');
  assert.equal(data.offers.availability, 'https://schema.org/InStock');
});

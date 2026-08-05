/**
 * Storefront · tests/filters.test.mjs
 * The filter library, tested through the engine rather than beside it.
 *
 * Every case here goes through `createThemeEngine` and real Liquid source, so
 * it exercises the argument splitting as well as the filter. That matters more
 * than it sounds: liquidjs hands keyword arguments to a filter as `[name,
 * value]` arrays mixed into the positional list, and a unit test calling
 * `apply()` directly would pass while every real template failed.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

const engine = createThemeEngine(
  defaultContext({
    translations: {
      'general.greeting': 'Hello, {{ name }}',
      'cart.count.one': '{{ count }} item',
      'cart.count.other': '{{ count }} items',
    },
    readAsset: (path) => (path === 'critical.css' ? 'body{margin:0}' : null),
  }),
);

/** Renders a template and trims, which every assertion below wants. */
const render = async (source, scope = {}) => (await engine.render(source, scope)).trim();

// ---------------------------------------------------------------- money

test('money renders minor units through the store format', async () => {
  assert.equal(await render(`{{ 2999 | money }}`), '$29.99');
  assert.equal(await render(`{{ 100000 | money }}`), '$1,000.00');
  assert.equal(await render(`{{ 0 | money }}`), '$0.00');
});

test('money handles negatives without losing the sign', async () => {
  assert.equal(await render(`{{ -2999 | money }}`), '$-29.99');
});

test('money_with_currency appends the code', async () => {
  assert.equal(await render(`{{ 2999 | money_with_currency }}`), '$29.99 USD');
});

test('money_without_currency is the bare grouped number', async () => {
  assert.equal(await render(`{{ 123456 | money_without_currency }}`), '1,234.56');
});

test('money_without_trailing_zeros drops .00 only when whole', async () => {
  assert.equal(await render(`{{ 1000 | money_without_trailing_zeros }}`), '$10');
  assert.equal(await render(`{{ 1050 | money_without_trailing_zeros }}`), '$10.50');
});

test('a zero-decimal currency has no decimal part at all', async () => {
  const yen = createThemeEngine(
    defaultContext({
      currency: 'JPY',
      moneyFormats: { money: '¥{{amount}}', moneyWithCurrency: '¥{{amount}} JPY' },
    }),
  );
  // 1000 minor units of JPY is 1000 yen, not 10.
  assert.equal((await yen.render(`{{ 1000 | money }}`, {})).trim(), '¥1,000');
});

test('a European format string swaps both separators', async () => {
  const euro = createThemeEngine(
    defaultContext({
      currency: 'EUR',
      moneyFormats: {
        money: '{{amount_with_comma_separator}} €',
        moneyWithCurrency: '{{amount_with_comma_separator}} € EUR',
      },
    }),
  );
  assert.equal((await euro.render(`{{ 113465 | money }}`, {})).trim(), '1.134,65 €');
});

test('money on something that is not a number renders nothing', async () => {
  assert.equal(await render(`{{ 'abc' | money }}`), '');
  assert.equal(await render(`{{ nothing | money }}`), '');
});

test('no-decimals rounding is half-up on integers', async () => {
  const shop = createThemeEngine(
    defaultContext({
      moneyFormats: { money: '${{amount_no_decimals}}', moneyWithCurrency: '${{amount_no_decimals}}' },
    }),
  );
  assert.equal((await shop.render(`{{ 1050 | money }}`, {})).trim(), '$11');
  assert.equal((await shop.render(`{{ 1049 | money }}`, {})).trim(), '$10');
});

// --------------------------------------------------------------- string

test('handle produces a URL segment', async () => {
  assert.equal(await render(`{{ '  Hello, World!  ' | handle }}`), 'hello-world');
  assert.equal(await render(`{{ 'Café Crème' | handleize }}`), 'cafe-creme');
  assert.equal(await render(`{{ 'A -- B' | handle }}`), 'a-b');
});

test('pluralize picks by count', async () => {
  assert.equal(await render(`{{ 1 | pluralize: 'item', 'items' }}`), 'item');
  assert.equal(await render(`{{ 3 | pluralize: 'item', 'items' }}`), 'items');
});

test('format_code groups a gift-card code in fours', async () => {
  assert.equal(await render(`{{ 'ABCDEFGHIJKLMNOP' | format_code }}`), 'ABCD EFGH IJKL MNOP');
});

// ---------------------------------------------------------------- color

test('color_darken and color_lighten move lightness', async () => {
  /**
   * `#808080` is lightness 128/255 = 0.502, not 0.5 — so ±10 points lands on
   * 154 and 103 rather than the round numbers an eyeball expects. Pinned to the
   * real values: the arithmetic is right and the intuition is off by a rounding
   * step, which is worth recording where the next person will look.
   */
  assert.equal(await render(`{{ '#808080' | color_lighten: 10 }}`), '#9a9a9a');
  assert.equal(await render(`{{ '#808080' | color_darken: 10 }}`), '#676767');
});

test('lighten and darken are inverses within a rounding step', async () => {
  const out = await render(`{{ '#3a7bd5' | color_lighten: 12 | color_darken: 12 }}`);
  const channels = [1, 3, 5].map((at) => Number.parseInt(out.slice(at, at + 2), 16));
  const original = [0x3a, 0x7b, 0xd5];
  channels.forEach((value, index) => {
    assert.ok(
      Math.abs(value - original[index]) <= 2,
      `channel ${index}: ${value} vs ${original[index]} in ${out}`,
    );
  });
});

test('color_modify sets one component', async () => {
  assert.equal(await render(`{{ '#000000' | color_modify: 'red', 255 }}`), '#ff0000');
  assert.equal(await render(`{{ '#ff0000' | color_modify: 'alpha', 0.5 }}`), 'rgba(255, 0, 0, 0.5)');
});

test('color_extract reads a component', async () => {
  assert.equal(await render(`{{ '#ff8000' | color_extract: 'red' }}`), '255');
  assert.equal(await render(`{{ '#ff8000' | color_extract: 'green' }}`), '128');
});

test('color_mix weights toward the first colour', async () => {
  // 50/50 of black and white is the midpoint.
  assert.equal(await render(`{{ '#000000' | color_mix: '#ffffff', 50 }}`), '#808080');
  // 0% of the first means all of the second.
  assert.equal(await render(`{{ '#000000' | color_mix: '#ffffff', 0 }}`), '#ffffff');
});

test('color_contrast gives the WCAG ratio', async () => {
  // Black on white is the maximum, 21:1.
  assert.equal(await render(`{{ '#000000' | color_contrast: '#ffffff' }}`), '21');
});

test('color_brightness distinguishes red from green', async () => {
  const red = Number(await render(`{{ '#ff0000' | color_brightness }}`));
  const green = Number(await render(`{{ '#00ff00' | color_brightness }}`));
  // Green is perceptually much brighter at the same channel value; an
  // unweighted average would make these equal.
  assert.ok(green > red, `expected green (${green}) brighter than red (${red})`);
});

test('an unparseable colour renders nothing rather than black', async () => {
  assert.equal(await render(`{{ 'dark blue' | color_darken: 10 }}`), '');
  assert.equal(await render(`{{ '' | color_to_rgb }}`), '');
});

test('rgba survives a round trip', async () => {
  assert.equal(await render(`{{ 'rgba(255, 0, 0, 0.5)' | color_to_rgb }}`), 'rgba(255, 0, 0, 0.5)');
});

// ------------------------------------------------------------------ url

test('asset_url points at the theme, file_url at store files', async () => {
  assert.equal(await render(`{{ 'theme.css' | asset_url }}`), 'https://cdn.deservefirst.test/assets/theme.css');
  assert.equal(await render(`{{ 'logo.png' | file_url }}`), 'https://cdn.deservefirst.test/files/logo.png');
});

test('image_url encodes the transformation as query parameters', async () => {
  assert.equal(
    await render(`{{ 'a.jpg' | image_url: width: 200 }}`),
    'https://cdn.deservefirst.test/files/a.jpg?width=200',
  );
  assert.equal(
    await render(`{{ 'a.jpg' | image_url: width: 200, crop: 'center' }}`),
    'https://cdn.deservefirst.test/files/a.jpg?width=200&crop=center',
  );
});

test('image_url refuses a parameter it does not know', async () => {
  // `quality` is not on the allow-list, so it does not reach the image service.
  const out = await render(`{{ 'a.jpg' | image_url: width: 200, quality: 5 }}`);
  assert.ok(!out.includes('quality'), out);
});

test('image_url drops a nonsensical dimension instead of passing it on', async () => {
  assert.equal(await render(`{{ 'a.jpg' | image_url: width: 0 }}`), 'https://cdn.deservefirst.test/files/a.jpg');
});

test('img_url understands the legacy size string', async () => {
  assert.equal(
    await render(`{{ 'a.jpg' | img_url: '300x300' }}`),
    'https://cdn.deservefirst.test/files/a.jpg?width=300&height=300',
  );
  assert.equal(
    await render(`{{ 'a.jpg' | img_url: '1085x' }}`),
    'https://cdn.deservefirst.test/files/a.jpg?width=1085',
  );
});

test('link_to builds an anchor and escapes the label', async () => {
  assert.equal(
    await render(`{{ 'Next' | link_to: '/products/x' }}`),
    '<a href="/products/x">Next</a>',
  );
});

test('link_to refuses a javascript: URL', async () => {
  const out = await render(`{{ 'Click' | link_to: 'javascript:alert(1)' }}`);
  assert.ok(!out.includes('javascript'), out);
  assert.equal(out, '<a href="">Click</a>');
});

test('within scopes a product URL to a collection', async () => {
  assert.equal(
    await render(`{{ '/products/hat' | within: collection }}`, { collection: { handle: 'sale' } }),
    '/collections/sale/products/hat',
  );
});

test('external_video_url only accepts hosts we support', async () => {
  assert.equal(
    await render(`{{ media | external_video_url }}`, { media: { host: 'youtube', external_id: 'abc' } }),
    'https://www.youtube.com/embed/abc',
  );
  assert.equal(
    await render(`{{ media | external_video_url }}`, { media: { host: 'evil', external_id: 'abc' } }),
    '',
  );
});

// ----------------------------------------------------------------- html

test('image_tag builds an img with a srcset', async () => {
  const out = await render(
    `{{ 'https://cdn.deservefirst.test/files/a.jpg' | image_tag: widths: '100, 200' }}`,
  );
  assert.match(out, /^<img /);
  assert.ok(out.includes('100w'), out);
  assert.ok(out.includes('200w'), out);
});

test('image_tag always emits an alt attribute', async () => {
  const out = await render(`{{ 'https://x.test/a.jpg' | image_tag }}`);
  assert.ok(out.includes('alt='), out);
});

test('image_tag will not emit an event handler a theme asked for', async () => {
  const out = await render(`{{ 'https://x.test/a.jpg' | image_tag: onload: 'steal()' }}`);
  assert.ok(!out.includes('onload'), out);
});

test('image_tag passes data- attributes through', async () => {
  const out = await render(`{{ 'https://x.test/a.jpg' | image_tag: data-id: '7' }}`);
  assert.ok(out.includes('data-id="7"'), out);
});

test('image_tag escapes a value going into an attribute', async () => {
  const out = await render(`{{ 'https://x.test/a.jpg' | image_tag: alt: alt }}`, {
    alt: '"><script>x</script>',
  });
  assert.ok(!out.includes('<script>'), out);
  assert.ok(out.includes('&quot;'), out);
});

test('image_tag does not upscale past the source width', async () => {
  const out = await render(
    `{{ 'https://x.test/a.jpg' | image_tag: width: 150, widths: '100, 200, 300' }}`,
  );
  assert.ok(out.includes('100w'), out);
  assert.ok(!out.includes('300w'), out);
});

test('stylesheet_tag puts the preload before the stylesheet', async () => {
  const out = await render(`{{ 'theme.css' | asset_url | stylesheet_tag: preload: true }}`);
  assert.ok(out.indexOf('rel="preload"') < out.indexOf('rel="stylesheet"'), out);
});

test('placeholder_svg_tag renders inline svg', async () => {
  const out = await render(`{{ 'logo' | placeholder_svg_tag: 'svg-placeholder' }}`);
  assert.match(out, /^<svg /);
  assert.ok(out.includes('svg-placeholder'), out);
});

test('inline_asset_content reads through the context loader only', async () => {
  assert.equal(await render(`{{ 'critical.css' | inline_asset_content }}`), 'body{margin:0}');
  assert.equal(await render(`{{ '../../../etc/passwd' | inline_asset_content }}`), '');
});

test('media_tag dispatches on the media type', async () => {
  const out = await render(`{{ media | media_tag }}`, {
    media: { media_type: 'external_video', host: 'youtube', external_id: 'abc' },
  });
  assert.match(out, /^<iframe /);
});

// --------------------------------------------------------- localization

test('t looks up a translation and interpolates', async () => {
  assert.equal(await render(`{{ 'general.greeting' | t: name: 'Sam' }}`), 'Hello, Sam');
});

test('t selects a plural form by count', async () => {
  assert.equal(await render(`{{ 'cart.count' | t: count: 1 }}`), '1 item');
  assert.equal(await render(`{{ 'cart.count' | t: count: 4 }}`), '4 items');
});

test('a missing translation says so on the page', async () => {
  assert.equal(await render(`{{ 'nope.missing' | t }}`), 'translation missing: en.nope.missing');
});

test('format_address orders lines by country', async () => {
  const address = {
    first_name: 'A',
    last_name: 'B',
    address1: '1 Road',
    city: 'Tokyo',
    province: 'Kanto',
    zip: '100-0001',
    country_code: 'JP',
    country: 'Japan',
  };
  const out = await render(`{{ address | format_address }}`, { address });
  // Japan leads with the postcode; the default order would lead with the name.
  assert.ok(out.indexOf('100-0001') < out.indexOf('1 Road'), out);
});

// ------------------------------------------------------------- commerce

test('item_count_for_variant totals matching lines', async () => {
  const cart = {
    items: [
      { variant_id: '1', quantity: 2 },
      { variant_id: '2', quantity: 5 },
      { variant_id: '1', quantity: 3 },
    ],
  };
  assert.equal(await render(`{{ cart | item_count_for_variant: '1' }}`, { cart }), '5');
  assert.equal(await render(`{{ cart | item_count_for_variant: '9' }}`, { cart }), '0');
});

test('weight_with_unit converts from grams', async () => {
  assert.equal(await render(`{{ 1500 | weight_with_unit: 'kg' }}`), '1.5 kg');
  assert.equal(await render(`{{ 1000 | weight_with_unit: 'kg' }}`), '1 kg');
});

test('structured_data cannot close the script tag it sits in', async () => {
  const out = await render(`{{ product | structured_data }}`, {
    product: { title: 'X', description: '</script><script>evil()</script>', price: 100 },
  });
  assert.ok(!out.includes('</script>'), out);
  // Still valid JSON, so a consumer parses it unchanged.
  assert.equal(JSON.parse(out)['@type'], 'Product');
});

test('the checkout filters render nothing rather than not existing', async () => {
  // strictFilters is on, so an absent filter would throw here instead.
  assert.equal(await render(`{{ form | payment_button }}`, { form: {} }), '');
  assert.equal(await render(`{{ form | payment_terms }}`, { form: {} }), '');
});

// -------------------------------------------------------------- engine

test('an unknown filter is an error, not a silent pass-through', async () => {
  await assert.rejects(
    () => engine.render(`{{ 2999 | not_a_real_filter }}`, {}),
    /undefined filter/,
    'strictFilters must be on — a silent pass-through renders 2999 where a price belongs',
  );
});

test('a missing variable is not an error', async () => {
  // The asymmetry with filters is deliberate: themes test for unset settings.
  assert.equal(await render(`{% if settings.nope %}yes{% else %}no{% endif %}`), 'no');
});

test('output is not escaped, matching the reference product', async () => {
  assert.equal(await render(`{{ v }}`, { v: '<b>x</b>' }), '<b>x</b>');
  assert.equal(await render(`{{ v | escape }}`, { v: '<b>x</b>' }), '&lt;b&gt;x&lt;/b&gt;');
});

test('a real two-element array is a positional argument, not a keyword', async () => {
  /**
   * The ambiguity this pins: liquidjs passes `width: 200` to a filter as the
   * array `['width', 200]`, which is exactly what a theme passing a real
   * two-element array looks like. The engine reads the parsed token to tell
   * them apart. Without that, this renders as though a width had been set.
   */
  const out = await render(`{{ 'a.jpg' | image_url: pair }}`, { pair: ['width', 200] });
  assert.equal(out, 'https://cdn.deservefirst.test/files/a.jpg');
});

test('positional and keyword arguments can be mixed in one call', async () => {
  const out = await render(`{{ 'a.jpg' | img_url: '300x', crop: 'top' }}`);
  assert.ok(out.includes('width=300'), out);
  assert.ok(out.includes('crop=top'), out);
});

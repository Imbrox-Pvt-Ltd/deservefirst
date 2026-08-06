/**
 * Storefront · tests/form-confirmation.test.mjs
 * Telling a customer their form went.
 *
 * Two defects met here, and together they meant NO storefront form has ever
 * confirmed itself. A customer sent an enquiry, was redirected, and saw the
 * blank form again with nothing to say it had arrived — so they sent it again.
 *
 *   1. The `form` object was only ever put in scope on a FAILED submission.
 *      A success redirects and renders as a plain GET, where nothing built one.
 *   2. `form.posted_successfully?` did not resolve. The question mark is part
 *      of the name a theme uses, not an operator, and the lookup missed — so
 *      even on the error path the branch was silently false.
 *
 * The second is the one worth remembering: a missing property and `false` are
 * indistinguishable in a Liquid `{% if %}`, so this failed as a quiet "no"
 * rather than as an error anybody could see.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';
import {
  createDropContext,
  formDrop,
  formStateFor,
  productDrop,
} from '../../../dist/storefront/domain/index.js';

const theme = new InMemoryThemeSource({
  'layout/theme.liquid': '<html><body>{{ content_for_layout }}</body></html>',
  'templates/index.json': JSON.stringify({ sections: { a: { type: 'a' } }, order: ['a'] }),
  'sections/a.liquid':
    '{% form "contact" %}{% if form.posted_successfully? %}SENT:{{ form.type }}{% else %}BLANK{% endif %}{% endform %}',
});

function handler() {
  return new StorefrontHandler({
    resolve: async () => ({
      storeId: 's1',
      data: {
        shop: async () => ({
          id: 's1', handle: 'demo', name: 'Demo', domain: 'demo.example',
          currency: 'USD', enabledLocales: ['en'],
        }),
        settings: async () => ({}),
        redirects: async () => [],
      },
      theme,
      themeVersion: 'v1',
    }),
  });
}

const get = (query) =>
  handler().handle({ host: 'demo.example', path: '/', query, method: 'GET' });

// ------------------------------------------------ the question mark itself

test('a property answers under a trailing question mark', async () => {
  /**
   * Themes write `form.posted_successfully?` and `product.available?`. Without
   * this the lookup misses and the branch is a silent false — which is the
   * hardest kind of wrong to notice, because a missing property and `false`
   * render identically.
   */
  const drops = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: { variantsOfProduct: () => [], imagesOfProduct: () => [] },
  });

  const form = formDrop(formStateFor('contact', {}, []), drops);
  assert.equal(await form['posted_successfully?'], true);
  assert.equal(await form.posted_successfully, true, 'and still under its plain name');

  const product = productDrop(
    { id: 'p', handle: 'tee', title: 'Tee', priceAmountMinor: '100', inventoryQuantity: 4 },
    drops,
  );
  assert.equal(await product['available?'], true);
});

test('the question-mark spelling is not a second property', async () => {
  /**
   * `x` and `x?` are one property with two spellings. Listing both would
   * double every object in the generated reference and in the audit for no
   * gain to anybody reading either.
   */
  const drops = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test', load: {},
  });
  const form = formDrop(formStateFor('contact', {}, []), drops);
  assert.ok(!Object.keys(form).some((key) => key.endsWith('?')));
});

// ------------------------------------------------ the confirmation itself

test('a form confirms itself after a successful post', async () => {
  const response = await get('posted=sent');
  assert.match(String(response.body), /SENT:contact/);
});

test('a page nobody posted from shows the blank form', async () => {
  const response = await get('');
  assert.match(String(response.body), /BLANK/);
});

test('an empty outcome is not a confirmation', async () => {
  /**
   * `?posted=` with nothing after it is a hand-edited URL, not a submission.
   */
  const response = await get('posted=');
  assert.match(String(response.body), /BLANK/);
});

test('the outcome names which form is confirming', async () => {
  /**
   * The parameter says what HAPPENED; a theme's `{% form %}` block asks what it
   * IS, and renders a different message for a comment than for an enquiry.
   */
  for (const [outcome, type] of [
    ['sent', 'contact'],
    ['requested', 'product'],
    ['commented', 'new_comment'],
    ['subscribed', 'customer'],
  ]) {
    const response = await get(`posted=${outcome}`);
    assert.match(String(response.body), new RegExp(`SENT:${type}`), outcome);
  }
});

test('an outcome nobody recognises still confirms', async () => {
  /**
   * A wrong form type is better than no confirmation: the customer needs to
   * know it went, and `posted_successfully?` is the part they see.
   */
  const response = await get('posted=something-new');
  assert.match(String(response.body), /SENT:something-new/);
});

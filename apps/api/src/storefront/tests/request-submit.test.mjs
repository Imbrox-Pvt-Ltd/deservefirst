/**
 * Storefront · tests/request-submit.test.mjs
 * Sending the list a shopper has been building.
 *
 * The end of the Phase 1 flow (§25): no checkout and no payment, a merchant
 * receives the request and answers it. Until this existed a shopper could
 * assemble a list and then do nothing with it — a shop that cannot be asked for
 * anything.
 *
 * The submission is the moment a stranger causes a merchant to be notified, so
 * every refusal below is about what must NOT reach that queue: a request with
 * no way to reply to it, an empty one, or an unlimited number of them.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StorefrontHandler } from '../../../dist/storefront/api/index.js';

const THEME = {
  'layout/theme.liquid': '<html><body>{{ content_for_layout }}</body></html>',
  'templates/index.liquid': 'home',
  'templates/cart.liquid': 'cart',
  'templates/404.liquid': 'missing',
};

/** A store whose draft always holds one line, unless told otherwise. */
function handlerFor({ draft = { id: 'req_1', version: 3, lineCount: 1 }, limit } = {}) {
  const sent = [];

  const data = {
    shop: async () => ({
      id: 's1', handle: 'demo', name: 'Demo', domain: 'demo.example',
      currency: 'USD', enabledLocales: ['en'],
    }),
    settings: async () => ({}),
    draftRequestRef: async () => draft,
    draftRequest: async () => ({ items: [], currency: 'USD' }),
    redirects: async () => [],
  };

  const handler = new StorefrontHandler(
    {
      resolve: async () => ({
        storeId: 's1',
        data,
        theme: { read: async (path) => THEME[path] ?? null, list: async () => Object.keys(THEME) },
        themeVersion: 'v1',
        submissions: {
          submitRequest: async (input) => {
            sent.push(input);
            return { reference: 'R-ABC123' };
          },
        },
      }),
    },
    { submissionLimit: limit },
  );

  return { handler, sent };
}

const submit = (handler, form, extra = {}) =>
  handler.handle({
    host: 'demo.example',
    path: '/cart/submit',
    query: '',
    method: 'POST',
    origin: 'https://demo.example',
    form,
    cookies: 'df_request=' + 'a'.repeat(32),
    ...extra,
  });

test('a request with no way to reply to it is refused', async () => {
  /**
   * An address is the whole point. Without one the merchant receives a row
   * that will sit in a queue until somebody deletes it.
   */
  const { handler, sent } = handlerFor();

  for (const email of ['', '   ', 'ada', 'ada@', '@example.com', 'ada @example.com']) {
    const response = await submit(handler, { email, name: 'Ada' });
    assert.equal(response.status, 422, `"${email}" must not be accepted`);
  }
  assert.equal(sent.length, 0, 'nothing reached the merchant');
});

test('an empty list is not something to send a merchant', async () => {
  const { handler, sent } = handlerFor({ draft: { id: 'req_1', version: 3, lineCount: 0 } });
  const response = await submit(handler, { email: 'ada@example.com' });
  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);
});

test('a visitor with no draft at all cannot submit one', async () => {
  const { handler, sent } = handlerFor({ draft: null });
  const response = await submit(handler, { email: 'ada@example.com' });
  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);
});

test('a good submission carries the contact details and the version it read', async () => {
  /**
   * The version travels with it so a line added between reading the draft and
   * writing it is a refusal rather than a silent overwrite — a request sent
   * without the last thing a shopper added is the kind of error nobody
   * discovers until the goods arrive.
   */
  const { handler, sent } = handlerFor();
  const response = await submit(handler, {
    email: '  ada@example.com  ',
    name: '  Ada Lovelace ',
    body: 'Please quote for Leeds',
  });

  assert.equal(response.status, 303);
  /**
   * The platform's own convention — `?posted=<outcome>&ref=<reference>` — which
   * is what puts the form object back in scope so a theme confirms the send.
   */
  assert.equal(response.headers.location, '/cart?posted=requested&ref=R-ABC123');
  assert.deepEqual(sent, [
    {
      requestId: 'req_1',
      version: 3,
      contactEmail: 'ada@example.com',
      contactName: 'Ada Lovelace',
      message: 'Please quote for Leeds',
    },
  ]);
});

test('a blank name or message is absent rather than empty', async () => {
  const { handler, sent } = handlerFor();
  await submit(handler, { email: 'ada@example.com', name: '   ', body: '' });
  assert.equal(sent[0].contactName, null);
  assert.equal(sent[0].message, null);
});

test('the cookie is cleared, so the next thing added starts a new draft', async () => {
  const { handler } = handlerFor();
  const response = await submit(handler, { email: 'ada@example.com' });
  assert.match(response.headers['set-cookie'], /Max-Age=0/);
});

test('the response is never cached', async () => {
  /**
   * It names one shopper's reference and carries a cookie instruction. A
   * shared copy would hand the next visitor both.
   */
  const { handler } = handlerFor();
  const response = await submit(handler, { email: 'ada@example.com' });
  assert.equal(response.cacheKey, null);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('the rate limit is spent only once the request is worth sending', async () => {
  /**
   * Checked after the address and the contents. A shopper who mistypes their
   * email should not also lose the budget they need for the retry.
   */
  const asked = [];
  const { handler } = handlerFor({
    limit: async (key) => {
      asked.push(key);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });

  await submit(handler, { email: 'nope' });
  assert.equal(asked.length, 0, 'a bad address costs nothing');

  await submit(handler, { email: 'ada@example.com' });
  assert.equal(asked.length, 1, 'a real one is counted');
});

test('too many submissions are refused rather than queued', async () => {
  const { handler, sent } = handlerFor({
    limit: async () => ({ allowed: false, retryAfterSeconds: 30 }),
  });
  const response = await submit(handler, { email: 'ada@example.com' });

  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '30');
  assert.equal(sent.length, 0, 'this is the one place a stranger notifies a merchant');
});

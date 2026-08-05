/**
 * Storefront · tests/submissions.test.mjs
 * The one place an anonymous stranger writes data.
 *
 * Everything else on the platform is a merchant with a session or an app with a
 * token. Here it is whoever followed a link, which changes which defences
 * matter: forging a request on behalf of an anonymous visitor achieves what
 * that visitor could do themselves, so the real risks are spam and abuse rather
 * than CSRF.
 *
 * The tests that earn their place are the refusals, and the one asserting a
 * success REDIRECTS — a success that re-rendered would resubmit on refresh, and
 * a merchant would find the same enquiry four times.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StorefrontHandler } from '../../../dist/storefront/api/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';
import {
  admitSubmission,
  formStateFor,
  HONEYPOT_FIELD,
  needsSessionToken,
  validateSubmission,
} from '../../../dist/storefront/domain/index.js';

// -------------------------------------------------------- admitting a POST

const base = {
  formType: 'contact',
  fields: { email: 'a@b.test', body: 'Hello' },
  origin: 'https://shop.test',
  host: 'shop.test',
  hasSession: false,
  tokenValid: false,
};

test('an ordinary submission is admitted', () => {
  const result = admitSubmission(base);
  assert.equal(result.ok, true);
  assert.equal(result.formType, 'contact');
});

test('a form type the platform does not accept is refused', () => {
  const result = admitSubmission({ ...base, formType: 'invented_by_a_theme' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_form');
});

test('a cross-site POST is refused by its Origin', () => {
  /**
   * The real CSRF control for a public form. A browser sends Origin on every
   * cross-site POST and cannot be made to lie about it, so a mismatch is
   * another site submitting through a customer's browser.
   */
  const result = admitSubmission({ ...base, origin: 'https://evil.test' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cross_origin');
});

test('a missing Origin is allowed', () => {
  /**
   * Some privacy tools strip it. Refusing those would break the form for real
   * people to prevent an attack that gains the attacker nothing on a public
   * form — the wrong trade.
   */
  assert.equal(admitSubmission({ ...base, origin: null }).ok, true);
});

test('the port and scheme do not decide who is submitting', () => {
  // A store is served on 443 and reached on 80 in development.
  assert.equal(admitSubmission({ ...base, origin: 'http://shop.test:3000' }).ok, true);
});

test('a filled honeypot is refused, and answered as though it worked', () => {
  /**
   * Telling a bot it was detected teaches whoever wrote it to stop filling the
   * field. Nothing is stored either way.
   */
  const result = admitSubmission({
    ...base,
    fields: { ...base.fields, [HONEYPOT_FIELD]: 'https://spam.test' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'honeypot');
  assert.match(result.message, /sent/i, 'the message must not reveal detection');
});

test('forms that act with authority need a session and a token', () => {
  /**
   * The distinction that makes the origin-only approach defensible: changing an
   * address is an action another site must not be able to trigger, whereas
   * sending an enquiry is not.
   */
  assert.equal(needsSessionToken('customer_address'), true);
  assert.equal(needsSessionToken('customer_login'), true);
  assert.equal(needsSessionToken('contact'), false);
  assert.equal(needsSessionToken('product'), false);

  const noSession = admitSubmission({ ...base, formType: 'customer_address' });
  assert.equal(noSession.reason, 'needs_session');

  const badToken = admitSubmission({
    ...base,
    formType: 'customer_address',
    hasSession: true,
    tokenValid: false,
  });
  assert.equal(badToken.reason, 'bad_token');

  assert.equal(
    admitSubmission({ ...base, formType: 'customer_address', hasSession: true, tokenValid: true }).ok,
    true,
  );
});

// ------------------------------------------------------------- validation

test('a quote request needs a way to reply', () => {
  const errors = validateSubmission('product', { product_id: 'p1' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'email');
  // Written for a customer, not a developer.
  assert.match(errors[0].message, /reply/i);
});

test('a quote request needs to name a product', () => {
  const errors = validateSubmission('product', { email: 'a@b.test' });
  assert.ok(errors.some((error) => error.field === 'product_id'), JSON.stringify(errors));
});

test('email validation is permissive rather than clever', () => {
  // A regex that tries to fully validate an address rejects real ones.
  assert.deepEqual(validateSubmission('contact', { email: "o'brien+tag@sub.example.co.uk", body: 'x' }), []);
  assert.ok(validateSubmission('contact', { email: 'not-an-address', body: 'x' }).length > 0);
});

test('an oversized field is refused', () => {
  // These arrive from a stranger and end up in a merchant's inbox.
  const errors = validateSubmission('contact', { email: 'a@b.test', body: 'x'.repeat(20_000) });
  assert.ok(errors.some((error) => /longer/.test(error.message)), JSON.stringify(errors));
});

test('the form state carries back what was typed — but never a password', () => {
  const state = formStateFor(
    'customer_register',
    { email: 'a@b.test', password: 'hunter2', password_confirmation: 'hunter2' },
    [{ field: 'password', message: 'Use at least 8 characters.' }],
  );

  assert.equal(state.fields.email, 'a@b.test', 'correcting one field should not mean retyping');
  assert.equal('password' in state.fields, false, 'a password came back to the page');
  assert.equal('password_confirmation' in state.fields, false);
  /**
   * The shape the `form` DROP takes, not the shape it produces.
   *
   * Returning the drop's own output rendered the error list correctly and left
   * `{{ form.email }}` empty, because themes read fields off the form directly
   * and only the drop puts them there. One shape, one path.
   */
  assert.equal(state.postedSuccessfully, false);
  assert.equal(state.errors.messages.password, 'Use at least 8 characters.');
  assert.equal(state.errors.translatedFields.password, 'Password');
});

test('a clean submission has no errors object at all', () => {
  // An empty object is truthy in Liquid, so `{% if form.errors %}` would show an
  // empty error box on every successful post.
  assert.equal(formStateFor('contact', { email: 'a@b.test' }, []).errors, null);
});

// =========================================== the whole POST, through HTTP

const theme = new InMemoryThemeSource({
  'layout/theme.liquid': `<html><body>{{ content_for_layout }}</body></html>`,
  'templates/page.json': JSON.stringify({
    sections: { body: { type: 'body' } },
    order: ['body'],
  }),
  'templates/404.json': JSON.stringify({ sections: { x: { type: 'body' } }, order: ['x'] }),
  'sections/body.liquid':
    `{% if form.errors %}<ul class="errors">{{ form.errors | default_errors }}</ul>{% endif %}` +
    `<p>{{ form.email }}</p>`,
});

function fixture({ withSubmissions = true, limit } = {}) {
  const received = [];
  const store = {
    storeId: 'store_1',
    theme,
    data: {
      shop: async () => ({ id: 'store_1', name: 'Shop', handle: 'shop', domain: 'shop.test', currency: 'USD' }),
      settings: async () => ({}),
      productByHandle: async () => null,
      collectionByHandle: async () => null,
      pageByHandle: async (h) => (h === 'contact' ? { id: 'pg', handle: 'contact', title: 'Contact' } : null),
      blogByHandle: async () => null,
      articleByHandle: async () => null,
      variantsOfProduct: () => [],
      imagesOfProduct: () => [],
      productsOfCollection: () => [],
      productCountOfCollection: () => 0,
      image: () => null,
      redirects: async () => [],
      sitemapEntries: async () => [],
    },
    submissions: withSubmissions
      ? {
          requestQuote: async (input) => {
            received.push(['quote', input]);
            return { reference: 'RFQ-1042' };
          },
          contact: async (input) => {
            received.push(['contact', input]);
          },
        }
      : undefined,
  };

  const handler = new StorefrontHandler(
    { resolve: async (host) => (host === 'shop.test' ? store : null) },
    limit ? { submissionLimit: limit } : {},
  );

  return { handler, received };
}

const post = (handler, form, extra = {}) =>
  handler.handle({
    host: 'shop.test',
    path: '/pages/contact',
    query: '',
    method: 'POST',
    origin: 'https://shop.test',
    clientIp: '203.0.113.5',
    form,
    ...extra,
  });

test('a valid quote request redirects, and does not re-render', async () => {
  /**
   * Post/Redirect/Get. A success that re-rendered would resubmit on refresh,
   * and a merchant would find the same enquiry four times.
   */
  const f = fixture();
  const response = await post(f.handler, {
    form_type: 'product',
    email: 'buyer@example.test',
    product_id: 'prd_1',
    quantity: '5',
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/pages/contact?posted=requested&ref=RFQ-1042');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body, '');

  assert.deepEqual(f.received, [
    ['quote', {
      contactEmail: 'buyer@example.test',
      contactName: null,
      message: null,
      productId: 'prd_1',
      quantity: 5,
    }],
  ]);
});

test('an invalid submission re-renders the page with the theme’s own errors', async () => {
  const f = fixture();
  const response = await post(f.handler, { form_type: 'contact', email: 'nope' });

  // 422: understood, and not acted on.
  assert.equal(response.status, 422);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.cacheKey, null, 'a page holding one person’s typing must not cache');

  // Rendered through the theme, not a platform error page.
  assert.ok(response.body.includes('class="errors"'), response.body);
  assert.ok(response.body.includes('email'), response.body);
  // And what they typed came back.
  assert.ok(response.body.includes('nope'), response.body);

  assert.deepEqual(f.received, [], 'nothing should have been recorded');
});

test('a cross-site POST is refused without touching the store', async () => {
  const f = fixture();
  const response = await post(f.handler, { form_type: 'contact', email: 'a@b.test', body: 'x' }, {
    origin: 'https://evil.test',
  });

  assert.equal(response.status, 422);
  assert.deepEqual(f.received, []);
});

test('a bot filling the honeypot is thanked and ignored', async () => {
  const f = fixture();
  const response = await post(f.handler, {
    form_type: 'contact',
    email: 'bot@spam.test',
    body: 'buy things',
    [HONEYPOT_FIELD]: 'https://spam.test',
  });

  // Indistinguishable from success, from the outside.
  assert.equal(response.status, 303);
  assert.match(response.headers.location, /posted=sent/);
  assert.deepEqual(f.received, [], 'the submission must not be recorded');
});

test('the rate limit refuses before anything is parsed', async () => {
  let asked = 0;
  const f = fixture({
    limit: async (key) => {
      asked++;
      assert.match(key, /^storefront:store_1:submit:203\.0\.113\.5$/, key);
      return { allowed: false, retryAfterSeconds: 30 };
    },
  });

  const response = await post(f.handler, { form_type: 'contact', email: 'a@b.test', body: 'x' });

  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '30');
  assert.equal(asked, 1);
  assert.deepEqual(f.received, [], 'a rate-limited submission must not be recorded');
});

test('the limit is keyed by store as well as visitor', async () => {
  // So one merchant's viral moment cannot exhaust a bucket shared with everyone.
  const keys = [];
  const f = fixture({
    limit: async (key) => {
      keys.push(key);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });
  await post(f.handler, { form_type: 'contact', email: 'a@b.test', body: 'x' });
  assert.ok(keys[0].includes('store_1'), keys[0]);
  assert.ok(keys[0].includes('203.0.113.5'), keys[0]);
});

test('a store that cannot take submissions says so rather than pretending', async () => {
  // Silently accepting would lose a customer's enquiry.
  const f = fixture({ withSubmissions: false });
  const response = await post(f.handler, {
    form_type: 'contact',
    email: 'a@b.test',
    body: 'Hello',
  });

  assert.equal(response.status, 422);
  assert.ok(response.body.includes('not accepting'), response.body);
});

test('a GET is unaffected by any of this', async () => {
  const f = fixture();
  const response = await f.handler.handle({
    host: 'shop.test', path: '/pages/contact', query: '', method: 'GET',
  });
  assert.equal(response.status, 200);
});

test('an unsupported method is still refused', async () => {
  const f = fixture();
  const response = await f.handler.handle({
    host: 'shop.test', path: '/', query: '', method: 'DELETE',
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD, POST');
});

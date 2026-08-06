/**
 * Storefront · tests/request-session.test.mjs
 * The cookie that names a visitor's draft request.
 *
 * Phase 1 sells nothing (§25): a shopper assembles a Request/RFQ and a merchant
 * answers it. Themes address that object as `cart`, so the storefront speaks
 * "cart" outwards and "request" inwards.
 *
 * The token IS the secret — it carries no claims, only an unguessable name for
 * a row — so the assertions here are about the two things that make it safe:
 * it cannot be forged into something a query would accept, and the cookie
 * carrying it cannot be written by a neighbouring store.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cookieValue,
  isRequestToken,
  normaliseQuantity,
  requestCookieHeader,
  requestTokenFrom,
  MAX_LINE_QUANTITY,
} from '../../../dist/storefront/domain/index.js';

const TOKEN = 'a'.repeat(32);

test('a token is 32 hex characters and nothing else', async () => {
  /**
   * Checked before it reaches a query rather than trusted because it came from
   * a cookie. A cookie is attacker-controlled input in exactly the way a query
   * string is; the only difference is that people forget.
   */
  assert.equal(isRequestToken(TOKEN), true);
  for (const bad of [
    '', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32),
    "' OR 1=1 --", 'a'.repeat(31) + 'z', null, undefined, 42, {},
  ]) {
    assert.equal(isRequestToken(bad), false, String(bad));
  }
});

test('a forged cookie yields no token rather than a bad one', async () => {
  assert.equal(requestTokenFrom('df_request=nonsense'), null);
  assert.equal(requestTokenFrom(''), null);
  assert.equal(requestTokenFrom(null), null);
  assert.equal(requestTokenFrom(`df_request=${TOKEN}`), TOKEN);
});

test('the host-prefixed cookie is preferred, and both are read', async () => {
  /**
   * Production sets `__Host-df_request`; development cannot, because the prefix
   * requires Secure and stores are served over plain HTTP locally.
   */
  assert.equal(requestTokenFrom(`__Host-df_request=${TOKEN}`), TOKEN);
  assert.equal(requestTokenFrom(`other=1; df_request=${TOKEN}; more=2`), TOKEN);
});

test('one cookie is read without dragging in the rest', async () => {
  const header = 'a=1; df_session=secret; df_request=' + TOKEN;
  assert.equal(cookieValue(header, 'df_request'), TOKEN);
  assert.equal(cookieValue(header, 'missing'), null);
});

test('over HTTPS the cookie a neighbouring store cannot write', async () => {
  /**
   * `__Host-` is refused by browsers unless it is Secure, path-scoped to `/`
   * and carries no Domain — so a sibling subdomain cannot set a cookie this
   * store would then read as its own. On a platform where every store is a
   * subdomain, that is the difference between a session identifier and a way
   * for one shop to hand another shop a cart.
   */
  const secure = requestCookieHeader(TOKEN, true);
  assert.match(secure, /^__Host-df_request=/);
  assert.match(secure, /; Secure/);
  assert.match(secure, /; HttpOnly/);
  assert.match(secure, /; Path=\//);
  assert.ok(!/Domain=/.test(secure), '__Host- forbids a Domain');
});

test('over plain HTTP it is neither Secure nor host-prefixed', async () => {
  /**
   * Not a weakening for its own sake: a browser silently DROPS a Secure cookie
   * on http://, so hardcoding it would make the whole flow appear to work in
   * development and never persist a single line.
   */
  const plain = requestCookieHeader(TOKEN, false);
  assert.match(plain, /^df_request=/);
  assert.ok(!/; Secure/.test(plain));
  assert.match(plain, /; HttpOnly/);
});

test('the cookie is not readable by scripts and survives a cross-site link', async () => {
  const header = requestCookieHeader(TOKEN, true);
  assert.match(header, /; HttpOnly/);
  // Lax, not Strict: a shopper following a link from an email must still see
  // the list they built. The cross-site POST that Strict is usually reached for
  // is separately refused by the origin check on every mutation.
  assert.match(header, /; SameSite=Lax/);
});

test('a quantity is narrowed to something a database can hold', async () => {
  assert.equal(normaliseQuantity('3'), 3);
  assert.equal(normaliseQuantity(' 2 '), 2);
  assert.equal(normaliseQuantity('2.9'), 2, 'floored, not rounded up');
  assert.equal(normaliseQuantity(String(MAX_LINE_QUANTITY + 1000)), MAX_LINE_QUANTITY);
});

test('a quantity that is not one becomes zero, which removes the line', async () => {
  /**
   * Zero is meaningful here — it is how a theme removes a line — so it is
   * returned rather than treated as absent. A request for minus four of
   * something is not an instruction anybody meant.
   */
  for (const bad of ['-4', 'abc', '', null, undefined, 'NaN', '0']) {
    assert.equal(normaliseQuantity(bad), 0, String(bad));
  }
});

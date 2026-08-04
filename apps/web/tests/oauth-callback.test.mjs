/**
 * Web · tests/oauth-callback.test.mjs
 * The redirect back to the app.
 *
 * Small surface, disproportionate consequences: every case here looks fine in a
 * browser and breaks the app's own security check or its callback.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callbackUrl, denialUrl } from '../lib/oauth-callback.ts';

test('the code and state both come back', () => {
  assert.equal(
    callbackUrl('https://app.example/cb', { code: 'abc', state: 'xyz' }),
    'https://app.example/cb?code=abc&state=xyz',
  );
});

test('a callback that carries its own query keeps it', () => {
  // Apps route on their own parameters; replacing the query would break them.
  assert.equal(
    callbackUrl('https://app.example/cb?shop=acme', { code: 'abc', state: null }),
    'https://app.example/cb?shop=acme&code=abc',
  );
});

test('state is omitted when there was none, not sent empty', () => {
  // `state=` is not the same as absent to a strict client.
  assert.equal(
    callbackUrl('https://app.example/cb', { code: 'abc', state: null }),
    'https://app.example/cb?code=abc',
  );
  assert.equal(
    callbackUrl('https://app.example/cb', { code: 'abc', state: '' }),
    'https://app.example/cb?code=abc',
  );
});

test('state is round-tripped verbatim, however odd it looks', () => {
  // Apps sign or encode their state. Normalising it breaks the comparison they
  // are about to make, and the failure surfaces as "install did not work".
  const awkward = 'a b/c+d=e&f%20g';
  const returned = new URL(callbackUrl('https://app.example/cb', { code: 'c', state: awkward }));
  assert.equal(returned.searchParams.get('state'), awkward);
});

test('a retry does not accumulate a second code', () => {
  assert.equal(
    callbackUrl('https://app.example/cb?code=stale', { code: 'fresh', state: null }),
    'https://app.example/cb?code=fresh',
  );
});

test('declining is delivered to the app, with the state', () => {
  const url = new URL(denialUrl('https://app.example/cb', 'xyz'));
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), 'xyz');
  // No code on a denial, ever.
  assert.equal(url.searchParams.get('code'), null);
});

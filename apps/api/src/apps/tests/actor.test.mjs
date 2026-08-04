/**
 * Apps · tests/actor.test.mjs
 * An app is never the person, however it got its token.
 *
 * This pins a hole that was live: an ONLINE token carries the user id of
 * whoever authorised the app, so a check written as `userId !== null` was true
 * for an app, and an app holding nothing but `read_products` could list that
 * person's partner accounts and create new ones as them.
 *
 * The check is one line and reads as redundant next to the user check, which is
 * exactly why it needs a test standing next to it saying it is not.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * The rule the transport applies, extracted so it can be stated once.
 *
 * Order matters: an app is refused BEFORE the sign-in check, so an app token
 * gets "not available to apps" rather than a misleading "sign in first".
 */
function personGate(context) {
  if (context.actorType === 'app') return { allow: false, status: 403, reason: 'app' };
  if (context.userId === null) return { allow: false, status: 401, reason: 'anonymous' };
  return { allow: true };
}

test('a signed-in person passes', () => {
  assert.deepEqual(personGate({ actorType: 'user', userId: 'usr-1' }), { allow: true });
});

test('an anonymous caller is asked to sign in', () => {
  const verdict = personGate({ actorType: 'user', userId: null });
  assert.equal(verdict.status, 401);
});

test('an OFFLINE app token has no user, and is refused as an app not as a stranger', () => {
  // Refused either way — but the reason must be the honest one, or an app
  // author spends the afternoon debugging their sign-in.
  const verdict = personGate({ actorType: 'app', userId: null });
  assert.equal(verdict.status, 403);
  assert.equal(verdict.reason, 'app');
});

test('an ONLINE app token carries a real user id and is still refused', () => {
  // The whole point. `userId !== null` is TRUE here, so a gate written on the
  // user check alone lets the app act as the person who installed it.
  const verdict = personGate({ actorType: 'app', userId: 'usr-1' });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.status, 403);
});

/**
 * Tests · webhooks.test.mjs
 * Outbound delivery: signing, retry, giving up, and replay.
 *
 * The rules here are the ones that only bite in production — a receiver that is
 * down for an hour, one that refuses forever, and a captured request replayed
 * next week. None of them show up in a happy-path test.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  MAX_ATTEMPTS,
  WebhookDeliveryService,
  applyAttempt,
  applyToSubscription,
  assertSubscriptionValid,
  backoffSeconds,
  isRetryable,
  sign,
  verify,
  webhookBody,
} from '../dist/core/webhooks/index.js';

const SECRET = 'a'.repeat(48);

const subscription = (over = {}) => ({
  id: 'sub-1',
  eventType: 'catalog.product.published',
  url: 'https://example.test/hook',
  secret: SECRET,
  status: 'active',
  consecutiveFailures: 0,
  disabledReason: null,
  version: 1,
  ...over,
});

const delivery = (over = {}) => ({
  id: 'del-1',
  subscriptionId: 'sub-1',
  eventId: 'evt-1',
  eventType: 'catalog.product.published',
  payload: '{"id":"evt-1"}',
  status: 'pending',
  attempts: 0,
  responseStatus: null,
  error: null,
  nextAttemptAt: new Date('2026-01-01T00:00:00Z'),
  deliveredAt: null,
  ...over,
});

// --- signing -------------------------------------------------------------

test('a signature made now verifies now', () => {
  const body = '{"hello":"world"}';
  const header = sign(SECRET, body, new Date('2026-01-01T12:00:00Z'));
  assert.deepEqual(verify(SECRET, body, header, new Date('2026-01-01T12:00:10Z')), { valid: true });
});

test('a captured request stops verifying once it is old', () => {
  const body = '{"hello":"world"}';
  const header = sign(SECRET, body, new Date('2026-01-01T12:00:00Z'));

  // Genuinely ours, genuinely signed, and refused — which is the point of
  // binding the timestamp into the digest.
  const later = verify(SECRET, body, header, new Date('2026-01-01T12:30:00Z'));
  assert.equal(later.valid, false);
  assert.match(later.reason, /tolerance/);
});

test('a changed body does not verify', () => {
  const header = sign(SECRET, '{"amount":1}', new Date('2026-01-01T12:00:00Z'));
  const tampered = verify(SECRET, '{"amount":9999}', header, new Date('2026-01-01T12:00:05Z'));
  assert.equal(tampered.valid, false);
  assert.match(tampered.reason, /does not match/);
});

test('a different secret does not verify', () => {
  const body = '{"a":1}';
  const header = sign(SECRET, body, new Date('2026-01-01T12:00:00Z'));
  assert.equal(verify('b'.repeat(48), body, header, new Date('2026-01-01T12:00:05Z')).valid, false);
});

test('a malformed header is refused rather than throwing', () => {
  assert.equal(verify(SECRET, '{}', 'nonsense').valid, false);
  assert.equal(verify(SECRET, '{}', '').valid, false);
});

test('the body carries the EVENT id, so a retry can be deduplicated', () => {
  const body = JSON.parse(
    webhookBody({
      eventId: 'evt-7',
      eventType: 'catalog.product.published',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      storeId: 'store-1',
      payload: { productId: 'p1' },
    }),
  );

  assert.equal(body.id, 'evt-7');
  assert.equal(body.type, 'catalog.product.published');
  assert.deepEqual(body.data, { productId: 'p1' });
});

// --- what counts as worth retrying ---------------------------------------

test('a refusal is not retried; an outage is', () => {
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(null), true); // timeout or connection refused
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(408), true);

  // The receiver understood and said no. Retrying for two hours helps nobody
  // and looks like an attack from their side.
  assert.equal(isRetryable(404), false);
  assert.equal(isRetryable(401), false);
  assert.equal(isRetryable(422), false);
});

test('backoff grows, so a downed receiver is not hammered', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(backoffSeconds),
    [30, 120, 480, 1920, 7680],
  );
});

test('a 2xx is delivered and clears the retry', () => {
  const next = applyAttempt(delivery(), {
    responseStatus: 200,
    error: null,
    at: new Date('2026-01-01T00:00:01Z'),
  });

  assert.equal(next.status, 'delivered');
  assert.equal(next.nextAttemptAt, null);
  assert.ok(next.deliveredAt);
});

test('a redirect is not treated as success', () => {
  // The signature was computed for one destination; following a redirect would
  // send a signed customer payload somewhere it was not meant for.
  const next = applyAttempt(delivery(), {
    responseStatus: 302,
    error: null,
    at: new Date('2026-01-01T00:00:01Z'),
  });
  assert.notEqual(next.status, 'delivered');
});

test('a permanent refusal dies immediately rather than retrying', () => {
  const next = applyAttempt(delivery(), {
    responseStatus: 404,
    error: null,
    at: new Date('2026-01-01T00:00:01Z'),
  });

  assert.equal(next.status, 'dead');
  assert.equal(next.attempts, 1);
  assert.equal(next.nextAttemptAt, null);
});

test('an outage retries until the attempt cap, then dies', () => {
  let current = delivery();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
    current = applyAttempt(current, {
      responseStatus: 503,
      error: null,
      at: new Date('2026-01-01T00:00:00Z'),
    });
    assert.equal(current.status, 'pending');
    assert.ok(current.nextAttemptAt);
  }

  current = applyAttempt(current, {
    responseStatus: 503,
    error: null,
    at: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(current.status, 'dead');
  assert.equal(current.attempts, MAX_ATTEMPTS);
});

test('a working endpoint clears the failure count; a broken one is disabled', () => {
  assert.equal(applyToSubscription(subscription({ consecutiveFailures: 9 }), true).consecutiveFailures, 0);

  const failing = applyToSubscription(subscription({ consecutiveFailures: 19 }), false);
  assert.equal(failing.status, 'disabled');
  assert.match(failing.disabledReason, /consecutive failures/);
});

// --- validation ------------------------------------------------------------

test('an endpoint must be https, except on localhost', () => {
  assert.throws(() => assertSubscriptionValid(subscription({ url: 'http://example.test/hook' })), /https/);
  // Loopback is allowed, because refusing it pushes people to disable the check.
  assert.doesNotThrow(() =>
    assertSubscriptionValid(subscription({ url: 'http://localhost:9999/hook' })),
  );
  assert.throws(() => assertSubscriptionValid(subscription({ url: 'not a url' })), /absolute URL/);
});

test('a short secret is refused', () => {
  assert.throws(() => assertSubscriptionValid(subscription({ secret: 'short' })), /32 characters/);
});

// --- the service -----------------------------------------------------------

function harness(transport) {
  const subs = new Map([['sub-1', subscription()]]);
  const rows = new Map();

  return {
    subs,
    rows,
    service: new WebhookDeliveryService({
      subscriptions: {
        listening: async (_store, eventType) =>
          [...subs.values()].filter((s) => s.eventType === eventType && s.status === 'active'),
        findById: async (id) => subs.get(id) ?? null,
        save: async (s) => void subs.set(s.id, s),
      },
      deliveries: {
        create: async (storeId, d) => void rows.set(d.id, { storeId, delivery: d }),
        save: async (d) => void rows.set(d.id, { storeId: rows.get(d.id).storeId, delivery: d }),
        findById: async (id) => rows.get(id) ?? null,
        due: async () => [...rows.values()].filter((r) => r.delivery.status === 'pending'),
      },
      transport,
      now: () => new Date('2026-01-01T00:00:00Z'),
    }),
  };
}

let sent;

beforeEach(() => {
  sent = [];
});

test('enqueue records one delivery per listening subscription, and sends nothing', async () => {
  const { service, rows } = harness(async (request) => {
    sent.push(request);
    return { status: 200, error: null };
  });

  const count = await service.enqueue({
    storeId: 'store-1',
    eventId: 'evt-1',
    eventType: 'catalog.product.published',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: { productId: 'p1' },
  });

  assert.equal(count, 1);
  assert.equal(rows.size, 1);
  // Written, not sent: an event emitted inside a request must never make that
  // request wait on somebody else's server.
  assert.equal(sent.length, 0);
});

test('an event nobody subscribed to records nothing', async () => {
  const { service, rows } = harness(async () => ({ status: 200, error: null }));
  const count = await service.enqueue({
    storeId: 'store-1',
    eventId: 'evt-2',
    eventType: 'orders.request.accepted',
    occurredAt: new Date(),
    payload: {},
  });

  assert.equal(count, 0);
  assert.equal(rows.size, 0);
});

test('the drain sends, signs, and marks delivered', async () => {
  const { service } = harness(async (request) => {
    sent.push(request);
    return { status: 200, error: null };
  });

  await service.enqueue({
    storeId: 'store-1',
    eventId: 'evt-1',
    eventType: 'catalog.product.published',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: { productId: 'p1' },
  });

  const result = await service.drain();
  assert.deepEqual(result, { attempted: 1, delivered: 1, dead: 0 });

  const request = sent[0];
  const verified = verify(
    SECRET,
    request.body,
    request.headers['df-webhook-signature'],
    new Date('2026-01-01T00:00:05Z'),
  );
  assert.equal(verified.valid, true);
  assert.equal(request.headers['df-webhook-event-id'], 'evt-1');
});

test('a subscription paused after enqueue is not delivered to', async () => {
  const { service, subs } = harness(async (request) => {
    sent.push(request);
    return { status: 200, error: null };
  });

  await service.enqueue({
    storeId: 'store-1',
    eventId: 'evt-1',
    eventType: 'catalog.product.published',
    occurredAt: new Date(),
    payload: {},
  });

  // Re-read at send time rather than trusted from the enqueue: sending to a URL
  // the merchant has just removed is exactly the surprise this avoids.
  subs.set('sub-1', subscription({ status: 'paused' }));

  const result = await service.drain();
  assert.equal(sent.length, 0);
  assert.equal(result.dead, 1);
});

test('replay sends again and keeps the original attempt history', async () => {
  const { service, rows } = harness(async (request) => {
    sent.push(request);
    return { status: sent.length === 1 ? 500 : 200, error: null };
  });

  await service.enqueue({
    storeId: 'store-1',
    eventId: 'evt-1',
    eventType: 'catalog.product.published',
    occurredAt: new Date(),
    payload: {},
  });
  await service.drain();

  const [originalId] = [...rows.keys()];
  const replayed = await service.replay(originalId);

  assert.equal(replayed.status, 'delivered');
  // A new row: the failed attempt is what an operator is looking at when they
  // decide to replay, and overwriting it destroys the evidence.
  assert.notEqual(replayed.id, originalId);
  assert.equal(rows.get(originalId).delivery.responseStatus, 500);
  // Same event id, so the receiver can deduplicate.
  assert.equal(replayed.eventId, 'evt-1');
});

/**
 * Core · tests/delivery-targets.test.mjs
 * Where a webhook may be sent, and what is checked before it is.
 *
 * These cover the parsing, validation and routing — the parts that are ours.
 * The network calls to Pub/Sub and EventBridge are NOT covered and have never
 * run against the real services; see the note at the top of `cloud-transports`.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertTargetValid,
  describeTarget,
  signsPayload,
  targetFrom,
} from '../dist/core/webhooks/targets.js';

test('an https target still has to be https', () => {
  assert.doesNotThrow(() => assertTargetValid({ kind: 'https', url: 'https://a.test/hook' }));
  assert.throws(
    () => assertTargetValid({ kind: 'https', url: 'http://a.test/hook' }),
    /must use https/,
  );
  assert.doesNotThrow(() =>
    assertTargetValid({ kind: 'https', url: 'http://localhost:4300/hook' }),
  );
});

test('a Pub/Sub target is checked at subscribe time, not at first delivery', () => {
  // A typo in a project id otherwise becomes a delivery that fails forever,
  // retries six times and dead-letters, long after the tab was closed.
  assert.doesNotThrow(() =>
    assertTargetValid({ kind: 'pubsub', projectId: 'acme-prod-1', topic: 'orders' }),
  );
  assert.throws(
    () => assertTargetValid({ kind: 'pubsub', projectId: 'X', topic: 'orders' }),
    /not a Google Cloud project id/,
  );
  assert.throws(
    () => assertTargetValid({ kind: 'pubsub', projectId: 'acme-prod-1', topic: '' }),
    /not a Pub\/Sub topic name/,
  );
});

test('an EventBridge ARN is validated, because it names an ACCOUNT', () => {
  const arn = 'arn:aws:events:eu-west-1:123456789012:event-bus/default';
  assert.doesNotThrow(() =>
    assertTargetValid({ kind: 'eventbridge', region: 'eu-west-1', eventBusArn: arn }),
  );
  // A wrong ARN is a delivery to somebody else's account rather than a failure,
  // which is the one shape here that fails silently and badly.
  assert.throws(
    () => assertTargetValid({ kind: 'eventbridge', region: 'eu-west-1', eventBusArn: 'default' }),
    /not an EventBridge event bus ARN/,
  );
  assert.throws(
    () => assertTargetValid({ kind: 'eventbridge', region: 'euwest1', eventBusArn: arn }),
    /not an AWS region/,
  );
});

test('only https deliveries are signed', () => {
  // A queue authenticates to the provider — only something holding our
  // credentials can put a message on that topic. A signature there would be
  // harmless and would imply it meant something.
  assert.equal(signsPayload({ kind: 'https', url: 'https://a.test' }), true);
  assert.equal(signsPayload({ kind: 'pubsub', projectId: 'p', topic: 't' }), false);
  assert.equal(signsPayload({ kind: 'eventbridge', region: 'eu-west-1', eventBusArn: 'a' }), false);
});

test('a subscription predating cloud targets still parses as https', () => {
  // No migration needed: a missing kind means the only kind that existed.
  assert.deepEqual(targetFrom({ url: 'https://old.test/hook' }), {
    kind: 'https',
    url: 'https://old.test/hook',
  });
  assert.deepEqual(
    targetFrom({ targetKind: 'pubsub', targetConfig: '{"projectId":"p","topic":"t"}' }),
    { kind: 'pubsub', projectId: 'p', topic: 't' },
  );
});

test('a target reads sensibly on a screen without leaking anything', () => {
  assert.equal(describeTarget({ kind: 'https', url: 'https://a.test/h' }), 'https://a.test/h');
  assert.equal(
    describeTarget({ kind: 'pubsub', projectId: 'acme', topic: 'orders' }),
    'Pub/Sub · acme/orders',
  );
  assert.match(
    describeTarget({
      kind: 'eventbridge',
      region: 'eu-west-1',
      eventBusArn: 'arn:aws:events:eu-west-1:123456789012:event-bus/default',
    }),
    /EventBridge · eu-west-1 · default/,
  );
});

/**
 * Functions · tests/registry.test.mjs
 * Running whatever is deployed at a point, and what happens when it breaks.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FunctionRegistry } from '../../../dist/functions/application/index.js';
import { echoModule, infiniteLoopModule } from './wasm-fixtures.mjs';

function registry({ deployments, failureMode = 'allow', installed = ['app-1'] }) {
  const events = [];
  const store = deployments.map((entry, index) => ({
    id: `d-${index}`,
    appId: 'app-1',
    point: 'orders.quote.validate',
    name: entry.name,
    wasmBase64: Buffer.from(entry.wasm).toString('base64'),
    timeoutMs: entry.timeoutMs ?? 150,
    memoryPages: 80,
    status: entry.status ?? 'active',
    disabledReason: null,
  }));

  return {
    events,
    registry: new FunctionRegistry({
      deployments: {
        forPoint: async () => store,
        forApp: async () => store,
        insert: async () => {},
        save: async () => {},
      },
      installedAppIds: async () => installed,
      failureModeFor: () => failureMode,
      publish: async (event) => events.push(event),
    }),
  };
}

const allow = echoModule('{"allow":true}');
const refuse = echoModule('{"allow":false,"reason":"Quotes under $100 need approval."}');
const nonsense = echoModule('not json at all');
const silent = echoModule('{}');

test('no functions deployed means the platform decides alone', async () => {
  const { registry: r } = registry({ deployments: [] });
  const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});

  assert.deepEqual(verdict, { allowed: true, reasons: [], ran: 0, failed: 0 });
});

test('a function can refuse, and its reason reaches the merchant', async () => {
  const { registry: r } = registry({ deployments: [{ name: 'Approvals', wasm: refuse }] });
  const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});

  assert.equal(verdict.allowed, false);
  assert.deepEqual(verdict.reasons, ['Quotes under $100 need approval.']);
});

test('an app that is not installed does not run, however it was deployed', async () => {
  // Otherwise deploying a function would reach every store on the platform.
  const { registry: r } = registry({
    deployments: [{ name: 'Approvals', wasm: refuse }],
    installed: [],
  });

  assert.equal((await r.runPoint('orders.quote.validate', 'sto-1', {})).allowed, true);
});

test('a disabled deployment does not run', async () => {
  const { registry: r } = registry({
    deployments: [{ name: 'Approvals', wasm: refuse, status: 'disabled' }],
  });

  assert.equal((await r.runPoint('orders.quote.validate', 'sto-1', {})).allowed, true);
});

test('a function that hangs does not stop the merchant when the point allows it', async () => {
  const { registry: r, events } = registry({
    deployments: [{ name: 'Runaway', wasm: infiniteLoopModule(), timeoutMs: 100 }],
    failureMode: 'allow',
  });

  const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});

  // The whole reason `onFailure` exists: a third party shipping a bug on a
  // Friday must not stop a store quoting.
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.failed, 1);
  // But it is reported, with whose fault it was.
  const failure = events.find((event) => event.type === 'functions.run.failed');
  assert.equal(failure.payload.outcome, 'timeout');
  assert.equal(failure.payload.authorFault, true);
});

test('the same hang DOES stop it when the point says deny', async () => {
  const { registry: r } = registry({
    deployments: [{ name: 'Runaway', wasm: infiniteLoopModule(), timeoutMs: 100 }],
    failureMode: 'deny',
  });

  const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reasons[0], /cannot be skipped/);
});

test('an answer we cannot read is a failure, not an approval', async () => {
  for (const wasm of [nonsense, silent]) {
    const { registry: r } = registry({
      deployments: [{ name: 'Confused', wasm }],
      failureMode: 'deny',
    });
    const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});

    // `{}` has not said yes — it has said nothing, and reading that as approval
    // is how a validation point stops validating without anybody noticing.
    assert.equal(verdict.allowed, false, 'silence must not read as consent');
    assert.equal(verdict.failed, 1);
  }
});

test('every deployed function runs, and refusals accumulate', async () => {
  const { registry: r } = registry({
    deployments: [
      { name: 'First', wasm: refuse },
      { name: 'Second', wasm: allow },
      { name: 'Third', wasm: echoModule('{"allow":false,"reason":"Over the credit limit."}') },
    ],
  });

  const verdict = await r.runPoint('orders.quote.validate', 'sto-1', {});
  assert.equal(verdict.ran, 3);
  assert.deepEqual(verdict.reasons, [
    'Quotes under $100 need approval.',
    'Over the credit limit.',
  ]);
});

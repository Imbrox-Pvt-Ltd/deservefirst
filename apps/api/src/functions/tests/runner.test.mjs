/**
 * Functions · tests/runner.test.mjs
 * The execution tier, running real WebAssembly.
 *
 * These compile and instantiate actual modules rather than stand-ins, because
 * the properties being asserted — a forbidden import is refused, an infinite
 * loop is killed — are properties of the runtime and not of our description of
 * it. A mocked runner would pass all of this while providing no isolation at
 * all.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LIMITS,
  assertExportsValid,
  assertImportsAllowed,
  assertLimitsValid,
  isAuthorFault,
} from '../../../dist/functions/domain/index.js';
import { inspect, run } from '../../../dist/functions/infrastructure/runner.js';
import {
  echoModule,
  forbiddenImportModule,
  infiniteLoopModule,
  noEntryPointModule,
} from './wasm-fixtures.mjs';

test('a module importing anything we do not provide is refused', async () => {
  // The import table is the entire attack surface: a guest cannot reach a
  // syscall the host does not hand it, so refusing here is refusing everything.
  await assert.rejects(
    () => inspect(forbiddenImportModule()),
    /wasi_snapshot_preview1\.fd_write/,
  );
  // The message names what it wanted. "Rejected" alone is a support ticket.
  await assert.rejects(() => inspect(forbiddenImportModule()), /no network, no filesystem/);
});

test('a module with no entry point is refused', async () => {
  await assert.rejects(() => inspect(noEntryPointModule()), /must export "run"/);
});

test('random bytes are refused as not being WebAssembly at all', async () => {
  await assert.rejects(
    () => inspect(Uint8Array.from([1, 2, 3, 4])),
    /not a valid WebAssembly module/,
  );
});

test('a well-formed function passes inspection and runs', async () => {
  const wasm = echoModule('{"discount":"10.00"}');
  await assert.doesNotReject(() => inspect(wasm));

  const result = await run(wasm, '{"cart":42}');
  assert.equal(result.outcome, 'ok');
  assert.equal(result.output, '{"discount":"10.00"}');
  assert.equal(result.error, null);
});

test('an infinite loop is TERMINATED, not waited on', async () => {
  const started = Date.now();
  const result = await run(infiniteLoopModule(), '{}', { ...DEFAULT_LIMITS, timeoutMs: 120 });
  const elapsed = Date.now() - started;

  assert.equal(result.outcome, 'timeout');
  assert.match(result.error, /ran longer than 120ms/);
  // The point: a guest that never yields cannot be asked to stop, so a
  // cooperative deadline is one it ignores. This has to come back regardless.
  assert.ok(elapsed < 3000, `the tier should have killed it quickly, took ${elapsed}ms`);
});

test('a timeout is the author’s fault; an exhausted host is not', () => {
  assert.equal(isAuthorFault('timeout'), true);
  assert.equal(isAuthorFault('trap'), true);
  // Worth looking at on our side before telling somebody their code is wrong.
  assert.equal(isAuthorFault('memory_exhausted'), false);
  assert.equal(isAuthorFault('ok'), false);
});

test('the host interface is two functions, and stays that way', () => {
  // Every name here is a capability handed to every function anyone deploys.
  assert.doesNotThrow(() =>
    assertImportsAllowed([
      { module: 'deservefirst', name: 'log', kind: 'function' },
      { module: 'deservefirst', name: 'abort', kind: 'function' },
    ]),
  );
  assert.throws(
    () => assertImportsAllowed([{ module: 'deservefirst', name: 'fetch', kind: 'function' }]),
    /deservefirst\.fetch/,
  );
  assert.throws(
    () => assertImportsAllowed([{ module: 'env', name: 'now', kind: 'function' }]),
    /env\.now/,
  );
});

test('limits have ceilings, because a function that needs more is a service', () => {
  assert.doesNotThrow(() => assertLimitsValid(DEFAULT_LIMITS));
  assert.throws(() => assertLimitsValid({ ...DEFAULT_LIMITS, timeoutMs: 60_000 }), /between 1 and 5000/);
  assert.throws(() => assertLimitsValid({ ...DEFAULT_LIMITS, memoryPages: 100_000 }), /between 1 and 1600/);
  assert.throws(() => assertLimitsValid({ ...DEFAULT_LIMITS, timeoutMs: 0 }), /between 1 and 5000/);
});

test('exports are checked for memory as well as the entry point', () => {
  assert.doesNotThrow(() => assertExportsValid(['run', 'memory']));
  // Without exported memory the host cannot pass bytes in or read them out, so
  // the module is unusable however correct it is inside.
  assert.throws(() => assertExportsValid(['run']), /must export its "memory"/);
});

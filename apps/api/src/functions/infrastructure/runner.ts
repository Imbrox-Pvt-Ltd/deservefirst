/**
 * Functions · infrastructure/runner.ts
 * Starting the tier, and killing it when it misbehaves.
 *
 * The timeout is enforced by TERMINATING the worker, not by asking it to stop.
 * A guest in an infinite loop never yields, so a cooperative deadline is a
 * deadline it can ignore — and the entire point of §22.3 is that a bad function
 * cannot take the platform down with it.
 * Layer: infrastructure.
 */

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';

import {
  DEFAULT_LIMITS,
  assertExportsValid,
  assertImportsAllowed,
  type ResourceLimits,
  type RunResult,
} from '../domain/limits';

/**
 * The worker lives beside this file in `dist`.
 *
 * `__dirname` rather than `import.meta.url` because the API compiles to
 * CommonJS. The worker itself is `.mjs` and is copied rather than compiled —
 * it is the trust boundary, and it should be readable as the exact bytes that
 * run rather than as something a build step produced.
 */
const here = __dirname;

/**
 * Inspects a compiled module without running any of it.
 *
 * `WebAssembly.compile` validates the binary and exposes its import and export
 * tables; neither runs guest code. That is what makes this safe to do on the
 * API process — the decision to refuse is made before anything is instantiated.
 */
export async function inspect(wasm: Uint8Array): Promise<void> {
  let module: WebAssembly.Module;
  try {
    // The cast is the DOM lib and Node disagreeing about ArrayBuffer variance,
    // not a real mismatch — the bytes are the bytes.
    module = await WebAssembly.compile(wasm as unknown as BufferSource);
  } catch (error) {
    throw new Error(
      `this is not a valid WebAssembly module: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  assertImportsAllowed(WebAssembly.Module.imports(module));
  assertExportsValid(WebAssembly.Module.exports(module).map((entry) => entry.name));
}

/**
 * Runs a function and returns what happened.
 *
 * Never throws for a guest's failure. A trap, a timeout and an over-long output
 * are outcomes to report, not exceptions to propagate into a request handler —
 * the caller has to decide what to do without a third party's bug becoming a
 * 500 on a merchant's screen.
 */
export async function run(
  wasm: Uint8Array,
  input: string,
  limits: ResourceLimits = DEFAULT_LIMITS,
): Promise<RunResult> {
  const startedAt = Date.now();

  return new Promise<RunResult>((resolve) => {
    const worker = new Worker(join(here, 'worker.mjs'), {
      workerData: {
        wasm,
        input,
        memoryPages: limits.memoryPages,
        maxPayloadBytes: limits.maxPayloadBytes,
      },
      // No environment, no argv, and stdout captured rather than inherited: a
      // guest that finds a way to print must not write into our logs directly.
      env: {},
      argv: [],
      stdout: true,
      stderr: true,
      resourceLimits: {
        // A second ceiling, enforced by the JS engine rather than by us. The
        // WebAssembly maximum bounds the guest's own memory; this bounds the
        // worker if something outside the guest allocates.
        maxOldGenerationSizeMb: Math.max(16, Math.ceil((limits.memoryPages * 64) / 1024) + 16),
      },
    });

    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        outcome: 'timeout',
        durationMs: Date.now() - startedAt,
        output: null,
        logs: [],
        error: `the function ran longer than ${limits.timeoutMs}ms and was stopped`,
      });
    }, limits.timeoutMs);

    worker.on('message', (message: Omit<RunResult, 'durationMs'>) => {
      finish({ ...message, durationMs: Date.now() - startedAt });
    });

    worker.on('error', (error: Error) => {
      finish({
        outcome: 'trap',
        durationMs: Date.now() - startedAt,
        output: null,
        logs: [],
        error: error.message,
      });
    });

    worker.on('exit', (code) => {
      // A worker that exits without a message crashed in a way that produced
      // no error event — reported rather than left as a promise nobody settles.
      if (code !== 0) {
        finish({
          outcome: 'trap',
          durationMs: Date.now() - startedAt,
          output: null,
          logs: [],
          error: `the Functions tier exited with code ${code}`,
        });
      }
    });
  });
}

/**
 * Functions · infrastructure/worker.mjs
 * The Functions tier, as one worker thread.
 *
 * This file is the entire trust boundary. Everything above it is our code;
 * everything the guest module does happens inside a `WebAssembly.Instance`
 * created here, with an import object containing exactly two functions.
 *
 * It is deliberately plain JavaScript with no imports of its own beyond
 * `worker_threads`. A worker that pulled in the platform's modules would hand a
 * guest a much larger surface the moment somebody made one of them reachable
 * from an import — and the whole argument of §22.3 is that the surface is small
 * enough to read in one sitting.
 *
 * In production the tier is a separate deployment, not a thread. The isolation
 * that matters here — a guest cannot reach the API's memory, cannot block its
 * event loop, and can be killed — is the same either way; the deployment
 * boundary adds fault isolation and independent scaling on top.
 * Layer: infrastructure.
 */

import { parentPort, workerData } from 'node:worker_threads';

const { wasm, input, memoryPages, maxPayloadBytes } = workerData;
const logs = [];

/** UTF-8 out of guest memory, bounded so a bad length cannot allocate the host to death. */
function readString(memory, pointer, length) {
  if (length < 0 || length > maxPayloadBytes) {
    throw new RangeError(`output length ${length} exceeds the payload limit`);
  }
  const bytes = new Uint8Array(memory.buffer, pointer, length);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function main() {
  /**
   * Memory is created HERE, with a maximum, and handed to the module.
   *
   * A module that declares its own memory could declare it unbounded. Providing
   * it as an import means the ceiling is ours: `memory.grow` past the maximum
   * fails inside the guest rather than consuming the host.
   */
  const memory = new WebAssembly.Memory({ initial: 1, maximum: memoryPages });

  const imports = {
    deservefirst: {
      /** Writes to this run's log and nowhere else. */
      log: (pointer, length) => {
        try {
          if (logs.length < 100) logs.push(readString(memory, pointer, length));
        } catch {
          // A bad log pointer is not worth failing the run over.
        }
      },
      abort: () => {
        throw new Error('the function aborted');
      },
    },
  };

  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, imports);

  // The guest may export its own memory instead of using ours; use whichever
  // it actually wired up, so both toolchain conventions work.
  const guestMemory = instance.exports.memory ?? memory;

  const encoded = new TextEncoder().encode(input);
  if (encoded.length > maxPayloadBytes) {
    parentPort.postMessage({ outcome: 'payload_too_large', logs, error: null, output: null });
    return;
  }

  /**
   * The guest allocates, or we use offset 1024.
   *
   * A module compiled from a language with a runtime exports `alloc`; a
   * hand-written one usually does not and expects the host to pick a spot. The
   * fallback is past the low addresses toolchains use for their own data.
   */
  const pointer =
    typeof instance.exports.alloc === 'function'
      ? instance.exports.alloc(encoded.length)
      : 1024;

  new Uint8Array(guestMemory.buffer).set(encoded, pointer);

  const packed = instance.exports.run(pointer, encoded.length);

  /**
   * The result is a pointer and a length packed into one i64-ish value.
   *
   * WebAssembly can only return numbers, so a function returning bytes has to
   * return where they are. High 32 bits are the pointer, low 32 the length.
   */
  const asBig = BigInt(packed);
  const outPointer = Number(asBig >> 32n);
  const outLength = Number(asBig & 0xffffffffn);

  const output = outLength === 0 ? '' : readString(guestMemory, outPointer, outLength);
  parentPort.postMessage({ outcome: 'ok', logs, error: null, output });
}

main().catch((error) => {
  // A trap, a failed compile, or memory exhaustion. Reported as the function's
  // problem with the real message, because "it failed" is not debuggable.
  const message = error instanceof Error ? error.message : String(error);
  const outcome =
    /memory|allocat/i.test(message) ? 'memory_exhausted'
    : /exceeds the payload/i.test(message) ? 'invalid_output'
    : 'trap';

  parentPort.postMessage({ outcome, logs, error: message, output: null });
});

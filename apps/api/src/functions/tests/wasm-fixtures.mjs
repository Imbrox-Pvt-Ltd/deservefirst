/**
 * Functions · tests/wasm-fixtures.mjs
 * Real WebAssembly modules, assembled byte by byte.
 *
 * Hand-built rather than compiled from source, because a test that needs a
 * toolchain installed is a test that gets skipped. These are genuine modules —
 * the runtime compiles and instantiates them exactly as it would a partner's —
 * so the tests exercise the tier rather than a stand-in for it.
 * Layer: tests.
 */

/** LEB128, which is how WebAssembly encodes every length and index. */
function uleb(value) {
  const out = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    out.push(byte);
  } while (remaining !== 0);
  return out;
}

function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

function vector(items) {
  return [...uleb(items.length), ...items.flat()];
}

/**
 * A code-section entry: its own byte length, then the body.
 *
 * Computed from the body rather than written by hand — counting these by eye
 * is how both of these fixtures were one byte short on the first attempt, and
 * the error WebAssembly gives for that names an offset rather than a cause.
 */
function codeEntry(body) {
  return [...uleb(body.length), ...body];
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const I32 = 0x7f;
const I64 = 0x7e;

/**
 * A module that returns a fixed packed pointer/length, and exports memory.
 *
 * The smallest thing that satisfies the contract: the host writes input at a
 * pointer, calls `run`, and reads the packed result. This one ignores its input
 * and returns bytes it wrote into memory at build time via a data segment.
 */
export function echoModule(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const at = 2048;
  const packed = (BigInt(at) << 32n) | BigInt(bytes.length);

  // i64.const takes SIGNED LEB128; these values are small enough positive that
  // the unsigned encoding is identical apart from needing a zero high bit.
  const sleb = (value) => {
    const out = [];
    let more = true;
    let v = value;
    while (more) {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v === 0n && (byte & 0x40) === 0) more = false;
      else byte |= 0x80;
      out.push(byte);
    }
    return out;
  };

  return Uint8Array.from([
    ...MAGIC,
    // type: (i32, i32) -> i64
    ...section(1, vector([[0x60, ...uleb(2), I32, I32, ...uleb(1), I64]])),
    // function: one, of type 0
    ...section(3, vector([[0]])),
    // memory: one page, max two
    ...section(5, vector([[0x01, ...uleb(1), ...uleb(2)]])),
    // export: "memory" and "run"
    ...section(
      7,
      vector([
        [...uleb(6), ...[...'memory'].map((c) => c.charCodeAt(0)), 0x02, ...uleb(0)],
        [...uleb(3), ...[...'run'].map((c) => c.charCodeAt(0)), 0x00, ...uleb(0)],
      ]),
    ),
    // code: no locals; i64.const packed; end
    ...section(10, vector([codeEntry([0, 0x42, ...sleb(packed), 0x0b])])),
    // data: the bytes, at `at`
    ...section(
      11,
      vector([[0x00, 0x41, ...uleb(at), 0x0b, ...uleb(bytes.length), ...bytes]]),
    ),
  ]);
}

/** A module that loops forever, to prove the timeout terminates rather than waits. */
export function infiniteLoopModule() {
  return Uint8Array.from([
    ...MAGIC,
    ...section(1, vector([[0x60, ...uleb(2), I32, I32, ...uleb(1), I64]])),
    ...section(3, vector([[0]])),
    ...section(5, vector([[0x01, ...uleb(1), ...uleb(2)]])),
    ...section(
      7,
      vector([
        [...uleb(6), ...[...'memory'].map((c) => c.charCodeAt(0)), 0x02, ...uleb(0)],
        [...uleb(3), ...[...'run'].map((c) => c.charCodeAt(0)), 0x00, ...uleb(0)],
      ]),
    ),
    // no locals; loop; br 0; end loop; unreachable; end.
    // The `unreachable` is what satisfies validation — the function promises an
    // i64 it never produces, and branching away is not enough on its own.
    ...section(10, vector([codeEntry([0, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x00, 0x0b])])),
  ]);
}

/**
 * A module importing something the tier does not provide.
 *
 * `wasi_snapshot_preview1.fd_write` is what a language runtime emits when it
 * wants to print — and what it would use to reach a filesystem.
 */
export function forbiddenImportModule() {
  const name = (text) => [...uleb(text.length), ...[...text].map((c) => c.charCodeAt(0))];
  return Uint8Array.from([
    ...MAGIC,
    ...section(1, vector([[0x60, ...uleb(2), I32, I32, ...uleb(1), I64]])),
    ...section(
      2,
      vector([[...name('wasi_snapshot_preview1'), ...name('fd_write'), 0x00, ...uleb(0)]]),
    ),
    ...section(3, vector([[0]])),
    ...section(5, vector([[0x01, ...uleb(1), ...uleb(2)]])),
    ...section(
      7,
      vector([
        [...uleb(6), ...[...'memory'].map((c) => c.charCodeAt(0)), 0x02, ...uleb(0)],
        [...uleb(3), ...[...'run'].map((c) => c.charCodeAt(0)), 0x00, ...uleb(1)],
      ]),
    ),
    ...section(10, vector([codeEntry([0, 0x42, 0x00, 0x0b])])),
  ]);
}

/** A valid module that exports no `run`, to prove the export check bites. */
export function noEntryPointModule() {
  return Uint8Array.from([
    ...MAGIC,
    ...section(1, vector([[0x60, ...uleb(0), ...uleb(0)]])),
    ...section(3, vector([[0]])),
    ...section(5, vector([[0x01, ...uleb(1), ...uleb(2)]])),
    ...section(
      7,
      vector([[...uleb(6), ...[...'memory'].map((c) => c.charCodeAt(0)), 0x02, ...uleb(0)]]),
    ),
    ...section(10, vector([codeEntry([0, 0x0b])])),
  ]);
}

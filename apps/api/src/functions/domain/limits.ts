/**
 * Functions · domain/limits.ts
 * What a third party's code may do, decided before any of it runs.
 *
 * §22.3: deterministic, input/output-bounded, CPU/memory/time-limited, no
 * network or IO. Every one of those is a decision made about a module BEFORE it
 * is instantiated, which is the only point at which refusing is cheap.
 *
 * The import check is the load-bearing one. A WebAssembly module cannot reach
 * anything the host does not hand it — no syscalls, no ambient network, no
 * filesystem — so the entire attack surface is the import table. A module that
 * imports nothing outside our tiny interface is a pure function over bytes, and
 * that is a property we can verify statically rather than hope for.
 * Layer: domain (pure).
 */

export class FunctionRuleError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'FunctionRuleError';
  }
}

/**
 * The only module the host provides, and the only names on it.
 *
 * Deliberately tiny and deliberately not extensible by configuration. Every
 * name added here is a capability handed to every function anyone ever deploys,
 * and the argument for adding one always sounds reasonable in isolation.
 *
 * `log` is here because a function author with no way to print anything debugs
 * by guessing. It writes to the deployment's own log and nowhere else.
 * `abort` is what most toolchains emit for a failed assertion; refusing it
 * would mean refusing modules built by ordinary compilers.
 */
export const HOST_MODULE = 'deservefirst';
export const HOST_FUNCTIONS: readonly string[] = ['log', 'abort'];

export interface ResourceLimits {
  /** Hard wall-clock cap. The worker is terminated, not asked to stop. */
  readonly timeoutMs: number;
  /** WebAssembly pages, 64 KiB each. The module cannot grow past it. */
  readonly memoryPages: number;
  /** Largest input we will hand a function, and largest output we will take. */
  readonly maxPayloadBytes: number;
}

/**
 * The defaults.
 *
 * Small on purpose. A function that needs more than five megabytes or two
 * hundred milliseconds is doing something the platform should be doing, and
 * raising a limit is a decision somebody should have to make deliberately
 * rather than inherit.
 */
export const DEFAULT_LIMITS: ResourceLimits = {
  timeoutMs: 200,
  memoryPages: 80,
  maxPayloadBytes: 5 * 1024 * 1024,
};

export function assertLimitsValid(limits: ResourceLimits): void {
  if (limits.timeoutMs < 1 || limits.timeoutMs > 5_000) {
    throw new FunctionRuleError('timeoutMs', 'must be between 1 and 5000');
  }
  if (limits.memoryPages < 1 || limits.memoryPages > 1_600) {
    // 1600 pages is 100 MiB. Past that a function is a service.
    throw new FunctionRuleError('memoryPages', 'must be between 1 and 1600 (64KiB each)');
  }
  if (limits.maxPayloadBytes < 1 || limits.maxPayloadBytes > 16 * 1024 * 1024) {
    throw new FunctionRuleError('maxPayloadBytes', 'must be between 1 byte and 16 MiB');
  }
}

export interface ModuleImport {
  readonly module: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * Refuses a module that wants anything we do not offer.
 *
 * This runs on the compiled module's own import table, which is the truth
 * rather than a claim the author makes about their code. A module asking for
 * `wasi_snapshot_preview1` wants a filesystem and a clock; one asking for `env`
 * with arbitrary names wants whatever its toolchain assumed. Both are refused
 * with the name they asked for, because "your module was rejected" without
 * saying what it wanted is a support ticket.
 */
export function assertImportsAllowed(imports: readonly ModuleImport[]): void {
  const offending = imports.filter(
    (entry) => entry.module !== HOST_MODULE || !HOST_FUNCTIONS.includes(entry.name),
  );

  if (offending.length === 0) return;

  const described = offending
    .slice(0, 5)
    .map((entry) => `${entry.module}.${entry.name}`)
    .join(', ');

  throw new FunctionRuleError(
    'imports',
    `this module imports ${described}, which the Functions tier does not provide. ` +
      `Only ${HOST_MODULE}.{${HOST_FUNCTIONS.join(', ')}} is available — functions get no ` +
      'network, no filesystem and no clock, by design.',
  );
}

/**
 * The export a function must provide, and what it means.
 *
 * One entry point taking a pointer and a length and returning a packed pointer
 * and length. Bytes in, bytes out — the host encodes and decodes JSON on its
 * side, so the contract does not depend on the guest's language having a JSON
 * library or agreeing with ours about number precision.
 */
export const ENTRY_POINT = 'run';
export const MEMORY_EXPORT = 'memory';

/**
 * The parameter is `exported`, not `exports`.
 *
 * Compiled to CommonJS, a parameter named `exports` shadows the module's own
 * `exports` object — so `ENTRY_POINT` resolved to `undefined` and every module
 * was refused for not exporting "undefined". It type-checked perfectly.
 */
export function assertExportsValid(exported: readonly string[]): void {
  if (!exported.includes(ENTRY_POINT)) {
    throw new FunctionRuleError(
      'exports',
      `a function must export "${ENTRY_POINT}" — the entry point the tier calls`,
    );
  }
  if (!exported.includes(MEMORY_EXPORT)) {
    // Without exported memory the host cannot write the input or read the
    // output, so the module is unusable however correct it is internally.
    throw new FunctionRuleError(
      'exports',
      `a function must export its "${MEMORY_EXPORT}" so the tier can pass bytes in and out`,
    );
  }
}

/** Why a run ended. Reported to the author, and never merged into one status. */
export type RunOutcome =
  | 'ok'
  | 'timeout'
  | 'trap'
  | 'memory_exhausted'
  | 'invalid_output'
  | 'payload_too_large';

export interface RunResult {
  readonly outcome: RunOutcome;
  readonly durationMs: number;
  readonly output: string | null;
  readonly logs: readonly string[];
  readonly error: string | null;
}

/**
 * Whether a failed run is the author's fault or ours.
 *
 * A timeout and a trap are the function's; anything else is worth looking at on
 * our side before telling somebody their code is wrong.
 */
export function isAuthorFault(outcome: RunOutcome): boolean {
  return outcome === 'timeout' || outcome === 'trap' || outcome === 'invalid_output';
}

/**
 * Apps · domain/monitoring.ts
 * What an app did, and whether it is heading for trouble.
 *
 * The taxonomy is fixed by the reference product's own Logs filter, and copying
 * it exactly is the point: an integrator who has worked with that admin already
 * knows what "App event" means here, and a vocabulary that is 80% the same is
 * worse than one that is either identical or obviously different.
 *
 * Most of these cannot be emitted yet — there are no functions, no billing and
 * no UI extensions. They are declared anyway, because the alternative is a
 * column whose values grow one migration at a time and a screen whose filter
 * list is always one release behind the thing it filters.
 * Layer: domain (pure).
 */

export const LOG_TYPES = [
  'webhook',
  'function',
  'app_event',
  'billing_event',
  'graphql_request',
  'rest_request',
  'ui_extension_error',
  'assistant_event',
] as const;

export type LogType = (typeof LOG_TYPES)[number];

/** The three this platform can actually produce today. The rest await features. */
export const EMITTED_LOG_TYPES: readonly LogType[] = ['webhook', 'app_event', 'rest_request'];

export interface AppRequestLog {
  readonly id: string;
  readonly appId: string;
  readonly storeId: string;
  readonly type: LogType;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  /** The dated version the call was made against (§13.6). */
  readonly apiVersion: string;
  /** Set when the call used something scheduled for removal. */
  readonly deprecation: string | null;
  readonly at: Date;
}

/**
 * Whether a status counts as the app's own fault.
 *
 * 4xx is the app doing something wrong — a bad request, a scope it does not
 * have, a record that is gone. 5xx is ours. They are counted separately because
 * an app author looking at a health page needs to know which of those two
 * conversations they are about to have, and a single "error rate" hides it.
 */
export function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

export function isServerError(status: number): boolean {
  return status >= 500;
}

export interface HealthSummary {
  readonly total: number;
  readonly clientErrors: number;
  readonly serverErrors: number;
  readonly deprecatedCalls: number;
  /** Slowest first — the endpoints an author should look at. */
  readonly slowest: readonly { path: string; averageMs: number; calls: number }[];
  readonly deprecations: readonly { deprecation: string; calls: number }[];
}

/**
 * Rolls a window of calls into what a health page shows.
 *
 * Averages rather than percentiles, deliberately: this runs over whatever a
 * store's traffic actually was, and a p95 computed from eleven requests is a
 * number that looks authoritative and means nothing. When the volume justifies
 * percentiles, the aggregation belongs in the database rather than here.
 */
export function summarise(logs: readonly AppRequestLog[]): HealthSummary {
  const byPath = new Map<string, { total: number; calls: number }>();
  const byDeprecation = new Map<string, number>();

  let clientErrors = 0;
  let serverErrors = 0;
  let deprecatedCalls = 0;

  for (const log of logs) {
    if (isClientError(log.status)) clientErrors += 1;
    if (isServerError(log.status)) serverErrors += 1;

    if (log.deprecation) {
      deprecatedCalls += 1;
      byDeprecation.set(log.deprecation, (byDeprecation.get(log.deprecation) ?? 0) + 1);
    }

    const entry = byPath.get(log.path) ?? { total: 0, calls: 0 };
    entry.total += log.durationMs;
    entry.calls += 1;
    byPath.set(log.path, entry);
  }

  const slowest = [...byPath.entries()]
    .map(([path, entry]) => ({
      path,
      averageMs: Math.round(entry.total / entry.calls),
      calls: entry.calls,
    }))
    .sort((a, b) => b.averageMs - a.averageMs)
    .slice(0, 5);

  const deprecations = [...byDeprecation.entries()]
    .map(([deprecation, calls]) => ({ deprecation, calls }))
    .sort((a, b) => b.calls - a.calls);

  return {
    total: logs.length,
    clientErrors,
    serverErrors,
    deprecatedCalls,
    slowest,
    deprecations,
  };
}

/**
 * Whether this app needs telling something.
 *
 * Deprecation first, and not by volume. A single call to something being
 * removed is a release that will break; a thousand 404s is an app that is
 * already broken and whose author knows. The health page ranks by what the
 * author cannot already see from their own logs.
 */
export function headline(summary: HealthSummary): string | null {
  if (summary.deprecatedCalls > 0) {
    const worst = summary.deprecations[0];
    return worst
      ? `${summary.deprecatedCalls} call${summary.deprecatedCalls === 1 ? '' : 's'} to something being removed: ${worst.deprecation}`
      : null;
  }
  if (summary.serverErrors > 0) {
    return `${summary.serverErrors} request${summary.serverErrors === 1 ? '' : 's'} failed on our side.`;
  }
  return null;
}

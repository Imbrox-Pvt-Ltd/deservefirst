/**
 * Storefront · domain/redirects.ts
 * URL redirects: what happens when a merchant renames something.
 *
 * A handle is part of a URL, so renaming a product breaks every link to it —
 * search results, printed cards, other people's blog posts. A redirect is how
 * that stops being a 404, and PLAN/07 lists it as missing for a reason: without
 * one, a merchant tidying up their product titles quietly destroys their own
 * search traffic and finds out weeks later.
 *
 * Three things here are not obvious and each is a real defect if skipped:
 *
 *   **Loops.** `a → b` and `b → a` is an infinite redirect. Browsers give up
 *   and show an error page, which is worse than the 404 the redirect replaced.
 *   Detected when the rule is saved, not when a visitor finds it.
 *
 *   **Chains.** `a → b → c` costs the visitor two round trips and search
 *   engines stop following after a handful. Resolved to the final target so a
 *   chain of any length is one hop.
 *
 *   **Open redirects.** A target pointing at another host turns the merchant's
 *   domain into a phishing relay: a link that genuinely starts at their store
 *   and lands somewhere else. Targets are confined to this store.
 * Layer: domain (pure).
 */

export interface RedirectRule {
  /** The path that no longer exists, e.g. `/products/old-handle`. */
  readonly from: string;
  /** Where it goes now. Relative to this store. */
  readonly to: string;
}

export class RedirectError extends Error {
  constructor(
    readonly rule: RedirectRule,
    detail: string,
  ) {
    super(`"${rule.from}" → "${rule.to}": ${detail}`);
    this.name = 'RedirectError';
  }
}

/**
 * How many hops a chain may be resolved through.
 *
 * A ceiling rather than unlimited: rules are merchant data and a cycle that
 * slipped past validation must not hang a request. Ten is far more than any
 * real chain and cheap to walk.
 */
const MAX_CHAIN = 10;

/**
 * Normalises a path for comparison.
 *
 * Query and fragment are dropped, the trailing slash goes, and case is lowered.
 * A redirect table that treated `/Products/Hat` and `/products/hat/` as three
 * different rules would need the merchant to enter all of them.
 */
export function normaliseRedirectPath(path: string): string {
  const withoutQuery = String(path ?? '').split('?')[0]!.split('#')[0]!.trim();
  const lowered = withoutQuery.toLowerCase();
  const trimmed = lowered.length > 1 ? lowered.replace(/\/+$/, '') : lowered;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Whether a target is somewhere this store can send a visitor.
 *
 * Relative paths only. A merchant genuinely wanting to send traffic elsewhere
 * should do it deliberately somewhere that says so, not through a table whose
 * whole purpose is repairing internal links — and an open redirect on a
 * shopping domain is a phishing tool that inherits the store's reputation.
 */
export function isSafeRedirectTarget(target: string): boolean {
  const value = String(target ?? '').trim();
  if (value === '') return false;

  // Protocol-relative `//evil.test` is an absolute URL wearing a disguise.
  if (value.startsWith('//')) return false;
  if (!value.startsWith('/')) return false;
  // Control characters and backslashes are how a target smuggles a second URL
  // past a naive check; browsers normalise `\` to `/`.
  if (/[\u0000-\u0020\\]/.test(value)) return false;

  return true;
}

export function assertRedirectValid(rule: RedirectRule): void {
  if (!isSafeRedirectTarget(rule.to)) {
    throw new RedirectError(
      rule,
      'a redirect may only point at a path on this store, starting with "/"',
    );
  }
  if (!rule.from.startsWith('/')) {
    throw new RedirectError(rule, 'the path being redirected must start with "/"');
  }
  if (normaliseRedirectPath(rule.from) === normaliseRedirectPath(rule.to)) {
    // A rule pointing at itself is an immediate loop.
    throw new RedirectError(rule, 'a path cannot redirect to itself');
  }
}

/**
 * The compiled table a request is matched against.
 *
 * Built once from the merchant's rules, so a lookup is a map read rather than a
 * scan — a store with ten thousand redirects should cost the same per request
 * as one with ten.
 */
export interface RedirectTable {
  readonly size: number;
  /** The final destination for a path, or null. Chains already resolved. */
  resolve(path: string): string | null;
}

export interface CompileResult {
  readonly table: RedirectTable;
  /** Rules refused, with why. Shown to the merchant rather than discarded. */
  readonly rejected: readonly { rule: RedirectRule; reason: string }[];
}

/**
 * Compiles rules into a table, refusing the ones that would misbehave.
 *
 * Refused rather than dropped silently: a merchant who typed a loop needs to
 * know, and a redirect that vanished without explanation is indistinguishable
 * from one that was never saved.
 */
export function compileRedirects(rules: readonly RedirectRule[]): CompileResult {
  const rejected: { rule: RedirectRule; reason: string }[] = [];
  const direct = new Map<string, string>();

  for (const rule of rules) {
    try {
      assertRedirectValid(rule);
    } catch (error) {
      rejected.push({ rule, reason: (error as Error).message });
      continue;
    }

    const from = normaliseRedirectPath(rule.from);
    if (direct.has(from)) {
      // Two rules for one path: whichever loaded second would win, and which
      // that is depends on row order.
      rejected.push({ rule, reason: `"${from}" already redirects somewhere else` });
      continue;
    }
    direct.set(from, rule.to);
  }

  /** Follows a chain to its end, refusing to circle. */
  const resolveChain = (start: string): string | null => {
    let current = direct.get(normaliseRedirectPath(start));
    if (current === undefined) return null;

    const seen = new Set<string>([normaliseRedirectPath(start)]);

    for (let hop = 0; hop < MAX_CHAIN; hop++) {
      const key = normaliseRedirectPath(current);
      if (seen.has(key)) {
        /**
         * A cycle. The visitor gets nothing rather than a redirect loop: a
         * browser error page is worse than the 404 this was meant to fix, and
         * the 404 is at least the theme's own.
         */
        return null;
      }
      const next = direct.get(key);
      if (next === undefined) return current;
      seen.add(key);
      current = next;
    }

    // Longer than the ceiling. Treated as a cycle for the same reason.
    return null;
  };

  const resolved = new Map<string, string>();
  for (const from of direct.keys()) {
    const destination = resolveChain(from);
    if (destination !== null) resolved.set(from, destination);
    else {
      rejected.push({
        rule: { from, to: direct.get(from) as string },
        reason: 'this redirect loops back on itself',
      });
    }
  }

  return {
    table: {
      size: resolved.size,
      resolve: (path) => resolved.get(normaliseRedirectPath(path)) ?? null,
    },
    rejected,
  };
}

/**
 * The redirect for a request, preserving its query string.
 *
 * A campaign link carries `?utm_source`, and dropping it on redirect loses the
 * attribution the merchant is paying for. The target's own query wins where
 * both have the same key, since the merchant wrote it deliberately.
 */
export function redirectFor(table: RedirectTable, path: string, query = ''): string | null {
  const destination = table.resolve(path);
  if (destination === null) return null;
  if (query === '') return destination;

  const [targetPath = '/', targetQuery = ''] = destination.split('?');
  const merged = new URLSearchParams(query);
  for (const [key, value] of new URLSearchParams(targetQuery)) merged.set(key, value);

  const rendered = merged.toString();
  return rendered === '' ? targetPath : `${targetPath}?${rendered}`;
}

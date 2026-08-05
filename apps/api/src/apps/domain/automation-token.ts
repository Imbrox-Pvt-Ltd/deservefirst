/**
 * Apps · domain/automation-token.ts
 * A token for a build server, and the things it deliberately cannot do.
 *
 * Everything else that authenticates here acts for somebody: a session is a
 * person, an app token is an install a merchant approved. A CI job is neither.
 * It is a partner's own automation, and the interesting question is not what it
 * may do but what it must never do.
 *
 * It must never read merchant data. A build server's token lives in a CI
 * provider's environment variables, gets printed by a careless `env`, and is
 * copied into a fork's pull request by a misconfigured workflow — so it is
 * given the smallest possible authority: it can push a version or a function
 * for one app, and it cannot see a single order.
 * Layer: domain (pure).
 */

import { AppRuleError } from './app';

/**
 * What automation is allowed to do.
 *
 * A closed list rather than a scope string, because the entire value of this
 * token is that its reach is small and obvious. Anything involving a store is
 * absent by construction, not by omission.
 */
export const AUTOMATION_CAPABILITIES = [
  'versions.write',
  'functions.write',
] as const;

export type AutomationCapability = (typeof AUTOMATION_CAPABILITIES)[number];

export interface AutomationToken {
  readonly id: string;
  readonly appId: string;
  readonly partnerId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly capabilities: readonly AutomationCapability[];
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export function assertTokenValid(token: AutomationToken): void {
  if (token.name.trim().length === 0) {
    // The name is how somebody decides which token to revoke after a leak, so
    // "token" is not one.
    throw new AppRuleError('name', 'is required — it is how you identify this token later');
  }
  if (token.capabilities.length === 0) {
    throw new AppRuleError('capabilities', 'a token that can do nothing should not exist');
  }

  const unknown = token.capabilities.filter(
    (capability) => !AUTOMATION_CAPABILITIES.includes(capability),
  );
  if (unknown.length > 0) {
    throw new AppRuleError(
      'capabilities',
      `${unknown.join(', ')} is not something automation can do. Automation deploys; it does ` +
        'not read store data, and there is no capability that would let it.',
    );
  }
}

/**
 * Whether this token may be used right now.
 *
 * Expiry is optional and recommended rather than required. A token with no
 * expiry is a decision somebody should make knowingly — forcing one would mean
 * every long-lived pipeline breaks on a date nobody remembers, and the usual
 * response to that is a token with a ten-year expiry, which is worse than an
 * honest one with none.
 */
export function isUsable(
  token: AutomationToken,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (token.revokedAt !== null) return { ok: false, reason: 'This token was revoked.' };
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'This token has expired.' };
  }
  return { ok: true };
}

export function can(token: AutomationToken, capability: AutomationCapability): boolean {
  return token.capabilities.includes(capability);
}

/**
 * Whether a request path is something automation may touch at all.
 *
 * A second, coarser gate in front of the capability check. The capabilities
 * describe intent; this describes reach, and having both means a route added
 * later is refused by default rather than reachable because nobody thought
 * about it.
 */
export function pathIsAutomatable(pathname: string): boolean {
  return /\/partners\/[^/]+\/(apps\/[^/]+\/(versions|functions)|versions\/[^/]+)/.test(pathname);
}

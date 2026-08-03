/**
 * Core · tenant-context/tenant-mismatch.ts
 * The first critical barrier: the resolved tenant must equal the tenant the token
 * claims. On mismatch we fail hard with a 403 and a critical audit event — never
 * a redirect, never a silent re-scope. A mismatch means either a bug or an
 * attack, and both deserve the same treatment.
 * Layer: core (framework-free).
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

export type MismatchKind = 'tenant' | 'actor' | 'support-session' | 'shard';

export interface TenantMismatchDetails {
  readonly kind: MismatchKind;
  /** What the host or path resolved to. */
  readonly resolved: string | null;
  /** What the credential claimed. */
  readonly claimed: string | null;
  readonly requestId: string;
  readonly userId: UserId | null;
  readonly organizationId: OrganizationId | null;
  readonly storeId: StoreId | null;
}

/**
 * Carries HTTP status so the transport layer stays thin: it maps this to a 403
 * without deciding anything.
 */
export class TenantMismatchError extends Error {
  readonly status = 403;
  readonly details: TenantMismatchDetails;

  constructor(details: TenantMismatchDetails) {
    super(
      `${details.kind} mismatch: resolved "${details.resolved ?? 'none'}" but the credential claimed ` +
        `"${details.claimed ?? 'none'}". Request rejected.`,
    );
    this.name = 'TenantMismatchError';
    this.details = details;
  }
}

/**
 * Compares resolved against claimed and throws on any disagreement. Both being
 * absent is fine (a platform-scoped request); one being absent is not.
 */
export function assertTenantMatches(
  kind: MismatchKind,
  resolved: string | null,
  claimed: string | null,
  context: Omit<TenantMismatchDetails, 'kind' | 'resolved' | 'claimed'>,
): void {
  if (resolved === claimed) return;
  throw new TenantMismatchError({ kind, resolved, claimed, ...context });
}

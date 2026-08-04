/**
 * Auth · contracts/index.ts
 * The only surface other modules may import. Identity is consumed everywhere, so
 * what is published here is deliberately small: read models, never the services
 * or repositories behind them (§14.1).
 * Layer: contracts (pure types).
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

/** How another module sees a user. Credentials are never part of this shape. */
export interface UserSummary {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly locale: string;
  readonly timeZone: string;
}

export interface StoreSummary {
  readonly id: StoreId;
  readonly organizationId: OrganizationId;
  readonly handle: string;
  readonly name: string;
  readonly type: 'live' | 'development' | 'client_transfer' | 'password_protected';
  readonly status: 'active' | 'paused' | 'closed';
  readonly baseCurrency: string;
  readonly timeZone: string;
}

export const AUTH_EVENTS = {
  userCreated: 'auth.user.created',
  tenantCreated: 'auth.tenant.created',
  membershipGranted: 'auth.membership.granted',
  membershipRevoked: 'auth.membership.revoked',
} as const;

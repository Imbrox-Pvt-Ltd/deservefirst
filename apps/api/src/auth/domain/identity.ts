/**
 * Auth · domain/identity.ts
 * The identity model (§4.2), extended to the five-scope structure of ADR 0001 D8.
 * One global User per email; Membership links a user to a store; Organization
 * groups stores; BusinessEntity carries the legal and tax identity a store bills
 * under. Conflating those last two is the mistake this file exists to prevent.
 * Layer: domain (pure).
 */

import type {
  BusinessEntityId,
  OrganizationId,
  PartnerId,
  StoreId,
  StoreStatus,
  StoreType,
  UserId,
} from '@deservefirst/contracts';

/** Global identity. One row per person, never duplicated per store (§11.4). */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly secondaryEmail: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: 'active' | 'suspended' | 'closed';
  readonly mfaEnabled: boolean;
  /** Opaque reference into whichever AuthProvider holds the credential. */
  readonly providerRef: string | null;
  readonly locale: string;
  readonly timeZone: string;
  readonly createdAt: Date;
}

export interface Organization {
  readonly id: OrganizationId;
  readonly name: string;
  /** Forces every member to hold a passkey or TOTP before they can sign in. */
  readonly requireSecureSignIn: boolean;
  readonly createdAt: Date;
}

/**
 * A legal entity, per country. Stores reference one for tax and invoicing.
 * Several stores may share an entity, and an organization may hold many —
 * a business selling in the US and India needs one of each.
 */
export interface BusinessEntity {
  readonly id: BusinessEntityId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly countryCode: string;
  readonly companyType: string | null;
  readonly taxRegistrationId: string | null;
  readonly archivedAt: Date | null;
}

export interface Store {
  readonly id: StoreId;
  readonly organizationId: OrganizationId;
  /** Null until the merchant completes legal details — dev stores never need it. */
  readonly businessEntityId: BusinessEntityId | null;
  readonly handle: string;
  readonly name: string;
  readonly type: StoreType;
  readonly status: StoreStatus;
  readonly defaultLocale: string;
  readonly timeZone: string;
  readonly baseCurrency: string;
  /** Per-store feature previews, e.g. "extended-variants" (§36.2). */
  readonly featurePreviews: readonly string[];
  readonly createdAt: Date;
}

/** Links a User to a Store. Many per user (multi-store) and many per store (staff). */
export interface Membership {
  readonly id: string;
  readonly userId: UserId;
  readonly storeId: StoreId;
  readonly organizationId: OrganizationId;
  readonly status: 'active' | 'pending' | 'revoked';
  readonly invitedBy: UserId | null;
  readonly createdAt: Date;
}

export interface PartnerAccount {
  readonly id: PartnerId;
  readonly ownerUserId: UserId;
  readonly name: string;
  readonly createdAt: Date;
}

export class IdentityRuleError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'IdentityRuleError';
  }
}

/**
 * Normalises an email for storage and comparison. Case-folding the whole address
 * is deliberate: the local part is technically case-sensitive per RFC 5321, but
 * no mail provider treats it that way, and honouring it would let one person
 * register twice and see two different accounts.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertValidEmail(email: string): void {
  if (!EMAIL_PATTERN.test(email.trim())) {
    throw new IdentityRuleError('email', 'is not a valid address');
  }
}

const RESERVED_HANDLES = new Set([
  'admin', 'api', 'accounts', 'partners', 'dev', 'app', 'apps', 'www',
  'store', 'stores', 'settings', 'login', 'logout', 'signup', 'static', 'assets',
]);

/**
 * Store handles live in the URL alongside platform routes, so a store called
 * "settings" would shadow real paths.
 */
export function assertValidStoreHandle(handle: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(handle)) {
    throw new IdentityRuleError(
      'handle',
      'must be 3–63 characters of lowercase letters, digits and hyphens, and may not start or end with a hyphen',
    );
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw new IdentityRuleError('handle', `"${handle}" is reserved by the platform`);
  }
}

/**
 * A store may only reference a business entity from its own organization —
 * otherwise one organization's invoices could be issued under another's legal
 * identity.
 */
export function assertBusinessEntityBelongsToOrganization(
  store: Pick<Store, 'organizationId'>,
  entity: Pick<BusinessEntity, 'organizationId' | 'archivedAt'>,
): void {
  if (entity.organizationId !== store.organizationId) {
    throw new IdentityRuleError('businessEntityId', 'belongs to a different organization');
  }
  if (entity.archivedAt !== null) {
    throw new IdentityRuleError('businessEntityId', 'is archived and cannot be assigned');
  }
}

/** Whether a store may transact. Development stores never can, by design (§11.1). */
export function canTransact(store: Store): { ok: true } | { ok: false; reason: string } {
  if (store.type === 'development') {
    return { ok: false, reason: 'Development stores cannot sell until they are upgraded.' };
  }
  if (store.status !== 'active') {
    return { ok: false, reason: `A ${store.status} store cannot transact.` };
  }
  if (store.businessEntityId === null) {
    return { ok: false, reason: 'Assign a business entity before selling — invoices need a legal entity.' };
  }
  return { ok: true };
}

const STORE_TRANSITIONS: Readonly<Record<StoreType, readonly StoreType[]>> = {
  development: ['live', 'client_transfer'],
  client_transfer: ['live', 'development'],
  live: ['password_protected'],
  password_protected: ['live'],
};

export function assertStoreTypeTransition(from: StoreType, to: StoreType): void {
  if (from === to) return;
  if (!STORE_TRANSITIONS[from].includes(to)) {
    throw new IdentityRuleError('type', `a store cannot move from ${from} to ${to}`);
  }
}

/** Display name, falling back to the email local part rather than showing blank. */
export function displayName(user: Pick<User, 'firstName' | 'lastName' | 'email'>): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return user.email.split('@')[0] ?? user.email;
}

/**
 * Contracts · scope.ts
 * The five-scope actor model (decision D8). The reference product separates
 * person, organization, business entity, store and partner; each has a different
 * owner, a different host, and a different context resolution. Conflating them is
 * the mistake this file exists to prevent.
 * Layer: contracts (pure types, no framework).
 */

/** Opaque identifiers — never interchange them, even though all are strings. */
export type UserId = string & { readonly __brand: 'UserId' };
export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
export type BusinessEntityId = string & { readonly __brand: 'BusinessEntityId' };
export type StoreId = string & { readonly __brand: 'StoreId' };
export type PartnerId = string & { readonly __brand: 'PartnerId' };

/**
 * The canonical tenant boundary is the store. `storeId` is the scoped data
 * boundary; organization is the management and grouping layer above it.
 */
export type ScopeKind = 'person' | 'organization' | 'business-entity' | 'store' | 'partner';

/**
 * A store's lifecycle type. `client_transfer` is a store a partner built and is
 * handing to a merchant; `development` cannot transact until upgraded — lazy
 * provisioning depends on this distinction (§11.1).
 */
export type StoreType = 'live' | 'development' | 'client_transfer' | 'password_protected';

export type StoreStatus = 'active' | 'paused' | 'closed';

/**
 * A legal entity per country, owning tax and invoicing identity. Sits between
 * organization and store; several stores may share one.
 */
export interface BusinessEntity {
  readonly id: BusinessEntityId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly countryCode: string;
  readonly companyType: string | null;
  readonly archivedAt: Date | null;
}

/**
 * How the current actor reached this store. A support actor is never a member;
 * it holds a time-bound session with an explicit, wildcard-free permission list.
 */
export type AccessType = 'member' | 'collaborator' | 'partner' | 'support' | 'platform';

export type ActorType = 'user' | 'app' | 'system';

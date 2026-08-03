/**
 * Contracts · request-context.ts
 * The immutable per-request context (§5.1). Resolved once at the gateway and
 * propagated everywhere; nothing may ask "who is this tenant" twice, and no
 * store-scoped operation may proceed without it.
 * Layer: contracts (pure types, no framework).
 */
import type { AccessType, ActorType, BusinessEntityId, OrganizationId, PartnerId, StoreId, UserId } from './scope';
/**
 * Resolution rules, adopted verbatim from the frozen contracts baseline:
 * - no store-scoped request may continue without an active store context
 * - a request-supplied store identifier must match the active context exactly
 * - workers and internal execution flows carry the same storeId
 * - platform-only surfaces may omit storeId but must still carry requestId
 */
export interface RequestContext {
    readonly requestId: string;
    readonly correlationId: string;
    readonly actorType: ActorType;
    readonly userId: UserId | null;
    readonly organizationId: OrganizationId | null;
    readonly businessEntityId: BusinessEntityId | null;
    readonly storeId: StoreId | null;
    readonly partnerId: PartnerId | null;
    readonly accessType: AccessType;
    readonly roleKeys: readonly string[];
    /** Effective permissions, already aggregated across every assigned role. */
    readonly permissions: readonly string[];
    /** Present only for time-bound support access; forces extra audit on every read. */
    readonly supportSessionId: string | null;
    /** Hash of the entitlement set, carried in the access token to short-circuit lookups. */
    readonly entitlementsHash: string | null;
    readonly locale: string;
    readonly timeZone: string;
    /** Which shard this store lives on; resolved once, reused for every connection. */
    readonly shardKey: string | null;
}
/** A context that is guaranteed to be store-scoped. */
export type StoreRequestContext = RequestContext & {
    readonly storeId: StoreId;
};
export declare function isStoreScoped(context: RequestContext): context is StoreRequestContext;
/**
 * Storage keys must always carry a store prefix — an unscoped artifact root is a
 * cross-tenant leak waiting to happen.
 */
export declare function storagePrefix(storeId: StoreId): string;
/** Cache keys are store-scoped, or explicitly platform-scoped. Never neither. */
export declare function storeCacheKey(storeId: StoreId, ...segments: readonly string[]): string;
export declare function platformCacheKey(...segments: readonly string[]): string;
//# sourceMappingURL=request-context.d.ts.map
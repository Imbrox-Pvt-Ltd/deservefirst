"use strict";
/**
 * Contracts · request-context.ts
 * The immutable per-request context (§5.1). Resolved once at the gateway and
 * propagated everywhere; nothing may ask "who is this tenant" twice, and no
 * store-scoped operation may proceed without it.
 * Layer: contracts (pure types, no framework).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStoreScoped = isStoreScoped;
exports.storagePrefix = storagePrefix;
exports.storeCacheKey = storeCacheKey;
exports.platformCacheKey = platformCacheKey;
function isStoreScoped(context) {
    return context.storeId !== null;
}
/**
 * Storage keys must always carry a store prefix — an unscoped artifact root is a
 * cross-tenant leak waiting to happen.
 */
function storagePrefix(storeId) {
    return `store-${storeId}`;
}
/** Cache keys are store-scoped, or explicitly platform-scoped. Never neither. */
function storeCacheKey(storeId, ...segments) {
    return ['store', storeId, ...segments].join(':');
}
function platformCacheKey(...segments) {
    return ['platform', ...segments].join(':');
}
//# sourceMappingURL=request-context.js.map
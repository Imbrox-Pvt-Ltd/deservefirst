"use strict";
/**
 * Contracts · events.ts
 * The event standard (§14.4). Every event is a typed, versioned schema published
 * in a module's contracts; backward-compatible changes only within a version, and
 * a breaking change means a new version plus an upcaster so old consumers keep
 * working. Fitness-checked.
 * Layer: contracts (pure, no framework).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_TYPE_PATTERN = void 0;
exports.isValidEventType = isValidEventType;
/** Name shape: `{context}.{aggregate}.{pastTenseVerb}` — catalog.product.published. */
exports.EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
function isValidEventType(type) {
    return exports.EVENT_TYPE_PATTERN.test(type);
}
//# sourceMappingURL=events.js.map
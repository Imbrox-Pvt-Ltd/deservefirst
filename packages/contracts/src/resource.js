"use strict";
/**
 * Contracts · resource.ts
 * The one-resource-definition contract (§13.2). An entity is declared once —
 * fields, relations, filterable/sortable columns, permissions, visibility — and
 * from it the platform derives the GraphQL type, the REST serializer, the list
 * and search engine, and the admin screens. Declared once, so the surfaces
 * cannot drift.
 * Layer: contracts (pure types, no framework).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGlobalId = buildGlobalId;
exports.parseGlobalId = parseGlobalId;
/** Global id format: gid://{platformSlug}/{Entity}/{id} (§12.1). */
function buildGlobalId(platformSlug, entity, id) {
    return `gid://${platformSlug}/${entity}/${id}`;
}
function parseGlobalId(gid) {
    const match = /^gid:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(gid);
    if (!match)
        return null;
    const [, platformSlug, entity, id] = match;
    if (!platformSlug || !entity || !id)
        return null;
    return { platformSlug, entity, id };
}
//# sourceMappingURL=resource.js.map
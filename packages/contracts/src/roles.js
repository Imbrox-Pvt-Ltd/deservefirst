"use strict";
/**
 * Contracts · roles.ts
 * The role model. Extends the spec's flat `Role.permissions[]` (§4.2) with the
 * three things the reference product has and we lacked: a role *category* that
 * decides which permission tree is available, an aggregated permission summary
 * across all assigned roles, and an approval primitive.
 * Layer: contracts (pure types, no framework).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizePermissions = summarizePermissions;
function summarizePermissions(userId, roles, assignments) {
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const accumulated = new Map();
    for (const assignment of assignments) {
        if (assignment.userId !== userId)
            continue;
        const role = rolesById.get(assignment.roleId);
        if (!role)
            continue;
        for (const permission of role.permissions) {
            const key = `${permission}@${assignment.storeId ?? 'all'}`;
            const existing = accumulated.get(key);
            if (existing) {
                existing.grantedBy.add(role.name);
            }
            else {
                accumulated.set(key, {
                    grantedBy: new Set([role.name]),
                    storeScope: assignment.storeId ?? 'all',
                });
            }
        }
    }
    return {
        userId,
        entries: [...accumulated.entries()].map(([key, value]) => ({
            permission: key.slice(0, key.lastIndexOf('@')),
            grantedBy: [...value.grantedBy].sort(),
            storeScope: value.storeScope,
        })),
    };
}
//# sourceMappingURL=roles.js.map
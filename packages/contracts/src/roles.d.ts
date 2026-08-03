/**
 * Contracts · roles.ts
 * The role model. Extends the spec's flat `Role.permissions[]` (§4.2) with the
 * three things the reference product has and we lacked: a role *category* that
 * decides which permission tree is available, an aggregated permission summary
 * across all assigned roles, and an approval primitive.
 * Layer: contracts (pure types, no framework).
 */
import type { OrganizationId, StoreId, UserId } from './scope';
/**
 * The category determines which permissions may be granted at all — an
 * organization role and a point-of-sale role draw from different trees.
 */
export type RoleCategory = 'organization' | 'store' | 'point-of-sale' | 'partner';
export interface PermissionGroup {
    readonly key: string;
    readonly label: string;
    readonly category: RoleCategory;
    readonly permissions: readonly string[];
}
export interface Role {
    readonly id: string;
    readonly organizationId: OrganizationId | null;
    readonly storeId: StoreId | null;
    readonly category: RoleCategory;
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    /** System roles ship with the platform and cannot be edited or deleted. */
    readonly system: boolean;
    /**
     * Lets a holder approve another actor's gated action by re-authenticating —
     * the manager-approval pattern from the reference POS role.
     */
    readonly grantsApproval: boolean;
}
export interface RoleAssignment {
    readonly userId: UserId;
    readonly roleId: string;
    /** Null means the role applies to every store in the organization. */
    readonly storeId: StoreId | null;
    readonly assignedAt: Date;
}
/**
 * The aggregate view shown on a user's detail screen: every permission the user
 * effectively holds, and which role granted it. Computed, never stored.
 */
export interface PermissionSummary {
    readonly userId: UserId;
    readonly entries: readonly {
        readonly permission: string;
        readonly grantedBy: readonly string[];
        readonly storeScope: StoreId | 'all';
    }[];
}
export declare function summarizePermissions(userId: UserId, roles: readonly Role[], assignments: readonly RoleAssignment[]): PermissionSummary;
/**
 * An action that requires a second authorised actor to approve before it
 * proceeds. Approval is a first-class primitive, not an `if` in a service.
 */
export interface ApprovalRequest {
    readonly id: string;
    readonly storeId: StoreId;
    readonly requestedBy: UserId;
    readonly action: string;
    readonly permission: string;
    readonly requestedAt: Date;
    readonly approvedBy: UserId | null;
    readonly approvedAt: Date | null;
    readonly expiresAt: Date;
}
//# sourceMappingURL=roles.d.ts.map
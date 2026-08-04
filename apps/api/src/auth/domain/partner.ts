/**
 * Auth · domain/partner.ts
 * The partner account: an agency that works on other people's stores.
 *
 * A partner is a top-level actor, NOT a flag on an organization, and the
 * difference is the whole design. An organization owns its stores — its data is
 * its own, and an admin of it can do anything to it. A partner owns none of the
 * stores it works in. Its access to each one is granted by that store's owner,
 * scoped, and revocable by the owner alone. Modelling that as "an organization
 * with a checkbox" would put a partner's staff inside the owner's permission
 * system, where the owner's grant and the partner's own roles become the same
 * mechanism — and then revoking a partner means editing the partner's roles,
 * which the partner can also edit.
 *
 * So there are two independent gates, and both must open:
 *   1. the LINK — the store owner said this partner may work here, at this level
 *   2. the ROLE — the partner said this staff member may do this kind of work
 * Neither can substitute for the other. A partner cannot widen a link, and a
 * store owner cannot reach inside a partner's staff list.
 * Layer: domain (pure).
 */

import type { PartnerId, StoreId, UserId } from '@deservefirst/contracts';

import { IdentityRuleError } from './identity';

export type PartnerStatus = 'active' | 'suspended' | 'closed';

/** What a partner may do in one client store, as that store's owner set it. */
export type PartnerAccessLevel = 'full' | 'limited';

/**
 * Where the link stands.
 *
 * `pending` is the default and it matters: a partner asks, and until the store
 * owner answers there is no access at all. There is no state in which a partner
 * has arranged its own way in.
 */
export type PartnerLinkStatus = 'pending' | 'active' | 'revoked';

/** What a member of the partner's own staff may do, inside the partner. */
export type PartnerRole = 'owner' | 'admin' | 'member';

export interface Partner {
  readonly id: PartnerId;
  readonly ownerUserId: UserId;
  readonly name: string;
  readonly status: PartnerStatus;
  /** For payouts and referral attribution; absent until they are set up. */
  readonly payoutCurrency: string | null;
  readonly websiteUrl: string | null;
  readonly version: number;
}

export interface PartnerStaff {
  readonly id: string;
  readonly userId: UserId;
  readonly role: PartnerRole;
  readonly status: 'active' | 'invited' | 'removed';
}

export interface PartnerStoreLink {
  readonly id: string;
  readonly storeId: StoreId;
  readonly status: PartnerLinkStatus;
  readonly accessLevel: PartnerAccessLevel;
  /**
   * Meaningful only at `limited`. Empty at `full`, where the level is the
   * grant — storing a snapshot of "everything" there would go stale the moment
   * a new permission is declared, quietly withholding it from a partner the
   * owner had given full access to.
   */
  readonly permissions: readonly string[];
  /**
   * True when the partner created this store, false when a merchant let them in.
   *
   * A development store a partner made is theirs to work in without asking
   * anybody. The moment it is transferred to a client it stops being theirs, and
   * this flips — which is what makes transfer a real boundary rather than a
   * label.
   */
  readonly createdByPartner: boolean;
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly revokedReason: string | null;
}

// --- the partner itself ------------------------------------------------------

export function assertPartnerValid(partner: Partner): void {
  if (partner.name.trim().length === 0) {
    throw new IdentityRuleError('name', 'is required');
  }
  if (partner.payoutCurrency !== null && !/^[A-Z]{3}$/.test(partner.payoutCurrency)) {
    throw new IdentityRuleError('payoutCurrency', 'must be a three-letter ISO currency code');
  }
  if (partner.websiteUrl !== null) {
    try {
      const parsed = new URL(partner.websiteUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new IdentityRuleError('websiteUrl', 'must be an http or https URL');
      }
    } catch (error) {
      if (error instanceof IdentityRuleError) throw error;
      throw new IdentityRuleError('websiteUrl', 'must be an absolute URL');
    }
  }
}

/**
 * The owner is always active staff.
 *
 * Checked rather than assumed because the alternative failure is silent and
 * total: an owner who is not on the staff list has no role, so every permission
 * check against them fails, and the one person who could fix it is the person
 * locked out.
 */
export function assertOwnerIsStaff(partner: Partner, staff: readonly PartnerStaff[]): void {
  const owner = staff.find((member) => member.userId === partner.ownerUserId);
  if (!owner) {
    throw new IdentityRuleError('ownerUserId', 'the owner must be a member of the partner');
  }
  if (owner.role !== 'owner') {
    throw new IdentityRuleError('ownerUserId', 'the owner must hold the owner role');
  }
  if (owner.status !== 'active') {
    throw new IdentityRuleError('ownerUserId', 'the owner cannot be removed or left invited');
  }
}

export function assertStaffValid(staff: readonly PartnerStaff[]): void {
  const owners = staff.filter((member) => member.role === 'owner' && member.status !== 'removed');
  if (owners.length > 1) {
    throw new IdentityRuleError('role', 'a partner can only have one owner');
  }

  const seen = new Set<string>();
  for (const member of staff) {
    if (member.status === 'removed') continue;
    if (seen.has(member.userId)) {
      throw new IdentityRuleError('userId', 'the same person is listed twice');
    }
    seen.add(member.userId);
  }
}

/** Removing the owner is refused; ownership transfers, it does not vacate. */
export function assertCanRemoveStaff(partner: Partner, member: PartnerStaff): void {
  if (member.userId === partner.ownerUserId) {
    throw new IdentityRuleError(
      'userId',
      'the owner cannot be removed — transfer ownership first',
    );
  }
}

// --- the link to a client store ----------------------------------------------

const LINK_TRANSITIONS: Record<PartnerLinkStatus, readonly PartnerLinkStatus[]> = {
  // Revoked is terminal on purpose. A merchant who removed a partner and later
  // wants them back grants a NEW link with a level chosen now — rather than an
  // old grant, made under forgotten circumstances, springing back to life.
  pending: ['active', 'revoked'],
  active: ['revoked'],
  revoked: [],
};

export function assertLinkTransition(from: PartnerLinkStatus, to: PartnerLinkStatus): void {
  if (from === to) return;
  if (!LINK_TRANSITIONS[from].includes(to)) {
    throw new IdentityRuleError('status', `a partner link cannot go from ${from} to ${to}`);
  }
}

export function assertLinkValid(link: PartnerStoreLink): void {
  // Only an ACTIVE link is a grant. A pending one is a request, and a request
  // with nothing filled in is exactly what a partner asking for access looks
  // like before the owner has decided what to give them.
  if (link.status === 'active' && link.accessLevel === 'limited' && link.permissions.length === 0) {
    throw new IdentityRuleError(
      'permissions',
      'limited access with no permissions grants nothing — remove the partner instead',
    );
  }
  if (link.accessLevel === 'full' && link.permissions.length > 0) {
    throw new IdentityRuleError(
      'permissions',
      'full access is the grant; listing permissions alongside it would go stale',
    );
  }
  if (link.status === 'revoked' && link.revokedReason === null) {
    throw new IdentityRuleError('revokedReason', 'a revoked link must say why');
  }
}

/**
 * Whether this link lets the partner in at all.
 *
 * A store the partner created is open to them without a decision, which is what
 * makes development stores usable. Everything else waits for the owner.
 */
export function linkGrantsAccess(link: PartnerStoreLink): boolean {
  if (link.status === 'revoked') return false;
  if (link.createdByPartner) return true;
  return link.status === 'active';
}

/**
 * What a partner staff member may actually do in one client store.
 *
 * The intersection of the two gates, and the order is deliberate: the store
 * owner's grant is the ceiling, and the partner's own role can only narrow it.
 * Computing it the other way round — the partner's role widened by the link —
 * would let a partner admin reach past what the merchant agreed to.
 */
export function effectiveStorePermissions(
  link: PartnerStoreLink,
  member: PartnerStaff,
  /** Everything the partner's role would allow, were the link unrestricted. */
  roleGrants: readonly string[],
): readonly string[] {
  if (!linkGrantsAccess(link)) return [];
  if (member.status !== 'active') return [];

  if (link.accessLevel === 'full') return [...roleGrants];

  const ceiling = new Set(link.permissions);
  return roleGrants.filter((permission) => ceiling.has(permission));
}

/**
 * What a partner's own role lets them do inside a CLIENT store.
 *
 * A separate namespace from the partner's internal permissions, and conflating
 * the two is an easy and total mistake: `partner.staff.manage` and
 * `catalog.products.write` never intersect, so intersecting them yields an
 * empty set and every partner silently loses all access.
 *
 * Owners and admins carry whatever the merchant granted. A member is read-only
 * regardless — the junior seat is for looking at a client's store, and widening
 * it is a decision the partner makes by changing their role, in the open.
 */
export function narrowByPartnerRole(
  role: PartnerRole,
  storePermissions: readonly string[],
): readonly string[] {
  if (role === 'member') {
    return storePermissions.filter((permission) => permission.endsWith('.read'));
  }
  return [...storePermissions];
}

/**
 * Whether a partner may transfer a store to a client.
 *
 * Only a store they made, and only while the link is theirs by construction —
 * transferring a store somebody else owns is not a transfer, it is a giveaway
 * of somebody else's property.
 */
export function canTransferStore(
  link: PartnerStoreLink,
  member: PartnerStaff,
): { ok: true } | { ok: false; reason: string } {
  if (!link.createdByPartner) {
    return { ok: false, reason: 'This store was not created by the partner.' };
  }
  if (link.status === 'revoked') {
    return { ok: false, reason: 'The partner no longer has access to this store.' };
  }
  if (member.role === 'member') {
    return { ok: false, reason: 'Only a partner admin or owner can transfer a store.' };
  }
  return { ok: true };
}

/**
 * The link after a store is transferred to a client.
 *
 * It does not survive as-is. The partner keeps access only as an ordinary
 * collaborator would — pending the new owner's decision — because the reason
 * they had it without asking was that the store was theirs, and it no longer is.
 */
export function afterTransfer(link: PartnerStoreLink, at: Date): PartnerStoreLink {
  return {
    ...link,
    createdByPartner: false,
    status: 'pending',
    accessLevel: 'limited',
    permissions: [],
    requestedAt: at,
    decidedAt: null,
  };
}

/**
 * Auth · application/partner-service.ts
 * The partner use cases, and the one place both gates are checked together.
 *
 * Every method here takes the acting user rather than trusting a caller to have
 * checked. The reason is that the two sides of this feature are used by
 * different people through different screens — a partner asks from the partner
 * dashboard, a merchant answers from their store's settings — and a check that
 * lives in a screen is a check that exists once per screen.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import type { PartnerId, StoreId, UserId } from '@deservefirst/contracts';

import { IdentityRuleError } from '../domain/identity';
import {
  afterTransfer,
  assertCanRemoveStaff,
  assertLinkTransition,
  assertLinkValid,
  assertOwnerIsStaff,
  assertPartnerValid,
  assertStaffValid,
  canTransferStore,
  effectiveStorePermissions,
  linkGrantsAccess,
  narrowByPartnerRole,
  type Partner,
  type PartnerAccessLevel,
  type PartnerRole,
  type PartnerStaff,
  type PartnerStoreLink,
} from '../domain/partner';
import type { SqlPartnerRepository } from '../infrastructure/partner.repository';

export class PartnerConflictError extends Error {
  readonly status = 409;
  constructor(detail: string) {
    super(detail);
    this.name = 'PartnerConflictError';
  }
}

export class PartnerAccessError extends Error {
  readonly status = 403;
  constructor(detail: string) {
    super(detail);
    this.name = 'PartnerAccessError';
  }
}

export interface PartnerServicePorts {
  readonly partners: SqlPartnerRepository;
  readonly publish: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  /**
   * Every store permission the installed modules declare.
   *
   * Injected rather than listed here because `full` access means "everything
   * this store has", and a list written down in the auth module would silently
   * withhold each new permission a module adds — the merchant would have granted
   * full access and the partner would quietly not have it.
   */
  readonly allStorePermissions: () => readonly string[];
  readonly now?: () => Date;
}

/**
 * What each partner role may do INSIDE THE PARTNER — its own account, staff and
 * client list. Not to be confused with what they may do inside a client's store,
 * which is a different namespace entirely; see `narrowByPartnerRole`.
 */
const ROLE_GRANTS: Record<PartnerRole, readonly string[]> = {
  owner: [
    'partner.read',
    'partner.manage',
    'partner.staff.manage',
    'partner.stores.request',
    'partner.stores.create',
  ],
  admin: ['partner.read', 'partner.stores.request', 'partner.stores.create'],
  member: ['partner.read'],
};

export class PartnerService {
  constructor(private readonly ports: PartnerServicePorts) {}

  private now(): Date {
    return this.ports.now?.() ?? new Date();
  }

  /** The acting user's seat at this partner, or a 403. */
  private async seat(partnerId: PartnerId, userId: UserId): Promise<PartnerStaff> {
    const staff = await this.ports.partners.staffFor(partnerId);
    const member = staff.find((entry) => entry.userId === userId && entry.status === 'active');
    if (!member) {
      // Deliberately the same message whether the partner does not exist or the
      // caller simply is not on it: distinguishing them tells a stranger which
      // partner ids are real.
      throw new PartnerAccessError('You do not have access to this partner.');
    }
    return member;
  }

  private assertCan(member: PartnerStaff, permission: string): void {
    if (!ROLE_GRANTS[member.role].includes(permission)) {
      throw new PartnerAccessError(`Your role at this partner cannot ${permission}.`);
    }
  }

  async create(input: {
    ownerUserId: UserId;
    name: string;
    payoutCurrency?: string | null;
    websiteUrl?: string | null;
  }): Promise<Partner> {
    const partner: Partner = {
      id: randomUUID() as PartnerId,
      ownerUserId: input.ownerUserId,
      name: input.name.trim(),
      status: 'active',
      payoutCurrency: input.payoutCurrency ?? null,
      websiteUrl: input.websiteUrl ?? null,
      version: 1,
    };
    assertPartnerValid(partner);

    await this.ports.partners.insert(partner);
    // The owner's seat is created in the same call, never left to a later step:
    // a partner whose owner is not staff is a partner nobody can administer.
    await this.ports.partners.insertStaff(partner.id, {
      id: randomUUID(),
      userId: input.ownerUserId,
      role: 'owner',
      status: 'active',
    });

    await this.ports.publish({
      type: 'auth.partner.created',
      payload: { partnerId: partner.id, name: partner.name },
    });
    return partner;
  }

  async get(partnerId: PartnerId, actingUserId: UserId): Promise<Partner> {
    await this.seat(partnerId, actingUserId);
    const partner = await this.ports.partners.findById(partnerId);
    if (!partner) throw new PartnerAccessError('You do not have access to this partner.');
    return partner;
  }

  async update(
    partnerId: PartnerId,
    actingUserId: UserId,
    changes: { name?: string; payoutCurrency?: string | null; websiteUrl?: string | null; version: number },
  ): Promise<Partner> {
    const member = await this.seat(partnerId, actingUserId);
    this.assertCan(member, 'partner.manage');

    const current = await this.ports.partners.findById(partnerId);
    if (!current) throw new PartnerAccessError('You do not have access to this partner.');

    const next: Partner = {
      ...current,
      name: changes.name?.trim() ?? current.name,
      payoutCurrency:
        changes.payoutCurrency === undefined ? current.payoutCurrency : changes.payoutCurrency,
      websiteUrl: changes.websiteUrl === undefined ? current.websiteUrl : changes.websiteUrl,
      version: changes.version,
    };
    assertPartnerValid(next);

    if (!(await this.ports.partners.update(next))) {
      throw new PartnerConflictError('This partner changed since you loaded it. Reload and retry.');
    }
    return { ...next, version: next.version + 1 };
  }

  // --- staff -----------------------------------------------------------------

  async staff(partnerId: PartnerId, actingUserId: UserId): Promise<readonly PartnerStaff[]> {
    await this.seat(partnerId, actingUserId);
    return this.ports.partners.staffFor(partnerId);
  }

  async inviteStaff(
    partnerId: PartnerId,
    actingUserId: UserId,
    input: { userId: UserId; role: PartnerRole },
  ): Promise<PartnerStaff> {
    const member = await this.seat(partnerId, actingUserId);
    this.assertCan(member, 'partner.staff.manage');
    if (input.role === 'owner') {
      throw new IdentityRuleError('role', 'ownership is transferred, not invited');
    }

    const invited: PartnerStaff = {
      id: randomUUID(),
      userId: input.userId,
      role: input.role,
      status: 'invited',
    };

    const existing = await this.ports.partners.staffFor(partnerId);
    assertStaffValid([...existing, invited]);
    await this.ports.partners.insertStaff(partnerId, invited);
    return invited;
  }

  async removeStaff(partnerId: PartnerId, actingUserId: UserId, staffId: string): Promise<void> {
    const member = await this.seat(partnerId, actingUserId);
    this.assertCan(member, 'partner.staff.manage');

    const partner = await this.ports.partners.findById(partnerId);
    if (!partner) throw new PartnerAccessError('You do not have access to this partner.');

    const target = (await this.ports.partners.staffFor(partnerId)).find((entry) => entry.id === staffId);
    if (!target) throw new IdentityRuleError('staffId', 'is not a member of this partner');

    assertCanRemoveStaff(partner, target);
    await this.ports.partners.saveStaff({ ...target, status: 'removed' });
  }

  // --- the partner's side of the gate ---------------------------------------

  async stores(partnerId: PartnerId, actingUserId: UserId): Promise<readonly PartnerStoreLink[]> {
    await this.seat(partnerId, actingUserId);
    return this.ports.partners.linksFor(partnerId);
  }

  /**
   * Asks a merchant for access. Creates a request, never a grant.
   *
   * The requested access level is recorded but not honoured until the owner
   * decides — a partner asking for `full` gets `full` only if the merchant says
   * so, and the merchant may answer with something narrower.
   */
  async requestStoreAccess(
    partnerId: PartnerId,
    actingUserId: UserId,
    input: { storeId: StoreId; accessLevel: PartnerAccessLevel; permissions?: readonly string[] },
  ): Promise<PartnerStoreLink> {
    const member = await this.seat(partnerId, actingUserId);
    this.assertCan(member, 'partner.stores.request');

    const existing = await this.ports.partners.findLink(partnerId, input.storeId);
    if (existing && existing.status !== 'revoked') {
      throw new PartnerConflictError(
        existing.status === 'active'
          ? 'This partner already has access to that store.'
          : 'A request for that store is already waiting for the owner.',
      );
    }
    if (existing) {
      // Revoked is terminal, so a fresh ask cannot reuse the old row — that is
      // exactly the resurrection the transition rule exists to prevent.
      throw new PartnerConflictError(
        'The owner removed this partner from that store. They must re-invite the partner.',
      );
    }

    const link: PartnerStoreLink = {
      id: randomUUID(),
      storeId: input.storeId,
      status: 'pending',
      accessLevel: input.accessLevel,
      permissions: input.accessLevel === 'limited' ? [...(input.permissions ?? [])] : [],
      createdByPartner: false,
      requestedAt: this.now(),
      decidedAt: null,
      revokedReason: null,
    };
    assertLinkValid(link);

    await this.ports.partners.insertLink(partnerId, link);
    await this.ports.publish({
      type: 'auth.partner-access.requested',
      payload: { partnerId, storeId: input.storeId, accessLevel: input.accessLevel },
    });
    return link;
  }

  /**
   * Records a store the partner created. Access is theirs by construction.
   *
   * Called by store creation, not exposed on its own: a partner that could
   * declare "I made this one" about an arbitrary store would have found a way
   * around the approval it exists to require.
   */
  async recordCreatedStore(partnerId: PartnerId, storeId: StoreId): Promise<PartnerStoreLink> {
    const at = this.now();
    const link: PartnerStoreLink = {
      id: randomUUID(),
      storeId,
      status: 'active',
      accessLevel: 'full',
      permissions: [],
      createdByPartner: true,
      requestedAt: at,
      decidedAt: at,
      revokedReason: null,
    };
    assertLinkValid(link);
    await this.ports.partners.insertLink(partnerId, link);
    return link;
  }

  async transferStore(
    partnerId: PartnerId,
    actingUserId: UserId,
    storeId: StoreId,
  ): Promise<PartnerStoreLink> {
    const member = await this.seat(partnerId, actingUserId);

    const link = await this.ports.partners.findLink(partnerId, storeId);
    if (!link) throw new IdentityRuleError('storeId', 'this partner has no link to that store');

    const verdict = canTransferStore(link, member);
    if (!verdict.ok) throw new PartnerAccessError(verdict.reason);

    const next = afterTransfer(link, this.now());
    await this.ports.partners.saveLink(next);
    await this.ports.publish({
      type: 'auth.store.transferred',
      payload: { partnerId, storeId },
    });
    return next;
  }

  // --- the merchant's side of the gate --------------------------------------

  /** Everyone asking for, or holding, access to this store. */
  async partnersForStore(storeId: StoreId) {
    return this.ports.partners.linksForStore(storeId);
  }

  /**
   * The store owner answers. This is the only path that turns a request into
   * access, and it takes the level from the OWNER's decision rather than the
   * partner's request.
   */
  async decideStoreAccess(
    storeId: StoreId,
    linkId: string,
    decision: { grant: boolean; accessLevel?: PartnerAccessLevel; permissions?: readonly string[]; reason?: string },
  ): Promise<PartnerStoreLink> {
    const found = await this.ports.partners.findLinkById(linkId);
    if (!found) throw new IdentityRuleError('linkId', 'is not a partner request for this store');
    // Checked rather than assumed: the link id arrives from a URL, and a store's
    // staff must not be able to answer another store's request by guessing one.
    if (found.link.storeId !== storeId) {
      throw new IdentityRuleError('linkId', 'is not a partner request for this store');
    }

    const at = this.now();
    const target = decision.grant ? 'active' : 'revoked';
    assertLinkTransition(found.link.status, target);

    const accessLevel = decision.accessLevel ?? found.link.accessLevel;
    const next: PartnerStoreLink = {
      ...found.link,
      status: target,
      accessLevel,
      permissions: accessLevel === 'limited' ? [...(decision.permissions ?? found.link.permissions)] : [],
      decidedAt: at,
      revokedReason: decision.grant ? null : (decision.reason?.trim() || 'Access removed by the store.'),
    };
    assertLinkValid(next);

    await this.ports.partners.saveLink(next);
    await this.ports.publish({
      type: decision.grant ? 'auth.partner-access.granted' : 'auth.partner-access.revoked',
      payload: { partnerId: found.partnerId, storeId, accessLevel: next.accessLevel },
    });
    return next;
  }

  // --- resolution, for the request context ----------------------------------

  /**
   * What this user may do in this store AS partner staff, or null if they are
   * not acting as a partner here at all.
   *
   * Returns null rather than an empty list for "not a partner", because the two
   * mean different things to a caller: no partner standing falls through to
   * ordinary membership, whereas partner standing with nothing granted is a
   * refusal that must not fall through to anything.
   */
  async partnerAccessTo(
    userId: UserId,
    storeId: StoreId,
  ): Promise<{ partnerId: PartnerId; permissions: readonly string[] } | null> {
    const partners = await this.ports.partners.partnersFor(userId);

    for (const { partner, member } of partners) {
      if (partner.status !== 'active') continue;

      const link = await this.ports.partners.findLink(partner.id, storeId);
      if (!link || !linkGrantsAccess(link)) continue;

      // The store's permissions, narrowed by the partner's own role, then
      // capped by what the merchant actually granted. Both gates, in that order.
      const roleCeiling = narrowByPartnerRole(member.role, this.ports.allStorePermissions());

      return {
        partnerId: partner.id,
        permissions: effectiveStorePermissions(link, member, roleCeiling),
      };
    }

    return null;
  }

  /** Every partner this user works for, for the dashboard's account picker. */
  async partnersFor(userId: UserId) {
    return this.ports.partners.partnersFor(userId);
  }
}

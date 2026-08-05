/**
 * Auth · application/store-provisioning.ts
 * Making a store.
 *
 * `stores.create` has been declared since the auth module was written and
 * nothing ever called it — every store in existence came from the seed. That is
 * why the partner flow could not be finished: `recordCreatedStore` and
 * `transferStore` were both written, and a partner had no way to make the store
 * either of them talks about.
 *
 * Four things happen together here, and the order is the design. The store row,
 * the creator's membership, the partner link when a partner made it, and the
 * event that tells every other module a store now exists. Leave any one out and
 * the store is real but unreachable, or reachable but unfurnished.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import type { OrganizationId, StoreId, StoreType, UserId } from '@deservefirst/contracts';

import { IdentityRuleError, assertValidStoreHandle, type Store } from '../domain/identity';

/**
 * What a store can be created as.
 *
 * `client_transfer` is deliberately absent: it is a state a development store
 * ENTERS when a partner hands it over, not something anybody creates. Offering
 * it here would let somebody make a store that is permanently mid-handover.
 */
export type CreatableStoreType = Extract<StoreType, 'live' | 'development'>;

export interface StoreProvisioningPorts {
  readonly identity: {
    createStore(store: Store): Promise<Store>;
    createMembership(membership: {
      id: string;
      userId: UserId;
      storeId: StoreId;
      organizationId: OrganizationId;
      status: 'active' | 'pending' | 'revoked';
      invitedBy: UserId | null;
      createdAt: Date;
    }): Promise<unknown>;
    takenStoreHandles(handle: string): Promise<readonly string[]>;
  };
  /** Records that a partner built this one, so it is theirs without asking. */
  readonly recordPartnerStore: (partnerId: string, storeId: StoreId) => Promise<void>;
  readonly publish: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  readonly now?: () => Date;
}

export class StoreProvisioningService {
  constructor(private readonly ports: StoreProvisioningPorts) {}

  private now(): Date {
    return this.ports.now?.() ?? new Date();
  }

  async create(input: {
    organizationId: OrganizationId;
    createdByUserId: UserId;
    handle: string;
    name: string;
    type: CreatableStoreType;
    baseCurrency?: string;
    timeZone?: string;
    /** Set when a partner is building it, which makes the store theirs. */
    partnerId?: string | null;
  }): Promise<Store> {
    const handle = input.handle.trim().toLowerCase();
    assertValidStoreHandle(handle);

    if (input.name.trim().length === 0) {
      throw new IdentityRuleError('name', 'is required');
    }

    // Checked before the insert so the answer is "that address is taken"
    // rather than a unique-constraint error naming a column. The handle is the
    // store's URL, so it is the first thing a merchant cares about.
    const taken = await this.ports.identity.takenStoreHandles(handle);
    if (taken.includes(handle)) {
      throw new IdentityRuleError('handle', `"${handle}" is already taken`);
    }

    const at = this.now();
    const store: Store = {
      id: randomUUID() as StoreId,
      organizationId: input.organizationId,
      businessEntityId: null,
      handle,
      name: input.name.trim(),
      type: input.type,
      status: 'active',
      defaultLocale: 'en-US',
      timeZone: input.timeZone ?? 'UTC',
      baseCurrency: input.baseCurrency ?? 'USD',
      featurePreviews: [],
      createdAt: at,
    };

    await this.ports.identity.createStore(store);

    /**
     * The creator's membership, in the same call.
     *
     * A store nobody is a member of cannot be opened by anybody, including the
     * person who just made it — and the screen that would fix that is inside
     * the store.
     */
    await this.ports.identity.createMembership({
      id: randomUUID(),
      userId: input.createdByUserId,
      storeId: store.id,
      organizationId: input.organizationId,
      status: 'active',
      invitedBy: null,
      createdAt: at,
    });

    if (input.partnerId) {
      // A store the partner built is theirs without the approval an ordinary
      // client store needs — see `linkGrantsAccess`.
      await this.ports.recordPartnerStore(input.partnerId, store.id);
    }

    /**
     * Emitted last, once the store is genuinely usable.
     *
     * Core seeds defaults and modules react to this. Publishing before the
     * membership exists would have subscribers running against a store its own
     * creator cannot yet open.
     */
    await this.ports.publish({
      type: 'auth.tenant.created',
      payload: {
        storeId: store.id,
        organizationId: input.organizationId,
        type: store.type,
        createdByPartnerId: input.partnerId ?? null,
      },
    });

    return store;
  }
}

/**
 * Billing · application/billing-service.ts
 * Creating a charge, and the merchant answering it.
 *
 * Two actors, and they are kept apart deliberately. An app creates and records
 * usage; only a merchant approves or declines. There is no method here that
 * lets the app do the merchant's half, because the whole module rests on that
 * separation and a convenience method is how it erodes.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import { money, type Money, type StoreId } from '@deservefirst/contracts';

import {
  BillingError,
  approve,
  assertChargeValid,
  assertTransition,
  cancel,
  recordUsage,
  type AppCharge,
  type BillingInterval,
  type ChargeKind,
} from '../domain/charge';

export interface BillingPorts {
  readonly charges: {
    findById(id: string): Promise<AppCharge | null>;
    forStore(storeId: StoreId): Promise<readonly AppCharge[]>;
    forApp(appId: string, storeId: StoreId): Promise<readonly AppCharge[]>;
    insert(charge: AppCharge): Promise<void>;
    save(charge: AppCharge, expectedVersion: number): Promise<boolean>;
  };
  readonly publish: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  readonly now?: () => Date;
}

export class BillingService {
  constructor(private readonly ports: BillingPorts) {}

  private now(): Date {
    return this.ports.now?.() ?? new Date();
  }

  /** Everything this store has been asked to pay, approved or not. */
  async forStore(storeId: StoreId): Promise<readonly AppCharge[]> {
    return this.ports.charges.forStore(storeId);
  }

  // --- the app's half --------------------------------------------------------

  /**
   * Asks a merchant to approve a charge. Creates nothing billable.
   *
   * The app names the amount; the merchant decides. Between those two the
   * charge is `pending` and worth nothing, which is why an app can create one
   * without any billing permission — asking is not taking.
   */
  async create(input: {
    appId: string;
    storeId: StoreId;
    kind: ChargeKind;
    name: string;
    price: Money;
    interval?: BillingInterval | null;
    cappedAmount?: Money | null;
    trialDays?: number;
    isTest?: boolean;
  }): Promise<AppCharge> {
    const charge: AppCharge = {
      id: randomUUID(),
      appId: input.appId,
      storeId: input.storeId,
      kind: input.kind,
      name: input.name.trim(),
      status: 'pending',
      price: input.price,
      interval: input.interval ?? null,
      cappedAmount: input.cappedAmount ?? null,
      balanceUsed: money(0n, input.price.currency),
      trialDays: input.trialDays ?? 0,
      activatedAt: null,
      currentPeriodEnd: null,
      cancelledAt: null,
      isTest: input.isTest ?? false,
      version: 1,
    };
    assertChargeValid(charge);

    await this.ports.charges.insert(charge);
    await this.ports.publish({
      type: 'billing.charge.created',
      payload: { chargeId: charge.id, appId: charge.appId, storeId: charge.storeId },
    });
    return charge;
  }

  /** Records usage against a capped charge. Refuses over the cap — see the domain. */
  async recordUsage(chargeId: string, appId: string, amount: Money): Promise<AppCharge> {
    const charge = await this.owned(chargeId, appId);
    const next = recordUsage(charge, amount, this.now());

    if (!(await this.ports.charges.save(next, charge.version))) {
      // Two concurrent usage records would otherwise both read the same balance
      // and the second would overwrite the first, billing for one of them.
      throw new BillingError('version', 'this charge changed while recording — retry');
    }
    return next;
  }

  private async owned(chargeId: string, appId: string): Promise<AppCharge> {
    const charge = await this.ports.charges.findById(chargeId);
    // Same answer for "not yours" and "does not exist", so an app cannot probe
    // for other apps' charges against the same store.
    if (!charge || charge.appId !== appId) {
      throw new BillingError('chargeId', 'is not a charge belonging to this app');
    }
    return charge;
  }

  // --- the merchant's half ---------------------------------------------------

  /**
   * The merchant agrees. This is the only path that makes a charge billable.
   *
   * The store is checked against the charge rather than trusted from the route,
   * so approving by id cannot reach a charge raised against a different store.
   */
  async approve(chargeId: string, storeId: StoreId): Promise<AppCharge> {
    const charge = await this.inStore(chargeId, storeId);
    const next = approve(charge, this.now());

    if (!(await this.ports.charges.save(next, charge.version))) {
      throw new BillingError('version', 'this charge changed — reload and retry');
    }
    await this.ports.publish({
      type: 'billing.charge.approved',
      payload: { chargeId: charge.id, appId: charge.appId, storeId },
    });
    return next;
  }

  async decline(chargeId: string, storeId: StoreId): Promise<AppCharge> {
    const charge = await this.inStore(chargeId, storeId);
    assertTransition(charge.status, 'declined');

    const next: AppCharge = { ...charge, status: 'declined', version: charge.version + 1 };
    if (!(await this.ports.charges.save(next, charge.version))) {
      throw new BillingError('version', 'this charge changed — reload and retry');
    }
    await this.ports.publish({
      type: 'billing.charge.declined',
      payload: { chargeId: charge.id, appId: charge.appId, storeId },
    });
    return next;
  }

  async cancel(chargeId: string, storeId: StoreId): Promise<AppCharge> {
    const charge = await this.inStore(chargeId, storeId);
    const next = cancel(charge, this.now());

    if (!(await this.ports.charges.save(next, charge.version))) {
      throw new BillingError('version', 'this charge changed — reload and retry');
    }
    await this.ports.publish({
      type: 'billing.charge.cancelled',
      payload: { chargeId: charge.id, appId: charge.appId, storeId },
    });
    return next;
  }

  private async inStore(chargeId: string, storeId: StoreId): Promise<AppCharge> {
    const charge = await this.ports.charges.findById(chargeId);
    if (!charge || charge.storeId !== storeId) {
      throw new BillingError('chargeId', 'is not a charge against this store');
    }
    return charge;
  }

  /**
   * Cancels everything an app has running here. Called by uninstall.
   *
   * An uninstalled app that keeps billing is the worst failure this module has,
   * because the merchant has no screen left on which to notice it.
   */
  async cancelAllFor(appId: string, storeId: StoreId): Promise<number> {
    const charges = await this.ports.charges.forApp(appId, storeId);
    const at = this.now();
    let cancelled = 0;

    for (const charge of charges) {
      if (charge.status !== 'active') continue;
      const next = cancel(charge, at);
      if (await this.ports.charges.save(next, charge.version)) cancelled += 1;
    }

    return cancelled;
  }
}

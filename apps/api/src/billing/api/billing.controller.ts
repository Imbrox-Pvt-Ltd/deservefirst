/**
 * Billing · api/billing.controller.ts
 * The two halves of billing, on one store-scoped surface.
 *
 * Only the MERCHANT's half is here. Approving, declining and cancelling need
 * `store.billing.approve`, which no app scope grants — so an app cannot approve
 * the charge it just raised, however it obtained its token.
 *
 * The app's half is not on this surface at all. It is authorised by identity
 * rather than by a store permission, because being able to ask for money is
 * inherent to being an installed app and not something a merchant grants
 * separately — the reference product has no billing scope either. Inventing one
 * would mean a merchant could install an app and then be unable to be asked to
 * pay for it, which is not a state anybody wants.
 * Layer: api.
 */

import { moneyFromDecimalString, toDecimalString } from '@deservefirst/contracts';

import { controller, type ModuleController } from '../../core/http/controller';
import { BillingError, amountDue, remainingCap } from '../domain/charge';
import type { BillingService } from '../application/billing-service';

export interface BillingControllerDeps {
  readonly billing: BillingService;
}

const toDto = (charge: import('../domain/charge').AppCharge) => ({
  id: charge.id,
  appId: charge.appId,
  kind: charge.kind,
  name: charge.name,
  status: charge.status,
  // Wired as an exact decimal string, never a float (§15.2).
  price: { amount: toDecimalString(charge.price), currency: charge.price.currency },
  interval: charge.interval,
  cappedAmount: charge.cappedAmount
    ? { amount: toDecimalString(charge.cappedAmount), currency: charge.cappedAmount.currency }
    : null,
  balanceUsed: { amount: toDecimalString(charge.balanceUsed), currency: charge.balanceUsed.currency },
  remaining: remainingCap(charge)
    ? { amount: toDecimalString(remainingCap(charge)!), currency: charge.price.currency }
    : null,
  due: { amount: toDecimalString(amountDue(charge, new Date())), currency: charge.price.currency },
  trialDays: charge.trialDays,
  activatedAt: charge.activatedAt?.toISOString() ?? null,
  currentPeriodEnd: charge.currentPeriodEnd?.toISOString() ?? null,
  isTest: charge.isTest,
  version: charge.version,
});

export function billingController(deps: BillingControllerDeps): ModuleController {
  return controller('billing', [
    {
      method: 'GET',
      path: '/charges',
      permission: 'store.billing.read',
      async handle({ storeId }) {
        return (await deps.billing.forStore(storeId)).map(toDto);
      },
    },

    {
      method: 'POST',
      path: '/charges/:id/approve',
      // The merchant's own permission. No app scope grants it, so an app cannot
      // approve the charge it just raised however its token was obtained.
      permission: 'store.billing.approve',
      async handle({ storeId, params, context }) {
        if (context.actorType === 'app') {
          throw new BillingError('actor', 'an app cannot approve its own charge');
        }
        return toDto(await deps.billing.approve(params.id as string, storeId));
      },
    },

    {
      method: 'POST',
      path: '/charges/:id/decline',
      permission: 'store.billing.approve',
      async handle({ storeId, params, context }) {
        if (context.actorType === 'app') {
          throw new BillingError('actor', 'an app cannot decline its own charge');
        }
        return toDto(await deps.billing.decline(params.id as string, storeId));
      },
    },

    {
      method: 'POST',
      path: '/charges/:id/cancel',
      permission: 'store.billing.approve',
      async handle({ storeId, params }) {
        return toDto(await deps.billing.cancel(params.id as string, storeId));
      },
    },
  ]);
}

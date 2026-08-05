'use server';

/**
 * Web · app/actions/billing.ts
 * The merchant's answer to a charge.
 *
 * Only the merchant's half. An app raises charges through the API with its own
 * token, and there is deliberately no action here that would let a screen do it
 * on the app's behalf.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface BillingResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function decideCharge(
  handle: string,
  chargeId: string,
  decision: 'approve' | 'decline' | 'cancel',
): Promise<BillingResult> {
  try {
    await apiFetch(`/billing/charges/${chargeId}/${decision}`, { method: 'POST' });
    revalidatePath(`/store/${handle}/settings/billing`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

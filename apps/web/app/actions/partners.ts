'use server';

/**
 * Web · app/actions/partners.ts
 * The merchant's answer to a partner asking for access.
 *
 * Both sides of the gate are here, and each one says which side it is. They are
 * different people on different surfaces — a merchant answering, a partner
 * asking — and the thing to preserve is that no call does both: nothing here
 * lets a partner decide its own access.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface PartnerActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function decidePartnerAccess(
  handle: string,
  linkId: string,
  decision: {
    grant: boolean;
    accessLevel?: 'full' | 'limited';
    permissions?: readonly string[];
    reason?: string;
  },
): Promise<PartnerActionResult> {
  try {
    await apiFetch(`/auth/partner-access/${linkId}/decide`, {
      method: 'POST',
      body: JSON.stringify(decision),
    });
    revalidatePath(`/store/${handle}/settings/organization-account`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

// --- the partner's side ------------------------------------------------------

export async function createPartner(input: {
  name: string;
  payoutCurrency?: string | null;
  websiteUrl?: string | null;
}): Promise<PartnerActionResult & { id?: string }> {
  try {
    const response = await apiFetch<{ id: string }>('/partners', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/partners');
    return { ok: true, id: response.data.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

/**
 * Asks a merchant for access. Creates a request, never a grant — the partner
 * chooses what to ASK for and the store owner chooses what to give.
 */
export async function requestStoreAccess(
  partnerId: string,
  input: { storeId: string; accessLevel: 'full' | 'limited'; permissions?: readonly string[] },
): Promise<PartnerActionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/stores`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/partners/${partnerId}/stores`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

export async function inviteStaff(
  partnerId: string,
  input: { userId: string; role: 'admin' | 'member' },
): Promise<PartnerActionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/staff`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/partners/${partnerId}/team`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

export async function removeStaff(partnerId: string, staffId: string): Promise<PartnerActionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/staff/${staffId}`, { method: 'DELETE' });
    revalidatePath(`/partners/${partnerId}/team`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request failed',
    };
  }
}

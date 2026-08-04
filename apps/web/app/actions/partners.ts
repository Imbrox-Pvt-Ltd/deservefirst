'use server';

/**
 * Web · app/actions/partners.ts
 * The merchant's answer to a partner asking for access.
 *
 * Only the merchant's side lives here. The partner's own actions — asking,
 * transferring, managing staff — belong to the partner dashboard, which is a
 * different surface for a different person, and putting both behind one action
 * file is how the two sides of a permission gate end up sharing a code path.
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

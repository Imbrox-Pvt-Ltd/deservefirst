'use server';

/**
 * Web · app/actions/functions.ts
 * Deploying and disabling functions.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface FunctionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

const base = (partnerId: string, appId: string) =>
  `/partners/${partnerId}/apps/${appId}/functions`;

export async function deployFunction(
  partnerId: string,
  appId: string,
  input: { point: string; name: string; wasmBase64: string },
): Promise<FunctionResult> {
  try {
    await apiFetch(base(partnerId, appId), { method: 'POST', body: JSON.stringify(input) });
    revalidatePath(base(partnerId, appId));
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function disableFunction(
  partnerId: string,
  appId: string,
  deploymentId: string,
): Promise<FunctionResult> {
  try {
    await apiFetch(`${base(partnerId, appId)}/${deploymentId}/disable`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Disabled from the partner dashboard.' }),
    });
    revalidatePath(base(partnerId, appId));
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

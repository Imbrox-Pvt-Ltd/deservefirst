'use server';

/**
 * Web · app/actions/apps.ts
 * Registering an app, and removing one.
 *
 * Two different people again: a partner registers, a merchant uninstalls. The
 * one thing neither can do from here is grant themselves anything — installing
 * goes through the OAuth consent, which is a screen the merchant has to answer.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface AppActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

export async function registerApp(
  partnerId: string,
  input: {
    name: string;
    handle: string;
    appUrl: string | null;
    redirectUris: readonly string[];
    requestedScopes: readonly string[];
  },
): Promise<AppActionResult & { clientId?: string; clientSecret?: string }> {
  try {
    const response = await apiFetch<{ clientId: string; clientSecret: string }>(
      `/partners/${partnerId}/apps`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath(`/partners/${partnerId}/apps`);
    return { ok: true, clientId: response.data.clientId, clientSecret: response.data.clientSecret };
  } catch (error) {
    return failed(error);
  }
}

export async function setAppStatus(
  partnerId: string,
  appId: string,
  status: 'draft' | 'published' | 'suspended',
  version: number,
): Promise<AppActionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/apps/${appId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, version }),
    });
    revalidatePath(`/partners/${partnerId}/apps`);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Removes the app and kills its tokens — see the service; this is not a flag. */
export async function uninstallApp(handle: string, appId: string): Promise<AppActionResult> {
  try {
    await apiFetch(`/apps/installations/${appId}`, { method: 'DELETE' });
    revalidatePath(`/store/${handle}/settings/apps`);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

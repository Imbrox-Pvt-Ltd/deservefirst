'use server';

/**
 * Web · app/actions/versions.ts
 * Drafting, editing and releasing an app version.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface VersionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

const path = (partnerId: string, appId: string) =>
  `/partners/${partnerId}/apps/${appId}/versions`;

export async function draftVersion(
  partnerId: string,
  appId: string,
  input: { name: string; message?: string },
): Promise<VersionResult> {
  try {
    await apiFetch(path(partnerId, appId), { method: 'POST', body: JSON.stringify(input) });
    revalidatePath(path(partnerId, appId));
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function updateVersion(
  partnerId: string,
  appId: string,
  versionId: string,
  patch: {
    message?: string;
    scopes?: readonly string[];
    redirectUris?: readonly string[];
    webhookApiVersion?: string;
  },
): Promise<VersionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/versions/${versionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    revalidatePath(path(partnerId, appId));
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function releaseVersion(
  partnerId: string,
  versionId: string,
): Promise<VersionResult> {
  try {
    await apiFetch(`/partners/${partnerId}/versions/${versionId}/release`, { method: 'POST' });
    revalidatePath(`/partners/${partnerId}`);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

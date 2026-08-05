'use server';

/**
 * Web · app/actions/platform.ts
 * The operator's decisions.
 *
 * Every action here applies to every store at once. None of them takes a store
 * handle, and that absence is deliberate — a signature that cannot name one
 * store cannot be mistaken for a store-scoped action by whoever reads it next.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface OperatorResult {
  readonly ok: boolean;
  readonly error?: string;
}

function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

export async function decideScope(
  appId: string,
  input: { scope: string; approve: boolean; reason?: string },
): Promise<OperatorResult> {
  try {
    await apiFetch(`/platform/app-reviews/${appId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/platform/reviews');
    revalidatePath('/platform/apps');
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setSuspension(
  appId: string,
  input: { suspend: boolean; reason?: string },
): Promise<OperatorResult> {
  try {
    await apiFetch(`/platform/apps/${appId}/suspension`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/platform/apps');
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setModuleEnabled(
  moduleId: string,
  input: { enabled: boolean; reason?: string },
): Promise<OperatorResult> {
  try {
    await apiFetch(`/platform/module-states/${moduleId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    revalidatePath('/platform/modules');
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

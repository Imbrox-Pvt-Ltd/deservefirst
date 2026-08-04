'use server';

/**
 * Web · app/actions/settings.ts
 * Setting a value for this store, and clearing it again.
 *
 * Clearing is its own action rather than "save an empty value", because they
 * mean different things: an empty string is a choice, and no choice at all means
 * inherit whatever the platform, the environment or the module's default says.
 * A form that cannot express the difference silently turns "use the default"
 * into "use blank".
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import { storeIdFor } from '../../lib/stores';
import type { ResolvedSettingDto } from '../../lib/types';

const PERMISSIONS = ['store.settings.read', 'store.settings.manage'];

export interface SettingResult {
  readonly ok: boolean;
  readonly setting?: ResolvedSettingDto;
  readonly error?: string;
}

async function call(
  handle: string,
  key: string,
  body: Record<string, unknown>,
): Promise<SettingResult> {
  try {
    const response = await apiFetch<ResolvedSettingDto>(
      `/platform/effective-settings/${encodeURIComponent(key)}`,
      { storeId: storeIdFor(handle), permissions: PERMISSIONS },
      { method: 'PUT', body: JSON.stringify(body) },
    );
    revalidatePath(`/store/${handle}/settings`, 'layout');
    return { ok: true, setting: response.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.message : 'Could not save this setting',
    };
  }
}

export async function saveSetting(handle: string, key: string, value: unknown) {
  return call(handle, key, { value });
}

/** Drops this store's value so the setting inherits again. */
export async function resetSetting(handle: string, key: string) {
  return call(handle, key, { value: null, clear: true });
}

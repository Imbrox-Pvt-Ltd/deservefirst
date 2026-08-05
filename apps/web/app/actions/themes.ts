'use server';

/**
 * Web · app/actions/themes.ts
 * Installing a theme, and choosing which one customers see.
 *
 * The archive is read in the browser and arrives here base64-encoded, which is
 * the same shape the API takes. A server action rather than a client fetch,
 * because `apiFetch` forwards the session cookie server-side and a call from
 * the browser would arrive anonymous.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch, ApiError } from '../../lib/api';

export interface ThemeProblem {
  readonly detail: string;
  readonly pointer?: string;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly name?: string;
  readonly fileCount?: number;
  readonly warningCount?: number;
  readonly error?: string;
  /**
   * Every reason it was refused, not the first.
   *
   * Somebody packaging a theme wants the list — a conversation where each fix
   * reveals the next complaint is how a developer gives up on a platform.
   */
  readonly problems?: readonly ThemeProblem[];
}

export async function installTheme(handle: string, archiveBase64: string): Promise<InstallResult> {
  try {
    const response = await apiFetch<{ name: string; fileCount: number; warnings: unknown[] }>(
      '/storefront/editor/themes',
      { method: 'POST', body: JSON.stringify({ archiveBase64 }) },
    );

    revalidatePath(`/store/${handle}/themes`);
    return {
      ok: true,
      name: response.data.name,
      fileCount: response.data.fileCount,
      warningCount: response.data.warnings.length,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, problems: error.problems };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'The upload failed.' };
  }
}

/** Makes a theme the one customers see. */
export async function publishTheme(handle: string, themeId: string): Promise<InstallResult> {
  try {
    await apiFetch('/storefront/editor/publish', {
      method: 'POST',
      body: JSON.stringify({ themeId }),
    });
    revalidatePath(`/store/${handle}/themes`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Publishing failed.',
      problems: error instanceof ApiError ? error.problems : undefined,
    };
  }
}

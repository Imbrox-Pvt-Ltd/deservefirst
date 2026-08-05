'use server';

/**
 * Web · app/actions/theme-resources.ts
 * Finding the record a theme setting should point at.
 *
 * A read behind a server action rather than a client fetch, for the same reason
 * every other call here is: `apiFetch` forwards the session cookie server-side,
 * and the browser has no way to reach the API as the signed-in merchant.
 * Layer: web/actions.
 */

import { apiFetch } from '../../lib/api';

export interface ResourceMatch {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly published: boolean;
}

export interface ResourceSearchResult {
  readonly ok: boolean;
  readonly matches: readonly ResourceMatch[];
  readonly error?: string;
}

export async function searchThemeResources(
  type: string,
  term: string,
): Promise<ResourceSearchResult> {
  const search = new URLSearchParams({ type, q: term });

  try {
    const response = await apiFetch<{ matches: ResourceMatch[] }>(
      `/storefront/editor/resources?${search.toString()}`,
    );
    return { ok: true, matches: response.data.matches };
  } catch (error) {
    /**
     * An empty list rather than a thrown error.
     *
     * This runs while somebody is typing. A failed lookup should leave the
     * picker saying it found nothing and the field still editable, not replace
     * the settings panel with an error — the merchant can always type the
     * handle, which is what they had to do before this existed.
     */
    return {
      ok: false,
      matches: [],
      error: error instanceof Error ? error.message : 'Could not search.',
    };
  }
}

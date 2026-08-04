/**
 * Web · lib/stores.ts
 * Which store a handle refers to, and the list-state plumbing every list screen
 * repeats.
 *
 * The handle → id map was copied into every page and every action file. That is
 * fine while it is a stub and actively harmful the moment it is not: the real
 * lookup is a session concern, and it needs one place to become one.
 * Layer: web/lib.
 */

import type { SavedView } from '@deservefirst/contracts';

export interface StoreSummary {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
}

/**
 * Who is signed in, and which stores they may open.
 *
 * This replaces a hardcoded two-store map. That map was harmless while it was
 * obviously a stub and became a lie the moment there was a real tenant: it
 * would have shown every operator the same two stores regardless of membership.
 */
export interface SessionSummary {
  readonly userId: string;
  readonly storeId: string | null;
  readonly permissions: readonly string[];
  readonly stores: readonly StoreSummary[];
}

export async function currentSession(): Promise<SessionSummary | null> {
  const { apiFetch } = await import('./api');
  try {
    const response = await apiFetch<SessionSummary | null>('/auth/session');
    return response.data;
  } catch {
    // Not signed in, or the API is down. Callers redirect to sign in either
    // way — an admin that renders half a screen is worse than one that asks.
    return null;
  }
}

/**
 * Next hands search params as `string | string[] | undefined`; the list engine
 * wants a URLSearchParams. Repeated arrays take their first value — a duplicated
 * `?query=` is a malformed URL, not a request to filter twice.
 */
export function listQueryFrom(
  search: Record<string, string | string[] | undefined>,
  views: readonly SavedView[] = [],
): URLSearchParams {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  // A saved view supplies the filter only when the URL does not already carry
  // one, so editing filters while a view is selected does not snap back.
  const view = views.find((entry) => entry.id === query.get('savedViewId'));
  if (view?.query && !query.get('query')) query.set('query', view.query);

  return query;
}



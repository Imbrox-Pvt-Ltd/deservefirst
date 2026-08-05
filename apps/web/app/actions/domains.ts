'use server';

/**
 * Web · app/actions/domains.ts
 * Connecting, checking and choosing a store's hostnames.
 *
 * Server actions rather than client fetches, which is how every other write in
 * this app reaches the API: the session cookie is forwarded server-side by
 * `apiFetch`, so a call from the browser would arrive anonymous even if there
 * were a route to receive it.
 *
 * Every one returns a result rather than throwing. Each of these can fail for a
 * reason the merchant caused and can fix — a domain already taken, a DNS record
 * not published yet — and those are messages to read, not errors to crash a
 * screen on.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface DomainResult {
  readonly ok: boolean;
  readonly error?: string;
  /** What the check found, for the screen to show beside the domain. */
  readonly message?: string;
}

function failed(error: unknown): DomainResult {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

const refresh = (handle: string) => revalidatePath(`/store/${handle}/settings/domains`);

export async function connectDomain(handle: string, host: string): Promise<DomainResult> {
  try {
    await apiFetch('/storefront/domains', {
      method: 'POST',
      body: JSON.stringify({ host }),
    });
    refresh(handle);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Reads DNS and records what it found.
 *
 * The message comes back rather than being invented here: whether ownership is
 * proved, whether traffic arrives, and which record is still missing are all
 * decided by the platform, and a second copy of that wording in the UI would
 * drift from the one that is actually true.
 */
export async function verifyDomain(handle: string, id: string): Promise<DomainResult> {
  try {
    const response = await apiFetch<{ message: string }>(`/storefront/domains/${id}/verify`, {
      method: 'POST',
    });
    refresh(handle);
    return { ok: true, message: response.data.message };
  } catch (error) {
    return failed(error);
  }
}

export async function makeDomainPrimary(handle: string, id: string): Promise<DomainResult> {
  try {
    await apiFetch(`/storefront/domains/${id}/primary`, { method: 'POST' });
    refresh(handle);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function disconnectDomain(handle: string, id: string): Promise<DomainResult> {
  try {
    await apiFetch(`/storefront/domains/${id}`, { method: 'DELETE' });
    refresh(handle);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

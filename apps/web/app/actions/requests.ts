'use server';

/**
 * Web · app/actions/requests.ts
 * Server actions for the quoting workflow. Each transition is its own action
 * rather than a generic "set status", mirroring the API — the rules live in the
 * service and the screen should not be able to route around them.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { RequestDto } from '../../lib/types';

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly conflict?: boolean;
}


async function call(
  handle: string,
  path: string,
  body: Record<string, unknown>,
  method: 'POST' | 'DELETE' = 'POST',
): Promise<ActionResult<RequestDto>> {
  try {
    const response = await apiFetch<RequestDto>(
      `/orders/requests${path}`,
      { method, body: JSON.stringify(body) },
    );
    revalidatePath(`/store/${handle}/requests`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function quoteLine(
  handle: string,
  id: string,
  lineId: string,
  amount: string,
  currency: string,
  version: number,
) {
  return call(handle, `/${id}/lines/${lineId}/quote`, { price: { amount, currency }, version });
}

export async function removeLine(handle: string, id: string, lineId: string, version: number) {
  return call(handle, `/${id}/lines/${lineId}`, { version }, 'DELETE');
}

export async function sendQuote(handle: string, id: string, version: number) {
  return call(handle, `/${id}/quote`, { version });
}

export async function submitRequest(handle: string, id: string, version: number) {
  return call(handle, `/${id}/submit`, { version });
}

export async function acceptRequest(handle: string, id: string, version: number) {
  return call(handle, `/${id}/accept`, { version });
}

export async function declineRequest(handle: string, id: string, reason: string, version: number) {
  return call(handle, `/${id}/decline`, { reason, version });
}

/** Creates a draft request. Lines and pricing are added on the detail screen. */
export async function createRequest(
  handle: string,
  input: {
    contactName: string | null;
    contactEmail: string | null;
    currency: string;
    note: string | null;
  },
) {
  return call(handle, '', input);
}

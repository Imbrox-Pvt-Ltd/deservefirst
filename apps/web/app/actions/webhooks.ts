'use server';

/**
 * Web · app/actions/webhooks.ts
 * Registering, removing and re-sending webhook endpoints.
 *
 * The create action is the only place in the admin that returns a secret. It is
 * passed straight back to the caller and never stored anywhere on this side —
 * the screen shows it once and then it is gone, which is the whole point of
 * generating it server-side.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';

export interface WebhookResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

export async function registerWebhook(
  handle: string,
  input: { eventType: string; url: string },
): Promise<WebhookResult<{ id: string; secret: string }>> {
  try {
    const response = await apiFetch<{ id: string; secret: string }>('/platform/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/store/${handle}/settings/notifications`);
    return { ok: true, data: response.data };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWebhook(handle: string, id: string): Promise<WebhookResult<null>> {
  try {
    await apiFetch(`/platform/webhooks/${id}`, { method: 'DELETE' });
    revalidatePath(`/store/${handle}/settings/notifications`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Sends a delivery again.
 *
 * Offered for delivered rows too, not just dead ones: the common real reason to
 * replay is that the receiver returned 200 and then lost the event, which looks
 * like success from this side.
 */
export async function replayDelivery(handle: string, id: string): Promise<WebhookResult<null>> {
  try {
    await apiFetch(`/platform/webhook-deliveries/${id}/replay`, { method: 'POST' });
    revalidatePath(`/store/${handle}/settings/notifications`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

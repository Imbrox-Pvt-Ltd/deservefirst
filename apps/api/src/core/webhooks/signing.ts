/**
 * Core · webhooks/signing.ts
 * Proving a webhook came from us, and was not replayed.
 *
 * The signature covers the timestamp AND the body, and the timestamp is sent
 * alongside. Signing only the body would let anyone who captured one request
 * resend it forever — a valid signature over a valid payload, arriving whenever
 * the attacker chose. Binding the two means a captured request expires.
 *
 * The scheme is deliberately the boring one: `t=<unix>,v1=<hmac-sha256>`. It is
 * what integrators have already written code for, which matters more here than
 * elegance — a receiver who cannot verify simply stops verifying.
 * Layer: core.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'df-webhook-signature';
export const EVENT_ID_HEADER = 'df-webhook-event-id';
export const TOPIC_HEADER = 'df-webhook-topic';

/** How old a signed request may be before it is refused, in seconds. */
export const TOLERANCE_SECONDS = 300;

function digest(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function sign(secret: string, body: string, at: Date = new Date()): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${timestamp},v1=${digest(secret, timestamp, body)}`;
}

/**
 * Verifies a signature the way a receiver should.
 *
 * Exported and tested because the documentation for this has to be code that
 * demonstrably works — an integration guide with a subtly wrong verification
 * snippet is worse than none, since everyone copies it.
 */
export function verify(
  secret: string,
  body: string,
  header: string,
  now: Date = new Date(),
): { valid: boolean; reason?: string } {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key ?? '', rest.join('=')];
    }),
  );

  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) {
    return { valid: false, reason: 'malformed signature header' };
  }

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > TOLERANCE_SECONDS) {
    // Checked BEFORE the digest, so a replayed request is rejected on age even
    // if its signature is genuine — which it will be, because it was ours.
    return { valid: false, reason: 'timestamp outside the tolerance window' };
  }

  const expected = digest(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature does not match' };
  }

  return { valid: true };
}

/**
 * The body sent to a receiver.
 *
 * `id` is the event's, not the delivery's, and that is the important part: a
 * retry carries the SAME id, so a receiver can deduplicate. Without it,
 * at-least-once delivery silently becomes "charged twice".
 */
export function webhookBody(input: {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  storeId: string;
  payload: unknown;
}): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.eventType,
    occurredAt: input.occurredAt.toISOString(),
    storeId: input.storeId,
    data: input.payload,
  });
}

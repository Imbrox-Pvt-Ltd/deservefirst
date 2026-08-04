/**
 * Core · webhooks/webhook.ts
 * Outbound delivery: the rules, with no I/O.
 *
 * Modules only publish events (§31.9). Everything about getting one to somebody
 * else's server — signing it, retrying it, giving up on it, letting an operator
 * send it again — belongs to the platform, because every module would otherwise
 * solve it slightly differently and none of them would solve the hard half.
 *
 * The hard half is that the receiver is somebody else's server. It will be down,
 * it will be slow, it will return 200 having done nothing, and it will
 * occasionally receive the same event twice no matter how careful the sender is.
 * The design admits that rather than pretending otherwise: delivery is recorded
 * before it is attempted, retries are bounded, and every payload carries an
 * event id the receiver can deduplicate on.
 * Layer: core (pure).
 */

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';
export type SubscriptionStatus = 'active' | 'paused' | 'disabled';

export interface WebhookSubscription {
  readonly id: string;
  /** The event this wants, e.g. `catalog.product.published`. */
  readonly eventType: string;
  readonly url: string;
  /** Shown once at creation and never again — see the service. */
  readonly secret: string;
  readonly status: SubscriptionStatus;
  /** Consecutive failures. Reset by a success, not by time. */
  readonly consecutiveFailures: number;
  readonly disabledReason: string | null;
  readonly version: number;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly subscriptionId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
}

export class WebhookError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'WebhookError';
  }
}

/** Give up after this many attempts and dead-letter the delivery. */
export const MAX_ATTEMPTS = 6;

/** Disable a subscription whose endpoint has failed this many times running. */
export const FAILURES_BEFORE_DISABLE = 20;

/**
 * Where the next attempt goes, in seconds: 30s, 2m, 8m, 32m, 2h.
 *
 * Exponential rather than fixed, because the common cause of failure is a
 * receiver that is down, and hammering it every thirty seconds neither helps it
 * recover nor gets the event delivered any sooner. The last gap is hours, which
 * is long enough to survive a deploy on the other side.
 */
export function backoffSeconds(attempt: number): number {
  return 30 * 4 ** Math.max(0, attempt - 1);
}

export function assertSubscriptionValid(subscription: WebhookSubscription): void {
  let parsed: URL;
  try {
    parsed = new URL(subscription.url);
  } catch {
    throw new WebhookError('url', 'must be an absolute URL');
  }

  if (parsed.protocol !== 'https:' && !isLoopback(parsed.hostname)) {
    // Plain HTTP would put a signed payload — and often customer data — on the
    // wire in clear. Loopback is allowed because that is where development
    // receivers live, and refusing it would push people to disable the check.
    throw new WebhookError('url', 'must use https, except on localhost for development');
  }

  if (subscription.eventType.trim().length === 0) {
    throw new WebhookError('eventType', 'is required');
  }
  if (subscription.secret.length < 32) {
    throw new WebhookError('secret', 'must be at least 32 characters');
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Whether a response counts as delivered.
 *
 * Any 2xx. Deliberately NOT "not an error": a 3xx means the endpoint moved and
 * the receiver should be told to update it rather than have us silently follow
 * a redirect to somewhere the signature was not meant for.
 */
export function isDelivered(responseStatus: number): boolean {
  return responseStatus >= 200 && responseStatus < 300;
}

/**
 * Whether it is worth trying again.
 *
 * A 4xx other than 408 or 429 means the receiver understood and refused — the
 * URL is wrong, the app is uninstalled, the payload is rejected. Retrying that
 * for two hours helps nobody and looks like an attack from the other side.
 */
export function isRetryable(responseStatus: number | null): boolean {
  if (responseStatus === null) return true; // a timeout or a connection refused
  if (responseStatus === 408 || responseStatus === 429) return true;
  return responseStatus >= 500;
}

export interface AttemptOutcome {
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly at: Date;
}

/** The delivery after an attempt: delivered, waiting to retry, or dead. */
export function applyAttempt(
  delivery: WebhookDelivery,
  outcome: AttemptOutcome,
): WebhookDelivery {
  const attempts = delivery.attempts + 1;

  if (outcome.responseStatus !== null && isDelivered(outcome.responseStatus)) {
    return {
      ...delivery,
      attempts,
      status: 'delivered',
      responseStatus: outcome.responseStatus,
      error: null,
      nextAttemptAt: null,
      deliveredAt: outcome.at,
    };
  }

  const base = {
    ...delivery,
    attempts,
    responseStatus: outcome.responseStatus,
    error: outcome.error,
    deliveredAt: null,
  };

  if (!isRetryable(outcome.responseStatus) || attempts >= MAX_ATTEMPTS) {
    // Dead, not failed: "failed" invites an automatic retry somewhere, and this
    // is the state that means a human has to look.
    return { ...base, status: 'dead', nextAttemptAt: null };
  }

  return {
    ...base,
    status: 'pending',
    nextAttemptAt: new Date(outcome.at.getTime() + backoffSeconds(attempts) * 1000),
  };
}

/** The subscription after an attempt on one of its deliveries. */
export function applyToSubscription(
  subscription: WebhookSubscription,
  delivered: boolean,
): WebhookSubscription {
  if (delivered) {
    // Reset on success rather than decay over time: what matters is whether the
    // endpoint is working now, not how badly it behaved last week.
    return { ...subscription, consecutiveFailures: 0, version: subscription.version + 1 };
  }

  const consecutiveFailures = subscription.consecutiveFailures + 1;
  if (consecutiveFailures < FAILURES_BEFORE_DISABLE) {
    return { ...subscription, consecutiveFailures, version: subscription.version + 1 };
  }

  return {
    ...subscription,
    consecutiveFailures,
    status: 'disabled',
    disabledReason: `${consecutiveFailures} consecutive failures — the endpoint stopped responding.`,
    version: subscription.version + 1,
  };
}

/** Whether this subscription should receive anything right now. */
export function isListening(subscription: WebhookSubscription): boolean {
  return subscription.status === 'active';
}

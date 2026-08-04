/**
 * Core · webhooks/delivery.service.ts
 * Getting an event to somebody else's server.
 *
 * The order of operations is the design. A delivery row is written BEFORE any
 * request is attempted, so a crash between "we decided to send this" and "we
 * sent it" leaves a record that can be retried rather than an event that
 * silently never arrived. That is the outbox pattern, and it is the only part of
 * webhook delivery that cannot be bolted on afterwards.
 *
 * Delivery is at-least-once and says so. Exactly-once across a network to a
 * server we do not control is not available at any price; what IS available is a
 * stable event id on every attempt, so a receiver can make its own side
 * idempotent. Pretending otherwise just moves the duplicate somewhere nobody is
 * looking for it.
 * Layer: core.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import {
  applyAttempt,
  applyToSubscription,
  isListening,
  type WebhookDelivery,
  type WebhookSubscription,
} from './webhook';
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TOPIC_HEADER, sign, webhookBody } from './signing';

export interface WebhookSubscriptionRepository {
  listening(storeId: StoreId, eventType: string): Promise<readonly WebhookSubscription[]>;
  findById(id: string): Promise<WebhookSubscription | null>;
  save(subscription: WebhookSubscription): Promise<void>;
}

export interface WebhookDeliveryRepository {
  create(storeId: StoreId, delivery: WebhookDelivery): Promise<void>;
  save(delivery: WebhookDelivery): Promise<void>;
  findById(id: string): Promise<{ storeId: StoreId; delivery: WebhookDelivery } | null>;
  /** Deliveries whose next attempt is due, across all stores. */
  due(now: Date, limit: number): Promise<readonly { storeId: StoreId; delivery: WebhookDelivery }[]>;
}

/** Injected so tests do not reach the network and a timeout is enforceable. */
export type WebhookTransport = (request: {
  url: string;
  body: string;
  headers: Record<string, string>;
}) => Promise<{ status: number | null; error: string | null }>;

export interface DeliveryOptions {
  readonly subscriptions: WebhookSubscriptionRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly transport: WebhookTransport;
  readonly now?: () => Date;
}

export class WebhookDeliveryService {
  constructor(private readonly options: DeliveryOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Records one delivery per listening subscription.
   *
   * Written and not sent. Sending happens on the drain, which means an event
   * emitted inside a request never makes that request wait on somebody else's
   * server — a slow receiver would otherwise make the merchant's save slow.
   */
  async enqueue(input: {
    storeId: StoreId;
    eventId: string;
    eventType: string;
    occurredAt: Date;
    payload: unknown;
  }): Promise<number> {
    const listening = (await this.options.subscriptions.listening(input.storeId, input.eventType))
      .filter(isListening);

    const body = webhookBody({
      eventId: input.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      storeId: input.storeId,
      payload: input.payload,
    });

    for (const subscription of listening) {
      await this.options.deliveries.create(input.storeId, {
        id: randomUUID(),
        subscriptionId: subscription.id,
        eventId: input.eventId,
        eventType: input.eventType,
        // The body is stored, not rebuilt at send time. A retry must deliver
        // what the event said WHEN IT HAPPENED, not what the record looks like
        // an hour later.
        payload: body,
        status: 'pending',
        attempts: 0,
        responseStatus: null,
        error: null,
        nextAttemptAt: this.now(),
        deliveredAt: null,
      });
    }

    return listening.length;
  }

  /** Sends everything currently due. Returns what happened, for the caller to log. */
  async drain(limit = 50): Promise<{ attempted: number; delivered: number; dead: number }> {
    const due = await this.options.deliveries.due(this.now(), limit);
    let delivered = 0;
    let dead = 0;

    for (const entry of due) {
      const result = await this.attempt(entry.delivery);
      if (result.status === 'delivered') delivered += 1;
      if (result.status === 'dead') dead += 1;
    }

    return { attempted: due.length, delivered, dead };
  }

  /**
   * One attempt at one delivery.
   *
   * The subscription is re-read rather than trusted from the enqueue, because
   * it may have been paused, re-pointed or disabled since — and sending to a URL
   * the merchant has just removed is exactly the surprise this avoids.
   */
  async attempt(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    const subscription = await this.options.subscriptions.findById(delivery.subscriptionId);
    if (!subscription || !isListening(subscription)) {
      const stopped: WebhookDelivery = {
        ...delivery,
        status: 'dead',
        error: subscription
          ? `the subscription is ${subscription.status}`
          : 'the subscription was removed',
        nextAttemptAt: null,
      };
      await this.options.deliveries.save(stopped);
      return stopped;
    }

    const at = this.now();
    const response = await this.options.transport({
      url: subscription.url,
      body: delivery.payload,
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(subscription.secret, delivery.payload, at),
        // Sent as a header as well as in the body, so a receiver can deduplicate
        // before it parses anything.
        [EVENT_ID_HEADER]: delivery.eventId,
        [TOPIC_HEADER]: delivery.eventType,
      },
    });

    const next = applyAttempt(delivery, {
      responseStatus: response.status,
      error: response.error,
      at,
    });
    await this.options.deliveries.save(next);

    await this.options.subscriptions.save(
      applyToSubscription(subscription, next.status === 'delivered'),
    );

    return next;
  }

  /**
   * Sends a delivery again, whatever state it reached.
   *
   * A new row rather than resetting the old one: the history of what was tried
   * and what came back is the thing an operator is looking at when they decide
   * to replay, and overwriting it destroys the evidence mid-investigation.
   */
  async replay(deliveryId: string): Promise<WebhookDelivery | null> {
    const found = await this.options.deliveries.findById(deliveryId);
    if (!found) return null;

    const copy: WebhookDelivery = {
      ...found.delivery,
      id: randomUUID(),
      status: 'pending',
      attempts: 0,
      responseStatus: null,
      error: null,
      nextAttemptAt: this.now(),
      deliveredAt: null,
    };

    await this.options.deliveries.create(found.storeId, copy);
    return this.attempt(copy);
  }
}

/**
 * The real transport: fetch, with a timeout and no redirect following.
 *
 * Redirects are not followed on purpose. The signature was computed for one
 * destination, and quietly re-sending a signed customer payload to wherever a
 * redirect points is how a compromised DNS record becomes a data leak.
 */
export function httpTransport(timeoutMs = 10_000): WebhookTransport {
  return async ({ url, body, headers }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      return { status: response.status, error: null };
    } catch (error) {
      return {
        status: null,
        error: error instanceof Error ? error.message : 'the request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

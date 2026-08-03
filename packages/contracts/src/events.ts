/**
 * Contracts · events.ts
 * The event standard (§14.4). Every event is a typed, versioned schema published
 * in a module's contracts; backward-compatible changes only within a version, and
 * a breaking change means a new version plus an upcaster so old consumers keep
 * working. Fitness-checked.
 * Layer: contracts (pure, no framework).
 */

import type { OrganizationId, StoreId, UserId } from './scope';

/** Name shape: `{context}.{aggregate}.{pastTenseVerb}` — catalog.product.published. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export function isValidEventType(type: string): boolean {
  return EVENT_TYPE_PATTERN.test(type);
}

export interface EventEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly storeId: StoreId | null;
  readonly organizationId: OrganizationId | null;
  readonly actorId: UserId | null;
  readonly correlationId: string;
  readonly payload: TPayload;
}

/**
 * Upcaster from one event version to the next. A breaking change ships with one
 * of these, so consumers pinned to the old version keep working (§16.5).
 */
export type EventUpcaster<TFrom = unknown, TTo = unknown> = (payload: TFrom) => TTo;

export interface EventRegistration<TPayload = unknown> {
  readonly type: string;
  readonly version: number;
  readonly upcasters?: Readonly<Record<number, EventUpcaster>>;
  readonly validate?: (payload: unknown) => payload is TPayload;
}

/**
 * Hooks are synchronous extension points that may transform data
 * (`beforeProductSave`), as distinct from events, which are fire-and-forget facts.
 * Third parties subscribe through registered handlers or webhooks — never by
 * editing core.
 */
export interface HookRegistration<TInput = unknown, TOutput = TInput> {
  readonly name: string;
  readonly kind: 'filter' | 'action';
  readonly handler: (input: TInput) => TOutput | Promise<TOutput>;
  /** Lower runs first. */
  readonly priority: number;
}

/** Delivery targets for outbound webhooks (§31.9 plus the reference product's set). */
export type WebhookDeliveryTarget =
  | { readonly kind: 'https'; readonly url: string; readonly secret: string }
  | { readonly kind: 'pubsub'; readonly project: string; readonly topic: string }
  | { readonly kind: 'eventbridge'; readonly arn: string };

export interface WebhookSubscription {
  readonly id: string;
  readonly storeId: StoreId;
  readonly topic: string;
  readonly apiVersion: string;
  readonly target: WebhookDeliveryTarget;
  readonly createdAt: Date;
}

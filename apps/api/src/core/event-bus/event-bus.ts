/**
 * Core · event-bus/event-bus.ts
 * Typed pub/sub plus hooks (§5.4). Two distinct mechanisms, deliberately not
 * merged: events are fire-and-forget facts, hooks are synchronous extension
 * points that may transform data. In-process now; the same interface moves to
 * Redis Streams when modules become services.
 * Layer: core.
 */

import { randomUUID } from 'node:crypto';

import {
  type EventEnvelope,
  type HookRegistration,
  isValidEventType,
  type OrganizationId,
  type StoreId,
  type UserId,
} from '@deservefirst/contracts';

import { getRequestContext } from '../tenant-context/request-context.store';

export type EventHandler<T = unknown> = (envelope: EventEnvelope<T>) => void | Promise<void>;

interface Subscription {
  readonly moduleId: string;
  readonly handler: EventHandler;
}

export interface EmitOptions {
  readonly version?: number;
  readonly storeId?: StoreId | null;
  readonly organizationId?: OrganizationId | null;
  readonly actorId?: UserId | null;
}

/**
 * Failures in a subscriber must not fail the emitter — a dead consumer never
 * takes down the producer (§14.6 graceful degradation). Delivery errors are
 * surfaced through this callback so the observability layer can record them.
 */
export type DeliveryErrorReporter = (
  error: unknown,
  context: { eventType: string; moduleId: string },
) => void;

export class EventBus {
  private readonly subscriptions = new Map<string, Subscription[]>();
  private readonly hooks = new Map<string, HookRegistration[]>();
  private readonly declaredEmitters = new Map<string, string>();

  constructor(private readonly reportError: DeliveryErrorReporter = () => {}) {}

  /**
   * Records which module owns an event type. Two modules emitting the same event
   * makes provenance ambiguous and consumers unable to reason about ordering.
   */
  declareEmitter(moduleId: string, eventType: string): void {
    if (!isValidEventType(eventType)) {
      throw new Error(
        `Event type "${eventType}" must be {context}.{aggregate}.{pastTenseVerb}, e.g. catalog.product.published`,
      );
    }
    const existing = this.declaredEmitters.get(eventType);
    if (existing && existing !== moduleId) {
      throw new Error(
        `Event "${eventType}" is already emitted by "${existing}"; "${moduleId}" may not also own it.`,
      );
    }
    this.declaredEmitters.set(eventType, moduleId);
  }

  subscribe<T>(moduleId: string, eventType: string, handler: EventHandler<T>): () => void {
    const list = this.subscriptions.get(eventType) ?? [];
    const subscription: Subscription = { moduleId, handler: handler as EventHandler };
    list.push(subscription);
    this.subscriptions.set(eventType, list);

    return () => {
      const current = this.subscriptions.get(eventType) ?? [];
      this.subscriptions.set(
        eventType,
        current.filter((entry) => entry !== subscription),
      );
    };
  }

  /**
   * Emits an event, filling tenant and correlation fields from the ambient
   * request context so callers cannot accidentally publish an unscoped fact.
   */
  async emit<T>(eventType: string, payload: T, options: EmitOptions = {}): Promise<EventEnvelope<T>> {
    const context = getRequestContext();
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      type: eventType,
      version: options.version ?? 1,
      occurredAt: new Date(),
      storeId: options.storeId !== undefined ? options.storeId : (context?.storeId ?? null),
      organizationId:
        options.organizationId !== undefined ? options.organizationId : (context?.organizationId ?? null),
      actorId: options.actorId !== undefined ? options.actorId : (context?.userId ?? null),
      correlationId: context?.correlationId ?? randomUUID(),
      payload,
    };

    const subscribers = this.subscriptions.get(eventType) ?? [];
    await Promise.all(
      subscribers.map(async (subscription) => {
        try {
          await subscription.handler(envelope);
        } catch (error) {
          this.reportError(error, { eventType, moduleId: subscription.moduleId });
        }
      }),
    );

    return envelope;
  }

  // --- hooks ----------------------------------------------------------------

  registerHook<TIn, TOut>(registration: HookRegistration<TIn, TOut>): () => void {
    const list = this.hooks.get(registration.name) ?? [];
    list.push(registration as HookRegistration);
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(registration.name, list);

    return () => {
      const current = this.hooks.get(registration.name) ?? [];
      this.hooks.set(
        registration.name,
        current.filter((entry) => entry !== (registration as HookRegistration)),
      );
    };
  }

  /**
   * Runs a filter chain: each handler receives the previous handler's output.
   * Unlike events, a throwing filter DOES propagate — a hook that transforms
   * data and fails has produced no value to carry forward.
   */
  async applyFilter<T>(name: string, input: T): Promise<T> {
    let value = input;
    for (const hook of this.hooks.get(name) ?? []) {
      if (hook.kind !== 'filter') continue;
      value = (await hook.handler(value)) as T;
    }
    return value;
  }

  /** Runs action hooks for their side effects; failures are reported, not thrown. */
  async runAction<T>(name: string, input: T): Promise<void> {
    for (const hook of this.hooks.get(name) ?? []) {
      if (hook.kind !== 'action') continue;
      try {
        await hook.handler(input);
      } catch (error) {
        this.reportError(error, { eventType: name, moduleId: 'hook' });
      }
    }
  }

  hasSubscribers(eventType: string): boolean {
    return (this.subscriptions.get(eventType) ?? []).length > 0;
  }
}

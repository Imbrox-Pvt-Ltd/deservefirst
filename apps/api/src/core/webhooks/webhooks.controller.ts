/**
 * Core · webhooks/webhooks.controller.ts
 * The webhook endpoints, as route declarations.
 *
 * These were hand-registered in the transport, which worked and was invisible:
 * the API reference is generated from resource and route DECLARATIONS, so an
 * endpoint written straight onto Fastify appears nowhere in it. That is a bad
 * trade anywhere and an untenable one here — webhooks exist to be consumed by
 * people outside this codebase, and an integration surface missing from the
 * integration reference may as well not ship.
 *
 * Declared against the `platform` module id, which mounts them at exactly the
 * paths they already had.
 * Layer: core/http.
 */

import { randomUUID } from 'node:crypto';

import { controller, type ModuleController } from '../http/controller';
import type { ModuleRegistry } from '../module-registry/registry';
import type { ModuleStateService } from '../platform-state/module-state.service';
import { assertSubscriptionValid, type WebhookSubscription } from './webhook';
import type { WebhookDeliveryService } from './delivery.service';

export interface WebhookControllerDeps {
  readonly registry: ModuleRegistry;
  readonly moduleState: ModuleStateService;
  readonly deliveries: {
    recentForStore(limit?: number): Promise<readonly import('./webhook').WebhookDelivery[]>;
  };
  readonly subscriptions: {
    listForStore(): Promise<readonly WebhookSubscription[]>;
    insert(subscription: WebhookSubscription): Promise<void>;
    remove(id: string): Promise<void>;
  };
  readonly webhooks: WebhookDeliveryService;
  /** Sends what is due across every store — see the composition root. */
  drainWebhooks(limit?: number): Promise<{ attempted: number; delivered: number; dead: number }>;
}

/**
 * The subscription as the API returns it.
 *
 * `secret` is absent by construction rather than deleted afterwards: a field
 * that has to be remembered to be removed eventually is not.
 */
function publicSubscription(subscription: WebhookSubscription) {
  return {
    id: subscription.id,
    eventType: subscription.eventType,
    url: subscription.url,
    status: subscription.status,
    consecutiveFailures: subscription.consecutiveFailures,
    disabledReason: subscription.disabledReason,
    version: subscription.version,
  };
}

export function webhooksController(deps: WebhookControllerDeps): ModuleController {
  return controller('platform', [
    {
      method: 'GET',
      path: '/webhook-events',
      permission: 'store.settings.read',
      /**
       * Every event this store could subscribe to, read off the manifests.
       *
       * Derived rather than kept as a list beside them: a module that publishes
       * a new event should not also have to remember to add it here, and an
       * event the subscribe form offers but nothing emits is a support ticket.
       */
      async handle({ storeId }) {
        const available = await Promise.all(
          deps.registry.all().map(async (entry) => ({
            entry,
            usable: await deps.moduleState.isEnabledForStore(storeId, entry.manifest.id),
          })),
        );

        return available
          .filter(({ usable }) => usable)
          .flatMap(({ entry }) =>
            (entry.manifest.events ?? [])
              .filter((event) => event.direction === 'emits')
              .map((event) => ({
                type: event.type,
                label: event.label,
                description: event.description ?? null,
                moduleId: entry.manifest.id,
              })),
          );
      },
    },

    {
      method: 'GET',
      path: '/webhooks',
      permission: 'store.settings.read',
      async handle() {
        return (await deps.subscriptions.listForStore()).map(publicSubscription);
      },
    },

    {
      method: 'POST',
      path: '/webhooks',
      permission: 'store.webhooks.manage',
      status: 201,
      async handle({ body }) {
        // Generated here rather than accepted from the caller: a secret somebody
        // chose is a secret somebody reused.
        const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

        const subscription: WebhookSubscription = {
          id: randomUUID(),
          // A merchant registering their own endpoint. App-owned endpoints are
          // created by the install, not by this route.
          appId: null,
          eventType: String(body.eventType ?? ''),
          url: String(body.url ?? ''),
          secret,
          status: 'active',
          consecutiveFailures: 0,
          disabledReason: null,
          version: 1,
        };

        assertSubscriptionValid(subscription);
        await deps.subscriptions.insert(subscription);

        // Returned exactly once. There is no endpoint that will show it again,
        // and the screen says so.
        return { ...publicSubscription(subscription), secret };
      },
    },

    {
      method: 'DELETE',
      path: '/webhooks/:id',
      permission: 'store.webhooks.manage',
      async handle({ params }) {
        await deps.subscriptions.remove(params.id as string);
        return { id: params.id, removed: true };
      },
    },

    {
      method: 'GET',
      path: '/webhook-deliveries',
      permission: 'store.settings.read',
      async handle() {
        return (await deps.deliveries.recentForStore()).map((delivery) => ({
          id: delivery.id,
          subscriptionId: delivery.subscriptionId,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          status: delivery.status,
          attempts: delivery.attempts,
          responseStatus: delivery.responseStatus,
          error: delivery.error,
          nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        }));
      },
    },

    {
      method: 'POST',
      path: '/webhook-deliveries/:id/replay',
      permission: 'store.webhooks.manage',
      async handle({ params }) {
        const replayed = await deps.webhooks.replay(params.id as string);
        return replayed === null ? null : { id: replayed.id, status: replayed.status };
      },
    },

    {
      method: 'POST',
      path: '/webhook-deliveries/drain',
      permission: 'store.webhooks.manage',
      /**
       * Sends whatever is due.
       *
       * Exposed as an endpoint as well as run on a timer, so an operator
       * watching a partner's endpoint come back up does not have to wait for the
       * next tick. It drains the whole queue rather than just this store's, and
       * that is not a privilege escalation: it only sends what is already due,
       * to endpoints their own owners registered.
       */
      async handle() {
        return deps.drainWebhooks();
      },
    },
  ]);
}

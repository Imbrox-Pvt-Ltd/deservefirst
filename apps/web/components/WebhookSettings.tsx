'use client';

/**
 * Web · components/WebhookSettings.tsx
 * The Notifications section's webhook panel: which endpoints this store has
 * registered, and what actually happened to the last few deliveries.
 *
 * The delivery log is the reason this screen exists. Registering an endpoint is
 * a two-field form anybody can build; the question a merchant actually arrives
 * with is "the partner says they never got it" — and answering that needs the
 * attempt count, the status the receiver returned, and the ability to send it
 * again without asking us.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Box,
  IndexTable,
  InlineStack,
  Select,
  SettingsCard,
  Text,
  TextField,
} from '@deservefirst/ui';

import { registerWebhook, removeWebhook, replayDelivery } from '../app/actions/webhooks';
import type { WebhookDeliveryDto, WebhookSubscriptionDto } from '../lib/types';

export interface WebhookSettingsProps {
  readonly handle: string;
  readonly subscriptions: readonly WebhookSubscriptionDto[];
  readonly deliveries: readonly WebhookDeliveryDto[];
  /** Event types modules have declared, so the field is a real list. */
  readonly eventTypes: readonly string[];
  readonly canManage: boolean;
}

const SUBSCRIPTION_TONE = {
  active: 'success',
  paused: 'attention',
  disabled: 'critical',
} as const;

const DELIVERY_TONE = {
  delivered: 'success',
  pending: 'attention',
  failed: 'warning',
  dead: 'critical',
} as const;

export function WebhookSettings({
  handle,
  subscriptions,
  deliveries,
  eventTypes,
  canManage,
}: WebhookSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [eventType, setEventType] = useState(eventTypes[0] ?? '');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  /**
   * Held in component state, never re-fetched.
   *
   * This is the only copy that will ever exist on this side: the API returns the
   * secret from the create call and from nowhere else. Navigating away loses it,
   * which is why the banner says so rather than quietly disappearing.
   */
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await registerWebhook(handle, { eventType, url: url.trim() });
      if (!result.ok) {
        setError(result.error ?? 'Could not register the endpoint');
        return;
      }
      setIssuedSecret(result.data?.secret ?? null);
      setUrl('');
      router.refresh();
    });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error ?? 'The request failed');
      router.refresh();
    });

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not complete that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      {issuedSecret ? (
        <Banner tone="warning" title="Copy this signing secret now">
          <BlockStack gap="200">
            <Text as="p">
              This is the only time it will be shown. Use it to verify the{' '}
              <code>df-webhook-signature</code> header on every request we send. If it is lost,
              remove the endpoint and register it again.
            </Text>
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text as="p" fontWeight="medium" breakWord>
                <code>{issuedSecret}</code>
              </Text>
            </Box>
          </BlockStack>
        </Banner>
      ) : null}

      <SettingsCard title="Webhook endpoints">
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            We send a signed POST when one of these events happens. Delivery is at-least-once, so
            the same event can arrive twice — each request carries a stable{' '}
            <code>df-webhook-event-id</code> so your side can ignore one it has already handled.
          </Text>

          {subscriptions.length === 0 ? (
            <Text as="p" tone="subdued">
              No endpoints yet. Nothing is being sent anywhere.
            </Text>
          ) : (
            <IndexTable
              resourceName={{ singular: 'endpoint', plural: 'endpoints' }}
              itemCount={subscriptions.length}
              selectable={false}
              headings={[
                { title: 'Event' },
                { title: 'Endpoint' },
                { title: 'Status' },
                { title: '' },
              ]}
            >
              {subscriptions.map((subscription, index) => (
                <IndexTable.Row id={subscription.id} key={subscription.id} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="medium">
                      {subscription.eventType}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" breakWord>
                      {subscription.url}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Badge tone={SUBSCRIPTION_TONE[subscription.status]}>
                        {subscription.status}
                      </Badge>
                      {subscription.disabledReason ? (
                        <Text as="span" tone="subdued" variant="bodySm">
                          {subscription.disabledReason}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {canManage ? (
                      <Button
                        variant="plain"
                        tone="critical"
                        disabled={pending}
                        onClick={() => run(() => removeWebhook(handle, subscription.id))}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}

          {canManage ? (
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Add an endpoint
              </Text>
              {/*
                * A closed list, not free text. The options come from the
                * manifests of the modules this store actually has enabled, so it
                * is impossible to subscribe to an event nothing will ever emit —
                * which otherwise fails as silence, the hardest thing to debug
                * from the far side of an integration.
                */}
              <Select
                label="Event"
                value={eventType}
                onChange={setEventType}
                options={eventTypes.map((type) => ({ value: type, label: type }))}
                helpText="Published by one of the modules enabled for this store."
              />
              <TextField
                label="Endpoint URL"
                value={url}
                onChange={setUrl}
                autoComplete="off"
                placeholder="https://example.com/webhooks/deservefirst"
                helpText="Must be https, except on localhost while you are developing."
              />
              <InlineStack>
                <Button
                  variant="primary"
                  disabled={pending || !url.trim() || !eventType.trim()}
                  onClick={submit}
                >
                  Add endpoint
                </Button>
              </InlineStack>
            </BlockStack>
          ) : null}
        </BlockStack>
      </SettingsCard>

      <SettingsCard title="Recent deliveries">
        {deliveries.length === 0 ? (
          <Text as="p" tone="subdued">
            Nothing has been sent yet.
          </Text>
        ) : (
          <IndexTable
            resourceName={{ singular: 'delivery', plural: 'deliveries' }}
            itemCount={deliveries.length}
            selectable={false}
            headings={[
              { title: 'Event' },
              { title: 'Status' },
              { title: 'Attempts' },
              { title: 'Response' },
              { title: '' },
            ]}
          >
            {deliveries.map((delivery, index) => (
              <IndexTable.Row id={delivery.id} key={delivery.id} position={index}>
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="medium">
                      {delivery.eventType}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {delivery.eventId}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={DELIVERY_TONE[delivery.status]}>{delivery.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{String(delivery.attempts)}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" tone={delivery.error ? 'critical' : undefined}>
                    {delivery.error ?? (delivery.responseStatus === null
                      ? 'Not attempted yet'
                      : String(delivery.responseStatus))}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {canManage ? (
                    <Button
                      variant="plain"
                      disabled={pending}
                      onClick={() => run(() => replayDelivery(handle, delivery.id))}
                    >
                      Send again
                    </Button>
                  ) : null}
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </SettingsCard>
    </BlockStack>
  );
}

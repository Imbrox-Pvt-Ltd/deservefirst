'use client';

/**
 * Web · components/PartnerOverview.tsx
 * What the agency is waiting on, and what it can already reach.
 *
 * Pending requests lead, because they are the only thing on this surface that
 * is blocked on somebody else. Everything else the partner can act on alone.
 * Layer: web.
 */

import { BlockStack, Card, InlineGrid, Page, Text } from '@deservefirst/ui';

import type { PartnerStoreDto } from '../lib/types';

export function PartnerOverview({ stores }: { stores: readonly PartnerStoreDto[] }) {
  const active = stores.filter((entry) => entry.status === 'active');
  const waiting = stores.filter((entry) => entry.status === 'pending');
  const built = stores.filter((entry) => entry.createdByPartner && entry.status !== 'revoked');

  const tiles = [
    { label: 'Client stores', value: active.length, hint: 'You have access today' },
    { label: 'Waiting on a merchant', value: waiting.length, hint: 'They decide, not you' },
    { label: 'Stores you built', value: built.length, hint: 'Yours until you transfer them' },
  ];

  return (
    <Page title="Overview">
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          {tiles.map((tile) => (
            <Card key={tile.label}>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  {tile.label}
                </Text>
                <Text as="p" variant="heading2xl">
                  {String(tile.value)}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {tile.hint}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {waiting.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Waiting on a merchant
              </Text>
              {waiting.map((entry) => (
                <Text as="p" key={entry.id} tone="subdued">
                  {entry.storeName ?? entry.storeId} — asked for{' '}
                  {entry.accessLevel === 'full' ? 'full access' : 'limited access'}
                </Text>
              ))}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}

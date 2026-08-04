'use client';

/**
 * Web · components/StorePicker.tsx
 * Store entry (§8.4.3). Shows the organization's stores and the legal entity
 * each one bills under — the distinction that makes two stores in one
 * organization genuinely separate.
 * Layer: web.
 */

import { Badge, BlockStack, Card, InlineStack, Page, Text } from '@deservefirst/ui';
import Link from 'next/link';

export interface StoreOption {
  readonly handle: string;
  readonly name: string;
  readonly entity: string;
  readonly currency: string;
}

export function StorePicker({ stores }: { stores: readonly StoreOption[] }) {
  return (
    <Page title="Choose a store" subtitle="One organization, two business entities">
      <BlockStack gap="300">
        {stores.map((store) => (
          <Card key={store.handle}>
            <Link href={`/store/${store.handle}`} style={{ textDecoration: 'none' }}>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">{store.name}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">{store.entity}</Text>
                </BlockStack>
                <Badge>{store.currency}</Badge>
              </InlineStack>
            </Link>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}

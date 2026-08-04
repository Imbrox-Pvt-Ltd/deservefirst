'use client';

/**
 * Web · components/StoreHomeView.tsx
 * Store home (§8.4.4). Dashboard widgets are contributed by modules (§31.2
 * `dashboards`); until any are declared, this shows the store's real counts.
 * Layer: web.
 */

import { BlockStack, Card, InlineGrid, Page, Text } from '@deservefirst/ui';

export function StoreHomeView({
  total,
  active,
  draft,
}: {
  total: number;
  active: number;
  draft: number;
}) {
  return (
    <Page title="Home">
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Metric label="Products" value={String(total)} />
          <Metric label="Active" value={String(active)} />
          <Metric label="Drafts" value={String(draft)} />
        </InlineGrid>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Setup guide</Text>
            <Text as="p" tone="subdued">
              This store was created by the seed command. Its products, currency and legal
              entity differ from the other store in the same organization — switch stores from
              the menu to watch the boundary hold.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="heading2xl">{value}</Text>
      </BlockStack>
    </Card>
  );
}

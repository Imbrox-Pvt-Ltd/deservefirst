'use client';

/**
 * UI · components/UnavailableSection.tsx
 * What a merchant sees when they open a section the reference admin has but this
 * install does not provide.
 *
 * The navigation deliberately shows the whole information architecture, so these
 * entries are reachable by design. The alternative to this screen is a 404,
 * which reads as "the application is broken" rather than "this part is not
 * installed" — a merchant cannot tell those apart, but they will report the
 * first one as a bug.
 * Layer: ui.
 */

import { BlockStack, Box, Card, Page, Text } from '../primitives';

export interface UnavailableSectionProps {
  readonly title: string;
  /** The module that would provide it, when one is planned. */
  readonly providedBy?: string;
}

export function UnavailableSection({ title, providedBy }: UnavailableSectionProps) {
  return (
    <Page title={title}>
      <Card>
        <Box padding="600">
          <BlockStack gap="300" inlineAlign="start">
            <Text as="h2" variant="headingMd">
              {title} is not part of this install
            </Text>
            <Text as="p" tone="subdued">
              This section exists in the navigation because it belongs to the
              product&rsquo;s structure, but no module in this install provides it yet.
              Nothing is broken and nothing is missing from your store.
            </Text>
            {providedBy ? (
              <Text as="p" tone="subdued">
                It will appear here as soon as the <b>{providedBy}</b> module is enabled.
              </Text>
            ) : null}
          </BlockStack>
        </Box>
      </Card>
    </Page>
  );
}

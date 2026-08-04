'use client';

/**
 * Web · components/Dashboard.tsx
 * A dashboard, rendered from whatever the modules contributed.
 *
 * This file knows nothing about products, requests or stock. It knows about
 * widgets — which is the same bargain as the navigation and the settings
 * overlay, applied to the first screen a merchant sees. Enabling a module makes
 * its card appear; disabling one makes it vanish; nobody edits this file for
 * either.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';

import {
  BlockStack,
  Box,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from '@deservefirst/ui';

import type { DashboardWidgetDto } from '../lib/types';

export interface DashboardProps {
  readonly handle: string;
  readonly storeName: string;
  readonly widgets: readonly DashboardWidgetDto[];
}

export function Dashboard({ handle, storeName, widgets }: DashboardProps) {
  const router = useRouter();

  return (
    <Page title={`Welcome to ${storeName}`}>
      <BlockStack gap="400">
        {widgets.length === 0 ? (
          <Card>
            <Box padding="500">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Nothing to show yet</Text>
                <Text as="p" tone="subdued">
                  Cards here come from the modules this store has enabled. Enable one, or ask an
                  administrator for the permissions to see its numbers.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
            {widgets.map((widget) => (
              <Widget
                key={widget.id}
                widget={widget}
                onOpen={
                  widget.href
                    ? () => router.push(widget.href!.replace(':handle', handle))
                    : undefined
                }
              />
            ))}
          </InlineGrid>
        )}
      </BlockStack>
    </Page>
  );
}

function Widget({ widget, onOpen }: { widget: DashboardWidgetDto; onOpen?: () => void }) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" tone="subdued">{widget.label}</Text>

          {widget.unavailable ? (
            // Saying a number could not be produced beats showing a zero that
            // reads as fact. One failing metric must not quietly become "0".
            <Text as="p" tone="critical" variant="bodySm">{widget.unavailable}</Text>
          ) : (
            <InlineStack gap="200" blockAlign="baseline">
              <Text as="p" variant="heading2xl">{format(widget)}</Text>
            </InlineStack>
          )}

          {widget.description ? (
            <Text as="p" tone="subdued" variant="bodySm">{widget.description}</Text>
          ) : null}

          {onOpen ? (
            <Box paddingBlockStart="100">
              <Text as="span" variant="bodySm">
                <button type="button" className="df-widget-link" onClick={onOpen}>
                  View
                </button>
              </Text>
            </Box>
          ) : null}
        </BlockStack>
      </Box>
    </Card>
  );
}

function format(widget: DashboardWidgetDto): string {
  const value = widget.value ?? 0;
  if (widget.format === 'percent') return `${Math.round(value * 100)}%`;
  if (widget.format === 'duration') return `${value} days`;
  return new Intl.NumberFormat('en-US').format(value);
}

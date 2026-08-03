/**
 * UI · templates/SettingsScreen.tsx
 * The settings template. Rendered as a full-screen overlay above the admin — the
 * page behind stays mounted and closing returns to it — while still owning a
 * real, deep-linkable URL (§8.5). Copied from the reference product's behaviour,
 * which is our own modals-as-routes rule already validated in production.
 * Layer: ui.
 */

import type { ReactNode } from 'react';

import { BlockStack, Box, Card, InlineStack, Layout, Page, Text } from '@shopify/polaris';

import { SETTINGS_NAV } from '../navigation';

export interface SettingsScreenProps {
  readonly activeSection: string;
  readonly title: string;
  readonly storeName: string;
  readonly storeCount: number;
  readonly organizationName: string;
  readonly children: ReactNode;
  onNavigate(sectionId: string): void;
  onClose(): void;
}

export function SettingsScreen({
  activeSection,
  title,
  storeName,
  storeCount,
  organizationName,
  children,
  onNavigate,
  onClose,
}: SettingsScreenProps) {
  return (
    <Page fullWidth title={title} backAction={{ content: 'Close', onAction: onClose }}>
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              {/* Organisation scope sits above the store, as in the reference. */}
              <Box paddingBlockEnd="200">
                <Text as="p" variant="headingSm">
                  {organizationName}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {storeCount} {storeCount === 1 ? 'store' : 'stores'}
                </Text>
              </Box>

              <SettingsNavItem
                label="Organization"
                active={activeSection === 'organization-details'}
                onClick={() => onNavigate('organization-details')}
              />
              <SettingsNavItem
                label="Users"
                active={activeSection === 'organization-account'}
                onClick={() => onNavigate('organization-account')}
              />

              <Box paddingBlockStart="300" paddingBlockEnd="200">
                <Text as="p" variant="headingSm">
                  {storeName}
                </Text>
              </Box>

              {SETTINGS_NAV.map((section) => (
                <SettingsNavItem
                  key={section.id}
                  label={section.label}
                  active={activeSection === section.id}
                  onClick={() => onNavigate(section.id)}
                />
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">{children}</BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function SettingsNavItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <Box
      as="div"
      padding="200"
      borderRadius="200"
      background={active ? 'bg-surface-selected' : undefined}
    >
      <InlineStack align="start">
        <button
          type="button"
          onClick={onClick}
          style={{ all: 'unset', cursor: 'pointer', width: '100%' }}
        >
          <Text as="span" variant="bodyMd" fontWeight={active ? 'semibold' : 'regular'}>
            {label}
          </Text>
        </button>
      </InlineStack>
    </Box>
  );
}

/** A settings card generated from a module's declared settings schema (§31.9). */
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {description && (
            <Text as="p" tone="subdued" variant="bodySm">
              {description}
            </Text>
          )}
        </BlockStack>
        {children}
      </BlockStack>
    </Card>
  );
}

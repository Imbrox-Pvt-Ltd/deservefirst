/**
 * UI · templates/DetailScreen.tsx
 * The detail template (§8.3): two-column form with a contextual save bar, plus
 * the toolkit panels an entity earns by declaration — tags, metafields, SEO,
 * translations and timeline. A module author fills sections; they never lay a
 * screen out from scratch.
 * Layer: ui.
 */

import type { ReactNode } from 'react';

import {
  BlockStack,
  Card,
  ContextualSaveBar,
  InlineGrid,
  Layout,
  Page,
  Text,
} from '@shopify/polaris';

export interface DetailSection {
  readonly id: string;
  readonly title?: string;
  readonly content: ReactNode;
  /** Sidebar sections carry status, publishing and organisation. */
  readonly placement?: 'main' | 'aside';
}

export interface DetailScreenProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly backAction?: { onAction(): void };
  readonly sections: readonly DetailSection[];
  readonly dirty: boolean;
  readonly saving?: boolean;
  onSave(): void;
  onDiscard(): void;
  readonly secondaryActions?: readonly { label: string; onAction(): void; destructive?: boolean }[];
  /**
   * Slot-rendered extensions (§31.8). Another module may contribute a card here
   * without touching this screen's code, and the aggregate stays owned by its
   * module.
   */
  readonly slotContent?: Readonly<Record<string, ReactNode>>;
}

export function DetailScreen({
  title,
  subtitle,
  backAction,
  sections,
  dirty,
  saving = false,
  onSave,
  onDiscard,
  secondaryActions = [],
  slotContent = {},
}: DetailScreenProps) {
  const main = sections.filter((section) => section.placement !== 'aside');
  const aside = sections.filter((section) => section.placement === 'aside');

  return (
    <>
      {dirty && (
        <ContextualSaveBar
          message="Unsaved changes"
          saveAction={{ onAction: onSave, loading: saving, disabled: saving }}
          discardAction={{ onAction: onDiscard }}
        />
      )}

      <Page
        title={title}
        subtitle={subtitle}
        backAction={backAction ? { content: 'Back', onAction: backAction.onAction } : undefined}
        secondaryActions={secondaryActions.map((action) => ({
          content: action.label,
          destructive: action.destructive,
          onAction: action.onAction,
        }))}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {slotContent.header}
              {main.map((section) => (
                <Card key={section.id}>
                  <BlockStack gap="300">
                    {section.title && (
                      <Text as="h2" variant="headingMd">
                        {section.title}
                      </Text>
                    )}
                    {section.content}
                  </BlockStack>
                </Card>
              ))}
              {slotContent.tabs}
              {slotContent.footer}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {aside.map((section) => (
                <Card key={section.id}>
                  <BlockStack gap="300">
                    {section.title && (
                      <Text as="h2" variant="headingMd">
                        {section.title}
                      </Text>
                    )}
                    {section.content}
                  </BlockStack>
                </Card>
              ))}
              {slotContent.sidebar}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}

/** Two-up grid used inside sections for paired fields (price / compare-at). */
export function FieldPair({ children }: { children: ReactNode }) {
  return <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">{children}</InlineGrid>;
}

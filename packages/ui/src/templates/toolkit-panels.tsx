/**
 * UI · templates/toolkit-panels.tsx
 * The Entity Toolkit rendered (§12.1). A detail screen asks which panels its
 * entity earned and drops them in; no module writes a metafield editor, a tag
 * input, an SEO preview or a timeline.
 * Layer: ui.
 */

import { useState } from 'react';

import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Link,
  Select,
  Tag,
  Text,
  TextField,
} from '@shopify/polaris';

// --- tags -------------------------------------------------------------------

export function TagsPanel({
  tags,
  onChange,
}: {
  tags: readonly string[];
  onChange(next: readonly string[]): void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      onChange([...tags, value]);
    }
    setDraft('');
  };

  return (
    <BlockStack gap="200">
      <TextField
        label="Tags"
        autoComplete="off"
        value={draft}
        onChange={setDraft}
        onBlur={add}
        connectedRight={<Button onClick={add}>Add</Button>}
      />
      <InlineStack gap="100" wrap>
        {tags.map((tag) => (
          <Tag key={tag} onRemove={() => onChange(tags.filter((entry) => entry !== tag))}>
            {tag}
          </Tag>
        ))}
      </InlineStack>
    </BlockStack>
  );
}

// --- metafields -------------------------------------------------------------

export interface MetafieldFieldProps {
  readonly definitionId: string;
  readonly label: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly description?: string | null;
  /** Category metafields come from the taxonomy, not the merchant. */
  readonly source: 'merchant' | 'category' | 'app';
  readonly value: string;
  readonly error?: string;
  readonly choices?: readonly string[];
  onChange(value: string): void;
}

export function MetafieldsPanel({
  title,
  fields,
}: {
  title: string;
  fields: readonly MetafieldFieldProps[];
}) {
  if (fields.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {fields.some((field) => field.source === 'category') && (
            <Badge tone="info">From category</Badge>
          )}
        </InlineStack>

        {/*
          A metafield's own `key` ("fabric") collides with React's reserved `key`
          prop, so spreading would silently overwrite the list key with the
          metafield name. Pass the field as one object instead.
        */}
        {fields.map((field) => (
          <MetafieldInput key={field.definitionId} field={field} />
        ))}
      </BlockStack>
    </Card>
  );
}

function MetafieldInput({ field }: { field: MetafieldFieldProps }) {
  const help = field.description ?? `${field.namespace}.${field.key}`;

  if (field.choices && field.choices.length > 0) {
    return (
      <Select
        label={field.label}
        helpText={help}
        error={field.error}
        options={field.choices.map((choice) => ({ label: choice, value: choice }))}
        value={field.value}
        onChange={field.onChange}
      />
    );
  }

  return (
    <TextField
      label={field.label}
      helpText={help}
      error={field.error}
      autoComplete="off"
      multiline={field.type === 'multi_line_text' ? 3 : undefined}
      type={field.type === 'integer' || field.type === 'decimal' ? 'number' : 'text'}
      value={field.value}
      onChange={field.onChange}
    />
  );
}

// --- SEO --------------------------------------------------------------------

export function SeoPanel({
  preview,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onEdit,
}: {
  preview: { title: string; url: string; description: string; warnings: readonly string[] };
  title: string;
  description: string;
  onTitleChange(value: string): void;
  onDescriptionChange(value: string): void;
  onEdit?(): void;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            Search engine listing
          </Text>
          {onEdit && <Button variant="plain" onClick={onEdit}>Edit</Button>}
        </InlineStack>

        {/* The preview is what the merchant is actually editing — show it first. */}
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="050">
            <Link url={preview.url} removeUnderline>
              {preview.title || 'Untitled'}
            </Link>
            <Text as="p" tone="subdued" variant="bodySm">
              {preview.url}
            </Text>
            <Text as="p" variant="bodySm">
              {preview.description || 'No description yet.'}
            </Text>
          </BlockStack>
        </Box>

        <TextField label="Page title" autoComplete="off" value={title} onChange={onTitleChange} />
        <TextField
          label="Meta description"
          autoComplete="off"
          multiline={3}
          value={description}
          onChange={onDescriptionChange}
        />

        {preview.warnings.map((warning) => (
          <Text key={warning} as="p" tone="caution" variant="bodySm">
            {warning}
          </Text>
        ))}
      </BlockStack>
    </Card>
  );
}

// --- translations -----------------------------------------------------------

export function TranslationsPanel({
  locales,
  activeLocale,
  entries,
  onLocaleChange,
  onChange,
}: {
  locales: readonly { value: string; label: string }[];
  activeLocale: string;
  entries: readonly { field: string; label: string; source: string; value: string; outdated: boolean }[];
  onLocaleChange(locale: string): void;
  onChange(field: string, value: string): void;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Translations
          </Text>
          <Box minWidth="180px">
            <Select label="" labelHidden options={[...locales]} value={activeLocale} onChange={onLocaleChange} />
          </Box>
        </InlineStack>

        {entries.map((entry) => (
          <BlockStack key={entry.field} gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                {entry.label}
              </Text>
              {/* Outdated means the source changed after this was translated. */}
              {entry.outdated && <Badge tone="attention">Needs review</Badge>}
            </InlineStack>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              <Text as="p" variant="bodySm" tone="subdued">
                {entry.source}
              </Text>
            </Box>
            <TextField
              label={entry.label}
              labelHidden
              autoComplete="off"
              value={entry.value}
              onChange={(value) => onChange(entry.field, value)}
            />
          </BlockStack>
        ))}
      </BlockStack>
    </Card>
  );
}

// --- timeline ---------------------------------------------------------------

export function TimelinePanel({
  entries,
  onComment,
}: {
  entries: readonly { id: string; actorLabel: string; message: string; occurredAt: string; kind: string }[];
  onComment(message: string): void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Timeline
        </Text>

        <TextField
          label="Leave a comment"
          labelHidden
          placeholder="Leave a comment…"
          autoComplete="off"
          value={draft}
          onChange={setDraft}
          connectedRight={
            <Button
              disabled={draft.trim().length === 0}
              onClick={() => {
                onComment(draft.trim());
                setDraft('');
              }}
            >
              Post
            </Button>
          }
        />

        <BlockStack gap="200">
          {entries.map((entry) => (
            <InlineStack key={entry.id} gap="200" blockAlign="start" wrap={false}>
              <Text as="span" tone="subdued" variant="bodySm">
                {entry.occurredAt}
              </Text>
              <Text as="span" variant="bodySm">
                <Text as="span" fontWeight="semibold">
                  {entry.actorLabel}
                </Text>{' '}
                {entry.message}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

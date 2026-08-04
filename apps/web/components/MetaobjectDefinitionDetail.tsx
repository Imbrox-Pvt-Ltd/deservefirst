'use client';

/**
 * Web · components/MetaobjectDefinitionDetail.tsx
 * A content type: the fields it has, and the entries that use them.
 *
 * The field list is deliberately conservative about editing. The API refuses to
 * remove a field, change its type, or add a required one while entries exist —
 * so this screen says so up front rather than letting someone build a change the
 * save will reject.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { saveDefinition } from '../app/actions/content';
import type {
  MetaobjectDefinitionDto,
  MetaobjectEntryDto,
  MetaobjectFieldDto,
  MetaobjectFieldType,
} from '../lib/types';

const FIELD_TYPES: { label: string; value: MetaobjectFieldType }[] = [
  { label: 'Text (single line)', value: 'single_line_text' },
  { label: 'Text (multi line)', value: 'multi_line_text' },
  { label: 'Rich text', value: 'rich_text' },
  { label: 'Whole number', value: 'integer' },
  { label: 'Decimal', value: 'decimal' },
  { label: 'True or false', value: 'boolean' },
  { label: 'Date', value: 'date' },
  { label: 'URL', value: 'url' },
];

export interface MetaobjectDefinitionDetailProps {
  readonly handle: string;
  readonly definition: MetaobjectDefinitionDto;
  readonly entries: readonly MetaobjectEntryDto[];
}

export function MetaobjectDefinitionDetail({
  handle,
  definition,
  entries,
}: MetaobjectDefinitionDetailProps) {
  const router = useRouter();
  const [fields, setFields] = useState<MetaobjectFieldDto[]>([...definition.fields]);
  const [name, setName] = useState(definition.name);
  const [displayKey, setDisplayKey] = useState(definition.displayNameKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const locked = entries.length > 0;
  const dirty =
    name !== definition.name ||
    displayKey !== (definition.displayNameKey ?? '') ||
    JSON.stringify(fields) !== JSON.stringify(definition.fields);

  const save = () =>
    startTransition(async () => {
      const result = await saveDefinition(handle, definition.id, definition.version, {
        name,
        fields,
        displayNameKey: displayKey || null,
      });
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error ?? 'Could not save');
      }
    });

  const addField = () =>
    setFields((current) => [
      ...current,
      {
        key: `field_${current.length + 1}`,
        name: `Field ${current.length + 1}`,
        type: 'single_line_text',
        // New fields start optional. The API refuses a required one while
        // entries exist, and offering it here would be offering a rejection.
        required: false,
        description: null,
      },
    ]);

  const patchField = (index: number, patch: Partial<MetaobjectFieldDto>) =>
    setFields((current) =>
      current.map((field, at) => (at === index ? { ...field, ...patch } : field)),
    );

  return (
    <Page
      title={definition.name}
      titleMetadata={<Badge>{definition.type}</Badge>}
      backAction={{
        content: 'Metaobjects',
        onAction: () => router.push(`/store/${handle}/content/metaobjects`),
      }}
      primaryAction={{ content: 'Save', disabled: !dirty, loading: pending, onAction: save }}
      secondaryActions={[
        {
          content: 'Add entry',
          onAction: () =>
            router.push(`/store/${handle}/content/metaobjects/${definition.id}/entries/new`),
        },
      ]}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {locked ? (
          <Banner tone="info" title={`${entries.length} ${entries.length === 1 ? 'entry uses' : 'entries use'} this type`}>
            <Text as="p">
              Existing fields cannot be removed or retyped, and a new field cannot start out
              required — that would leave entries nobody can save. Add it optional, fill it in, then
              require it.
            </Text>
          </Banner>
        ) : null}

        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <TextField label="Name" value={name} autoComplete="off" onChange={setName} disabled={pending} />
              <Select
                label="Entries are named by"
                options={fields.map((field) => ({ label: field.name, value: field.key }))}
                value={displayKey}
                onChange={setDisplayKey}
                disabled={pending}
                helpText="Which field's value identifies an entry in lists."
              />
            </BlockStack>
          </Box>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Fields</Text>
              <Button size="slim" onClick={addField} disabled={pending}>Add field</Button>
            </InlineStack>
          </Box>

          {fields.map((field, index) => {
            const existing = definition.fields.some((entry) => entry.key === field.key);
            return (
              <Box key={field.key} padding="400" borderBlockEndWidth="025" borderColor="border">
                <BlockStack gap="300">
                  <InlineStack gap="300" blockAlign="start">
                    <Box minWidth="240px">
                      <TextField
                        label="Name"
                        value={field.name}
                        autoComplete="off"
                        disabled={pending}
                        onChange={(value) => patchField(index, { name: value })}
                      />
                    </Box>
                    <Box minWidth="200px">
                      <TextField
                        label="Key"
                        value={field.key}
                        autoComplete="off"
                        // Renaming a key on a saved field orphans every stored
                        // value under the old name.
                        disabled={pending || existing}
                        onChange={(value) => patchField(index, { key: value })}
                        helpText={existing ? 'Fixed once saved' : 'lower_snake_case'}
                      />
                    </Box>
                    <Box minWidth="220px">
                      <Select
                        label="Type"
                        options={FIELD_TYPES}
                        value={field.type}
                        disabled={pending || (locked && existing)}
                        onChange={(value) =>
                          patchField(index, { type: value as MetaobjectFieldType })
                        }
                      />
                    </Box>
                  </InlineStack>

                  <Checkbox
                    label="Required"
                    checked={field.required}
                    disabled={pending || (locked && !existing)}
                    onChange={(value) => patchField(index, { required: value })}
                  />
                </BlockStack>
              </Box>
            );
          })}
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <Text as="h2" variant="headingSm">Entries</Text>
          </Box>

          {entries.length === 0 ? (
            <Box padding="500">
              <Text as="p" tone="subdued">No entries of this type yet.</Text>
            </Box>
          ) : (
            entries.map((entry) => (
              <Box key={entry.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Button
                      variant="plain"
                      onClick={() =>
                        router.push(
                          `/store/${handle}/content/metaobjects/${definition.id}/entries/${entry.id}`,
                        )
                      }
                    >
                      {entry.displayName}
                    </Button>
                    <Text as="span" tone="subdued" variant="bodySm">{entry.handle}</Text>
                  </BlockStack>
                  <Badge tone={entry.status === 'published' ? 'success' : 'info'}>
                    {entry.status}
                  </Badge>
                </InlineStack>
              </Box>
            ))
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

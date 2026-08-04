'use client';

/**
 * Web · components/MetaobjectEntryForm.tsx
 * The form for one entry, generated from its definition.
 *
 * There is no per-type form and there cannot be one: the types are invented by
 * merchants at runtime. This renders whatever the definition declares, which is
 * the whole point of storing definitions as data (§17.4) — a new content type
 * gets a working editor without anyone shipping code.
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
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { createEntry, saveEntry } from '../app/actions/content';
import type { MetaobjectDefinitionDto, MetaobjectEntryDto, MetaobjectFieldDto } from '../lib/types';

export interface MetaobjectEntryFormProps {
  readonly handle: string;
  readonly definition: MetaobjectDefinitionDto;
  /** Absent when creating. */
  readonly entry?: MetaobjectEntryDto;
}

export function MetaobjectEntryForm({ handle, definition, entry }: MetaobjectEntryFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      definition.fields.map((field) => [field.key, entry?.values[field.key] ?? defaultFor(field)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  const backPath = `/store/${handle}/content/metaobjects/${definition.id}`;

  const submit = () =>
    startTransition(async () => {
      const result = entry
        ? await saveEntry(handle, definition.id, entry.id, entry.version, { values })
        : await createEntry(handle, definition.id, values);

      if (result.ok) {
        setError(null);
        setConflict(false);
        router.push(entry ? backPath : `${backPath}/entries/${result.data?.id}`);
        router.refresh();
        return;
      }
      setError(result.error ?? 'Could not save');
      setConflict(Boolean(result.conflict));
    });

  const toggleStatus = () =>
    entry &&
    startTransition(async () => {
      const result = await saveEntry(handle, definition.id, entry.id, entry.version, {
        status: entry.status === 'published' ? 'draft' : 'published',
      });
      if (result.ok) router.refresh();
      else setError(result.error ?? 'Could not save');
    });

  return (
    <Page
      title={entry ? entry.displayName : `New ${definition.name.toLowerCase()}`}
      titleMetadata={
        entry ? (
          <Badge tone={entry.status === 'published' ? 'success' : 'info'}>{entry.status}</Badge>
        ) : undefined
      }
      backAction={{ content: definition.name, onAction: () => router.push(backPath) }}
      primaryAction={{ content: entry ? 'Save' : 'Create', loading: pending, onAction: submit }}
      secondaryActions={
        entry
          ? [{ content: entry.status === 'published' ? 'Unpublish' : 'Publish', onAction: toggleStatus }]
          : []
      }
    >
      <BlockStack gap="400">
        {error ? (
          <Banner
            tone={conflict ? 'warning' : 'critical'}
            title={conflict ? 'Someone else changed this entry' : 'Could not save'}
          >
            <Text as="p">{error}</Text>
            {conflict ? (
              <Box paddingBlockStart="200">
                <Button onClick={() => router.refresh()}>Reload</Button>
              </Box>
            ) : null}
          </Banner>
        ) : null}

        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              {definition.fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  disabled={pending}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.key]: value }))
                  }
                />
              ))}
            </BlockStack>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: MetaobjectFieldDto;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = field.required ? `${field.name} (required)` : field.name;
  const help = field.description ?? undefined;

  if (field.type === 'boolean') {
    return (
      <Checkbox
        label={label}
        helpText={help}
        checked={value === true}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.type === 'multi_line_text' || field.type === 'rich_text') {
    return (
      <TextField
        label={label}
        helpText={help}
        value={String(value ?? '')}
        multiline={6}
        autoComplete="off"
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const numeric = field.type === 'integer' || field.type === 'decimal';

  return (
    <TextField
      label={label}
      helpText={help}
      type={numeric ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={String(value ?? '')}
      autoComplete="off"
      disabled={disabled}
      onChange={(next) => {
        // Numbers cross the wire as numbers: the API validates integer and
        // decimal by type, so sending "12" as a string fails validation with a
        // message about the value not being a number, which reads as nonsense
        // next to a field showing 12.
        if (!numeric) return onChange(next);
        if (next.trim() === '') return onChange(null);
        const parsed = Number(next);
        onChange(Number.isNaN(parsed) ? next : parsed);
      }}
    />
  );
}

/** An empty value of the right shape, so the first render is not "undefined". */
function defaultFor(field: MetaobjectFieldDto): unknown {
  if (field.type === 'boolean') return false;
  return '';
}

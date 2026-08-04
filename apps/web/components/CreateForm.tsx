'use client';

/**
 * Web · components/CreateForm.tsx
 * The one create screen, rendered from a field list.
 *
 * It lands on the new record's detail screen rather than back on the list. The
 * merchant was in the middle of something — adding a product means adding its
 * variants and images next — and bouncing them to a list makes them find the
 * row they just made before they can carry on.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Banner,
  BlockStack,
  Box,
  Card,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { createRecord } from '../app/actions/create';
import { CREATE_FORMS, type CreateField, type CreateKind } from '../lib/create-forms';

export interface CreateFormProps {
  readonly kind: CreateKind;
  readonly handle: string;
  /** Options the page had to fetch, keyed by the field's `optionsFrom`. */
  readonly sources?: Readonly<Record<string, readonly { label: string; value: string }[]>>;
  /** The store's currency, for money fields. */
  readonly currency?: string;
}

export function CreateForm({ kind, handle, sources = {}, currency = 'USD' }: CreateFormProps) {
  const spec = CREATE_FORMS[kind];
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const field of spec.fields) {
      start[field.name] = initialValue(field, sources, start);
    }
    return start;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const optionsFor = (field: CreateField) =>
    field.optionsFrom ? (sources[field.optionsFrom] ?? []) : (field.options ?? []);

  const missing = spec.fields.filter(
    (field) => field.required && !(values[field.name] ?? '').trim(),
  );

  const submit = () =>
    startTransition(async () => {
      const result = await createRecord(kind, handle, { ...values, currency: values.currency ?? currency });
      if (result.ok && result.id) {
        router.push(spec.detailPath(handle, result.id));
        router.refresh();
        return;
      }
      setError(result.error ?? 'Could not create this record');
    });

  return (
    <Page
      title={spec.title}
      backAction={{ content: 'Back', onAction: () => router.push(spec.listPath(handle)) }}
      primaryAction={{
        content: spec.submitLabel,
        loading: pending,
        // Disabled rather than hidden, so it is obvious that something is
        // outstanding rather than that the button is missing.
        disabled: missing.length > 0,
        onAction: submit,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: () => router.push(spec.listPath(handle)) }]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error ? (
              <Banner tone="critical" title="Could not create this record">
                <Text as="p">{error}</Text>
              </Banner>
            ) : null}

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  {spec.fields.map((field) => {
                    const value = values[field.name] ?? '';
                    const onChange = (next: string) =>
                      setValues((current) => ({ ...current, [field.name]: next }));
                    const label = field.required ? `${field.label} (required)` : field.label;

                    if (field.kind === 'select') {
                      const options = optionsFor(field);
                      return (
                        <Select
                          key={field.name}
                          label={label}
                          helpText={
                            options.length === 0
                              ? 'Nothing to choose from yet — add one in Settings first.'
                              : field.helpText
                          }
                          options={options as { label: string; value: string }[]}
                          value={value}
                          disabled={pending || options.length === 0}
                          onChange={onChange}
                        />
                      );
                    }

                    return (
                      <TextField
                        key={field.name}
                        label={label}
                        helpText={field.helpText}
                        placeholder={field.placeholder}
                        value={value}
                        autoComplete="off"
                        disabled={pending}
                        onChange={onChange}
                        {...(field.kind === 'textarea' ? { multiline: 5 } : {})}
                        {...(field.kind === 'email' ? { type: 'email' as const } : {})}
                        {...(field.kind === 'date' ? { type: 'date' as const } : {})}
                        {...(field.kind === 'money'
                          ? { type: 'number' as const, prefix: currency }
                          : {})}
                      />
                    );
                  })}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/**
 * A select starts on its first option rather than blank.
 *
 * A required select showing nothing looks like a choice has been made until the
 * save is refused; every other field starts genuinely empty because there is no
 * sensible default for a name.
 */
function initialValue(
  field: CreateField,
  sources: Readonly<Record<string, readonly { label: string; value: string }[]>>,
  chosen: Readonly<Record<string, string>>,
): string {
  if (field.kind !== 'select') return '';
  const options = field.optionsFrom ? (sources[field.optionsFrom] ?? []) : (field.options ?? []);

  // A field that must differ from another starts on the first option that does.
  // Falling back to the first option when there is no second one is deliberate:
  // a store with one location genuinely cannot transfer, and the save says so
  // more clearly than a select that silently has nothing in it.
  if (field.distinctFrom) {
    const taken = chosen[field.distinctFrom];
    const distinct = options.find((option) => option.value !== taken);
    if (distinct) return distinct.value;
  }

  return options[0]?.value ?? '';
}

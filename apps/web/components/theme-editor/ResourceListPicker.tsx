'use client';

/**
 * Web · components/theme-editor/ResourceListPicker.tsx
 * The several products a section shows, in the order it shows them.
 *
 * `product_list` and `collection_list` were a textarea, one handle per line.
 * That is the single-value problem multiplied: a featured-products row means
 * remembering six slugs instead of one, and getting any of them wrong drops
 * that item from the row silently.
 *
 * Two things this has to do that the single picker does not:
 *
 * **Show what is already chosen, by name.** A stored list is handles, and six
 * slugs in a box tell a merchant nothing about what their homepage will show.
 * They are resolved to titles in one call when the field is drawn.
 *
 * **Let the order be changed.** For a list setting the order IS the layout —
 * it is what the row renders left to right. Arrows rather than dragging: this
 * is a list of three to eight items in a narrow panel, where a drag has further
 * to go wrong than a click, and the same arrows already move sections.
 * Layer: web.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';

import { Badge, BlockStack, Box, Button, InlineStack, Spinner, Text, TextField } from '@deservefirst/ui';

import {
  resolveThemeResources,
  searchThemeResources,
  type ResourceMatch,
} from '../../app/actions/theme-resources';

/** Which record a list setting is a list OF. */
const ELEMENT_TYPE: Readonly<Record<string, string>> = {
  product_list: 'product',
  collection_list: 'collection',
};

export function isPickableListType(type: string): boolean {
  return type in ELEMENT_TYPE;
}

export interface ResourceListPickerProps {
  readonly type: string;
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (handles: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly helpText?: string;
  /** The theme's own cap, when its schema declares one. */
  readonly limit?: number;
}

export function ResourceListPicker({
  type,
  label,
  value,
  onChange,
  disabled,
  helpText,
  limit,
}: ResourceListPickerProps) {
  const element = ELEMENT_TYPE[type] ?? 'product';

  const [chosen, setChosen] = useState<readonly ResourceMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly ResourceMatch[]>([]);
  const [resolving, startResolve] = useTransition();
  const [searching, startSearch] = useTransition();

  /**
   * Resolve the stored handles to titles when the list changes.
   *
   * Keyed on the joined handles rather than the array, because a new array with
   * the same contents is a different object every render — depending on the
   * array itself would resolve on every keystroke elsewhere in the panel.
   */
  const key = value.join(',');
  useEffect(() => {
    const handles = key === '' ? [] : key.split(',');
    if (handles.length === 0) {
      setChosen([]);
      return;
    }
    startResolve(async () => {
      const result = await resolveThemeResources(element, handles);
      /**
       * A handle the API did not return is kept, not dropped.
       *
       * It usually means the record was deleted or renamed — and quietly
       * removing it from the merchant's list would be this component editing
       * their theme on their behalf. Shown as unresolved instead, so they
       * decide.
       */
      const byHandle = new Map(result.matches.map((match) => [match.handle, match]));
      setChosen(
        handles.map(
          (handle) =>
            byHandle.get(handle) ?? {
              handle,
              title: handle,
              subtitle: 'not found in this store',
              published: false,
            },
        ),
      );
    });
  }, [key, element]);

  const search = useCallback(
    (query: string) => {
      startSearch(async () => {
        const result = await searchThemeResources(element, query);
        setMatches(result.matches);
      });
    },
    [element],
  );

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => search(term), 250);
    return () => clearTimeout(timer);
  }, [open, term, search]);

  const full = limit !== undefined && value.length >= limit;

  const move = (index: number, direction: -1 | 1) => {
    const next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    onChange(next);
  };

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodyMd" fontWeight="medium">
          {label}
        </Text>
        <Text as="span" variant="bodyXs" tone="subdued">
          {value.length}
          {limit !== undefined ? ` of ${limit}` : ''}
        </Text>
      </InlineStack>

      {helpText && (
        <Text as="p" variant="bodySm" tone="subdued">
          {helpText}
        </Text>
      )}

      {resolving && chosen.length === 0 && value.length > 0 && (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" variant="bodySm" tone="subdued">
            Loading…
          </Text>
        </InlineStack>
      )}

      <BlockStack gap="100">
        {chosen.map((match, index) => (
          <Box
            key={`${match.handle}-${index}`}
            background="bg-surface-secondary"
            padding="200"
            borderRadius="200"
          >
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <BlockStack gap="0">
                <Text as="span" variant="bodySm" fontWeight="medium">
                  {match.title}
                </Text>
                <Text as="span" variant="bodyXs" tone="subdued">
                  {match.handle}
                  {match.subtitle ? ` · ${match.subtitle}` : ''}
                </Text>
              </BlockStack>

              <InlineStack gap="100" blockAlign="center">
                {!match.published && <Badge tone="attention">Not published</Badge>}
                <Button
                  size="micro"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  accessibilityLabel={`Move ${match.title} earlier`}
                >
                  ↑
                </Button>
                <Button
                  size="micro"
                  disabled={disabled || index === chosen.length - 1}
                  onClick={() => move(index, 1)}
                  accessibilityLabel={`Move ${match.title} later`}
                >
                  ↓
                </Button>
                <Button
                  size="micro"
                  tone="critical"
                  variant="plain"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, at) => at !== index))}
                  accessibilityLabel={`Remove ${match.title}`}
                >
                  Remove
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>
        ))}
      </BlockStack>

      <InlineStack gap="200">
        <Button disabled={disabled || full} onClick={() => setOpen((current) => !current)}>
          {open ? 'Close' : `Add ${element}`}
        </Button>
        {full && (
          <Text as="span" variant="bodySm" tone="subdued">
            This section takes {limit}.
          </Text>
        )}
      </InlineStack>

      {open && (
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <BlockStack gap="200">
            <TextField
              label={`Search ${element}s`}
              labelHidden
              autoComplete="off"
              placeholder={`Search ${element}s by name or handle`}
              value={term}
              onChange={setTerm}
            />

            {searching && <Spinner size="small" />}

            {!searching && matches.length === 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                {term === '' ? `This store has no ${element}s yet.` : `Nothing matches “${term}”.`}
              </Text>
            )}

            {matches
              // Already in the list; offering it again is how duplicates happen.
              .filter((match) => !value.includes(match.handle))
              .map((match) => (
                <button
                  key={match.handle}
                  type="button"
                  onClick={() => {
                    onChange([...value, match.handle]);
                    setTerm('');
                  }}
                  style={{ all: 'unset', cursor: 'pointer', padding: '6px 8px', width: '100%' }}
                >
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {match.title}
                      </Text>
                      <Text as="span" variant="bodyXs" tone="subdued">
                        {match.handle}
                      </Text>
                    </BlockStack>
                    {!match.published && <Badge tone="attention">Not published</Badge>}
                  </InlineStack>
                </button>
              ))}
          </BlockStack>
        </Box>
      )}
    </BlockStack>
  );
}

'use client';

/**
 * Web · components/theme-editor/ResourcePicker.tsx
 * Choosing the product, collection or page a setting points at.
 *
 * What this replaces: a text field, labelled "Product handle", into which a
 * merchant typed a URL slug from memory. That works if you know the slug. If
 * you do not — and six months after naming a product nobody does — the only
 * route was to open the catalogue in another tab, find the product, read its
 * handle out of the address bar, and come back. The section renders empty until
 * you get it exactly right, and nothing tells you which character is wrong.
 *
 * Three decisions worth stating:
 *
 * **The field stays.** A merchant who knows the handle, or is pasting one from
 * a spreadsheet, should not be made to search for it. The picker is offered
 * beside the field rather than instead of it.
 *
 * **Unpublished records are listed and marked.** Hiding them would break
 * setting up a homepage before launch, which is when this is used most. A
 * section pointing at a draft renders empty, so the badge is the warning.
 *
 * **Nothing is searched until the picker is opened.** A settings panel with
 * twelve resource settings would otherwise fire twelve queries to populate
 * fields the merchant is not looking at.
 * Layer: web.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';

import { Badge, BlockStack, Box, Button, InlineStack, Spinner, Text, TextField } from '@deservefirst/ui';

import { searchThemeResources, type ResourceMatch } from '../../app/actions/theme-resources';

/** What each type is called where a merchant will recognise it. */
const NOUNS: Readonly<Record<string, string>> = {
  product: 'product',
  collection: 'collection',
  page: 'page',
  blog: 'blog',
  article: 'blog post',
  link_list: 'menu',
};

export interface ResourcePickerProps {
  readonly type: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (handle: string) => void;
  readonly disabled?: boolean;
  readonly helpText?: string;
}

export function ResourcePicker({
  type,
  label,
  value,
  onChange,
  disabled,
  helpText,
}: ResourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly ResourceMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = NOUNS[type] ?? 'record';

  const search = useCallback(
    (query: string) => {
      startTransition(async () => {
        const result = await searchThemeResources(type, query);
        setMatches(result.matches);
        setError(result.ok ? null : (result.error ?? null));
      });
    },
    [type],
  );

  /**
   * Debounced, because this fires on every keystroke.
   *
   * 250ms is long enough that typing a word is one query rather than five, and
   * short enough that it still feels like a type-ahead. The timer is cleared on
   * every change, so only the last keystroke in a burst searches.
   */
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => search(term), 250);
    return () => clearTimeout(timer);
  }, [open, term, search]);

  return (
    <BlockStack gap="150">
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete="off"
        helpText={helpText}
        placeholder={`${noun} handle`}
        // The merchant's own escape hatch: paste a handle and never open the
        // picker at all.
        connectedRight={
          <Button disabled={disabled} onClick={() => setOpen((current) => !current)}>
            {open ? 'Close' : 'Browse'}
          </Button>
        }
      />

      {open && (
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <BlockStack gap="200">
            <TextField
              label={`Search ${noun}s`}
              labelHidden
              autoComplete="off"
              placeholder={`Search ${noun}s by name or handle`}
              value={term}
              onChange={setTerm}
            />

            {pending && (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="span" variant="bodySm" tone="subdued">
                  Searching…
                </Text>
              </InlineStack>
            )}

            {error && (
              <Text as="p" variant="bodySm" tone="critical">
                {error} You can still type the handle above.
              </Text>
            )}

            {!pending && !error && matches.length === 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                {term === ''
                  ? `This store has no ${noun}s yet.`
                  : `No ${noun} matches “${term}”.`}
              </Text>
            )}

            <BlockStack gap="100">
              {matches.map((match) => (
                <button
                  key={match.handle}
                  type="button"
                  onClick={() => {
                    onChange(match.handle);
                    setOpen(false);
                    setTerm('');
                  }}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 6,
                    width: '100%',
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {match.title}
                      </Text>
                      {/* The handle is shown because it is what gets stored,
                          and a merchant checking their work looks for it. */}
                      <Text as="span" variant="bodyXs" tone="subdued">
                        {match.handle}
                        {match.subtitle ? ` · ${match.subtitle}` : ''}
                      </Text>
                    </BlockStack>
                    {!match.published && <Badge tone="attention">Not published</Badge>}
                  </InlineStack>
                </button>
              ))}
            </BlockStack>
          </BlockStack>
        </Box>
      )}
    </BlockStack>
  );
}

/** Whether this setting type picks a record the editor can search for. */
export function isPickableType(type: string): boolean {
  return type in NOUNS;
}

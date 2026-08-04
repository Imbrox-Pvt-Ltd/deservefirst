'use client';

/**
 * Web · components/ProductVariants.tsx
 * Option sets and the variant matrix they generate.
 *
 * Options and variants are edited as two separate saves because they are two
 * different kinds of change: which combinations EXIST follows from the options,
 * while each one's price and SKU is per-variant data. Letting a variant row add
 * a combination would let the two disagree, and the API refuses it for the same
 * reason.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Tag,
  Text,
  TextField,
} from '@deservefirst/ui';

import { saveVariants, setProductOptions } from '../app/actions/products';
import type { ProductDto, ProductVariantDto } from '../lib/types';

interface OptionDraft {
  readonly name: string;
  readonly values: string[];
}

export function ProductVariants({ handle, product }: { handle: string; product: ProductDto }) {
  const router = useRouter();

  const [options, setOptions] = useState<OptionDraft[]>(() => optionsFrom(product));
  const [rows, setRows] = useState<ProductVariantDto[]>(() => [...product.variants]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const optionsDirty = JSON.stringify(options) !== JSON.stringify(optionsFrom(product));
  const rowsDirty = JSON.stringify(rows) !== JSON.stringify(product.variants);

  /** Combinations that would disappear if the options were saved as drafted. */
  const losing = product.variants.filter(
    (variant) => !survives(variant, options, product.optionNames),
  );

  const report = (result: { ok: boolean; error?: string }) => {
    if (result.ok) {
      setError(null);
      router.refresh();
    } else {
      setError(result.error ?? 'Could not save');
    }
  };

  const applyOptions = () =>
    startTransition(async () => {
      report(
        await setProductOptions(
          handle,
          product.id,
          product.version,
          options
            .filter((option) => option.name.trim() !== '' && option.values.length > 0)
            .map((option) => ({ name: option.name.trim(), values: option.values })),
        ),
      );
    });

  const applyRows = () =>
    startTransition(async () => {
      report(
        await saveVariants(
          handle,
          product.id,
          product.version,
          rows.map((row) => ({
            id: row.id,
            sku: row.sku,
            price: row.price,
            inventoryQuantity: row.inventoryQuantity,
          })),
        ),
      );
    });

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not save">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Options</Text>
              {options.length < 3 ? (
                <Button
                  size="slim"
                  disabled={pending}
                  onClick={() => setOptions((current) => [...current, { name: '', values: [] }])}
                >
                  Add option
                </Button>
              ) : null}
            </InlineStack>

            {options.length === 0 ? (
              <Text as="p" tone="subdued">
                This product has one version. Add an option — Size, Colour — to sell variants of it.
              </Text>
            ) : (
              options.map((option, index) => (
                <OptionRow
                  key={index}
                  option={option}
                  disabled={pending}
                  onChange={(next) =>
                    setOptions((current) => current.map((entry, at) => (at === index ? next : entry)))
                  }
                  onRemove={() =>
                    setOptions((current) => current.filter((_, at) => at !== index))
                  }
                />
              ))
            )}

            {losing.length > 0 ? (
              <Banner tone="warning" title={`${losing.length} ${losing.length === 1 ? 'variant' : 'variants'} will be removed`}>
                <Text as="p">
                  {losing.map((variant) => describe(variant, product.optionNames)).join(', ')} —
                  their prices and stock go with them. Everything else keeps what it has.
                </Text>
              </Banner>
            ) : null}

            {optionsDirty ? (
              <InlineStack gap="200">
                <Button variant="primary" loading={pending} onClick={applyOptions}>
                  Save options
                </Button>
                <Button disabled={pending} onClick={() => setOptions(optionsFrom(product))}>
                  Discard
                </Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        </Box>
      </Card>

      {product.variants.length > 0 ? (
        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">
                Variants <Badge>{String(product.variants.length)}</Badge>
              </Text>
              {rowsDirty ? (
                <Button size="slim" variant="primary" loading={pending} onClick={applyRows}>
                  Save variants
                </Button>
              ) : null}
            </InlineStack>
          </Box>

          {/* Column headings once, rather than a label on all six rows. */}
          <Box padding="300" paddingInlineStart="400" paddingInlineEnd="400" background="bg-surface-secondary">
            <div style={VARIANT_GRID}>
              <Text as="span" variant="bodySm" tone="subdued">Variant</Text>
              <Text as="span" variant="bodySm" tone="subdued">SKU</Text>
              <Text as="span" variant="bodySm" tone="subdued">Price</Text>
              <Text as="span" variant="bodySm" tone="subdued">Available</Text>
            </div>
          </Box>

          {rows.map((row, index) => (
            <Box key={row.id} padding="400" borderBlockEndWidth="025" borderColor="border">
              <div style={VARIANT_GRID}>
                <Text as="span" fontWeight="semibold">
                  {describe(row, product.optionNames)}
                </Text>

                <TextField
                  label="SKU"
                  labelHidden
                  value={row.sku ?? ''}
                  autoComplete="off"
                  disabled={pending}
                  onChange={(value) =>
                    setRows((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, sku: value || null } : entry,
                      ),
                    )
                  }
                />

                <TextField
                  label="Price"
                  labelHidden
                  type="number"
                  prefix={row.price.currency}
                  value={row.price.amount}
                  autoComplete="off"
                  disabled={pending}
                  onChange={(value) =>
                    setRows((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, price: { ...entry.price, amount: value } } : entry,
                      ),
                    )
                  }
                />

                <TextField
                  label="Available"
                  labelHidden
                  type="number"
                  value={String(row.inventoryQuantity)}
                  autoComplete="off"
                  disabled={pending}
                  onChange={(value) =>
                    setRows((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, inventoryQuantity: Number(value) || 0 } : entry,
                      ),
                    )
                  }
                />
              </div>
            </Box>
          ))}
        </Card>
      ) : null}
    </BlockStack>
  );
}

function OptionRow({
  option,
  disabled,
  onChange,
  onRemove,
}: {
  option: OptionDraft;
  disabled: boolean;
  onChange: (next: OptionDraft) => void;
  onRemove: () => void;
}) {
  const [entry, setEntry] = useState('');

  const add = () => {
    const value = entry.trim();
    if (!value) return;
    // Case-insensitive, because "Red" and "red" are the same option to a buyer
    // and the API refuses the pair anyway.
    if (option.values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setEntry('');
      return;
    }
    onChange({ ...option, values: [...option.values, value] });
    setEntry('');
  };

  return (
    <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
      <BlockStack gap="300">
        <InlineStack gap="300" blockAlign="end">
          <Box minWidth="220px">
            <TextField
              label="Option name"
              value={option.name}
              placeholder="Size"
              autoComplete="off"
              disabled={disabled}
              onChange={(value) => onChange({ ...option, name: value })}
            />
          </Box>
          <Button variant="plain" tone="critical" disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        </InlineStack>

        <InlineStack gap="150" wrap>
          {option.values.map((value) => (
            <Tag
              key={value}
              onRemove={
                disabled
                  ? undefined
                  : () => onChange({ ...option, values: option.values.filter((v) => v !== value) })
              }
            >
              {value}
            </Tag>
          ))}
        </InlineStack>

        <InlineStack gap="200" blockAlign="end">
          <Box minWidth="220px">
            <TextField
              label="Add a value"
              labelHidden
              value={entry}
              placeholder="Small"
              autoComplete="off"
              disabled={disabled}
              onChange={setEntry}
            />
          </Box>
          <Button size="slim" disabled={disabled || !entry.trim()} onClick={add}>
            Add
          </Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

/**
 * The variant row's column track, shared by the heading row.
 *
 * Fractional rather than fixed widths: this card sits in the two-thirds column
 * of the product screen, and fixed minimums overflowed it — the Available field
 * was cut off the right-hand edge.
 */
const VARIANT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 1.3fr) 1.4fr 1.2fr 0.9fr',
  gap: 12,
  alignItems: 'center',
};

/** Rebuilds the editable option drafts from what the product currently has. */
function optionsFrom(product: ProductDto): OptionDraft[] {
  return product.optionNames.map((name) => ({
    name,
    values: [
      ...new Set(
        product.variants
          .map((variant) => variant.optionValues[name])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ],
  }));
}

/** "Small / Red" — the combination, in the order the options are declared. */
function describe(variant: ProductVariantDto, optionNames: readonly string[]): string {
  const parts = optionNames.map((name) => variant.optionValues[name]).filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Default';
}

/** Whether a variant's combination still exists under the drafted options. */
function survives(
  variant: ProductVariantDto,
  options: readonly OptionDraft[],
  optionNames: readonly string[],
): boolean {
  const named = options.filter((option) => option.name.trim() !== '' && option.values.length > 0);
  // Removing every option collapses the product to one version, so nothing
  // survives as a variant — that is a removal, not a loss to warn about twice.
  if (named.length === 0) return false;

  return named.every((option) => {
    const current = variant.optionValues[option.name];
    // A newly added option has no counterpart on existing variants, so it cannot
    // be what removes them.
    if (!optionNames.includes(option.name)) return true;
    return current !== undefined && option.values.includes(current);
  });
}

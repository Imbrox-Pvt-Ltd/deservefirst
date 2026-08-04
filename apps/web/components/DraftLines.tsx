'use client';

/**
 * Web · components/DraftLines.tsx
 * What is being ordered, or sent, while the paperwork is still a draft.
 *
 * Only a draft can be edited here, and the API refuses the call once it is not.
 * That is not a UI convenience: once a purchase order is placed, its line ids
 * are what receipts are recorded against, and once a transfer ships the stock
 * has physically left. In both cases the lines stop being a plan and become a
 * record of something that happened.
 *
 * Lines are replaced wholesale on save, matching the API. A per-line endpoint
 * would let a screen leave a draft half-edited between two calls.
 * Layer: web.
 */

import { useState, useTransition } from 'react';

import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

export interface DraftLine {
  readonly productId: string;
  readonly title: string;
  readonly quantity: number;
}

export interface DraftLinesProps {
  readonly heading: string;
  /** What one line's quantity is called here — "Ordered" or "Sending". */
  readonly quantityLabel: string;
  readonly products: readonly { id: string; title: string }[];
  readonly lines: readonly DraftLine[];
  readonly onSave: (lines: readonly DraftLine[]) => Promise<{ ok: boolean; error?: string }>;
  readonly onSaved: () => void;
}

export function DraftLines({
  heading,
  quantityLabel,
  products,
  lines,
  onSave,
  onSaved,
}: DraftLinesProps) {
  const [draft, setDraft] = useState<DraftLine[]>(() => [...lines]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(lines);
  const options = products.map((product) => ({ label: product.title, value: product.id }));

  const add = () => {
    const first = products[0];
    if (!first) return;
    setDraft((current) => [
      ...current,
      { productId: first.id, title: first.title, quantity: 1 },
    ]);
  };

  const patch = (index: number, next: Partial<DraftLine>) =>
    setDraft((current) =>
      current.map((line, at) => (at === index ? { ...line, ...next } : line)),
    );

  const save = () =>
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) {
        setError(null);
        onSaved();
      } else {
        setError(result.error ?? 'Could not save these lines');
      }
    });

  return (
    <Card padding="0">
      <Box padding="400" borderBlockEndWidth="025" borderColor="border">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingSm">{heading}</Text>
          <InlineStack gap="200">
            {dirty ? (
              <Button size="slim" variant="primary" loading={pending} onClick={save}>
                Save lines
              </Button>
            ) : null}
            <Button size="slim" disabled={pending || products.length === 0} onClick={add}>
              Add line
            </Button>
          </InlineStack>
        </InlineStack>
      </Box>

      {error ? (
        <Box padding="400" borderBlockEndWidth="025" borderColor="border">
          <Banner tone="critical" title="Could not save these lines">
            <Text as="p">{error}</Text>
          </Banner>
        </Box>
      ) : null}

      {products.length === 0 ? (
        <Box padding="500">
          <Text as="p" tone="subdued">
            There are no products to add yet. Create one first, and it will be selectable here.
          </Text>
        </Box>
      ) : draft.length === 0 ? (
        <Box padding="500">
          <Text as="p" tone="subdued">
            Nothing on it yet. Add a line to say what is being {quantityLabel.toLowerCase()}.
          </Text>
        </Box>
      ) : (
        draft.map((line, index) => (
          <Box key={index} padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack gap="300" blockAlign="end" wrap={false}>
              <Box minWidth="320px">
                <Select
                  label="Product"
                  labelHidden={index > 0}
                  options={options}
                  value={line.productId}
                  disabled={pending}
                  onChange={(productId) =>
                    patch(index, {
                      productId,
                      // The title is stored on the line, not looked up later: a
                      // product renamed or deleted after the fact must not
                      // rewrite what was ordered.
                      title: products.find((p) => p.id === productId)?.title ?? line.title,
                    })
                  }
                />
              </Box>

              <Box minWidth="120px">
                <TextField
                  label={quantityLabel}
                  labelHidden={index > 0}
                  type="number"
                  min={1}
                  value={String(line.quantity)}
                  autoComplete="off"
                  disabled={pending}
                  onChange={(value) => patch(index, { quantity: Number(value) || 0 })}
                />
              </Box>

              <Button
                variant="plain"
                tone="critical"
                disabled={pending}
                onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
              >
                Remove
              </Button>
            </InlineStack>
          </Box>
        ))
      )}
    </Card>
  );
}

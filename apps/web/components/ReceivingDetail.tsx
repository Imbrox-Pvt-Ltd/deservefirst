'use client';

/**
 * Web · components/ReceivingDetail.tsx
 * Purchase orders and transfers share this screen.
 *
 * They are the same interaction: a list of lines, a quantity that arrived, and a
 * state machine of three or four steps. Building them twice would mean two
 * places to fix the next time someone discovers that typing the total is safer
 * than typing the increment — so the difference between them is expressed as
 * data at the bottom of this file, not as a second component.
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
  ButtonGroup,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { purchaseOrderAction, transferAction } from '../app/actions/inventory';
import type { ReceivingLine } from '../lib/receiving';
import type { LocationDto, PurchaseOrderDto, TransferDto } from '../lib/types';

type Status = PurchaseOrderDto['status'] | TransferDto['status'];

const TONE: Partial<Record<Status, 'success' | 'info' | 'attention' | 'critical'>> = {
  draft: 'info',
  ordered: 'attention',
  'in-transit': 'attention',
  partial: 'attention',
  received: 'success',
  cancelled: undefined as never,
};

export interface ReceivingDetailProps {
  readonly kind: 'purchase-order' | 'transfer';
  readonly handle: string;
  readonly id: string;
  readonly reference: string;
  readonly status: Status;
  readonly version: number;
  readonly lines: readonly ReceivingLine[];
  readonly locations: readonly LocationDto[];
  readonly summary: readonly { label: string; value: string }[];
  readonly backPath: string;
}

export function ReceivingDetail(props: ReceivingDetailProps) {
  const router = useRouter();
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(props.lines.map((line) => [line.id, String(line.received)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  const canReceive = props.kind === 'purchase-order'
    ? props.status === 'ordered' || props.status === 'partial'
    : props.status === 'in-transit';

  const run = (action: 'place' | 'ship' | 'receive' | 'cancel') => {
    setError(null);
    setConflict(false);

    const lines =
      action === 'receive'
        ? props.lines.map((line) => ({
            lineId: line.id,
            // Cumulative totals, not increments: this is what the person
            // checking the delivery is looking at, and submitting the form
            // twice must not book the goods in twice.
            received: Number(received[line.id] ?? line.received),
          }))
        : [];

    startTransition(async () => {
      const result =
        props.kind === 'purchase-order'
          ? await purchaseOrderAction(
              props.handle,
              props.id,
              action === 'ship' ? 'place' : (action as 'place' | 'receive' | 'cancel'),
              props.version,
              lines,
            )
          : await transferAction(
              props.handle,
              props.id,
              action === 'place' ? 'ship' : (action as 'ship' | 'receive' | 'cancel'),
              props.version,
              lines,
            );

      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error ?? 'Could not save');
      setConflict(Boolean(result.conflict));
    });
  };

  const advance = props.kind === 'purchase-order'
    ? { label: 'Mark as ordered', action: 'place' as const, when: props.status === 'draft' }
    : { label: 'Mark as shipped', action: 'ship' as const, when: props.status === 'draft' };

  const outstanding = props.lines.reduce(
    (total, line) => total + Math.max(0, line.expected - Number(received[line.id] ?? line.received)),
    0,
  );

  return (
    <Page
      title={props.reference}
      titleMetadata={<Badge tone={TONE[props.status]}>{props.status.replace('-', ' ')}</Badge>}
      backAction={{ content: 'Back', onAction: () => router.push(props.backPath) }}
      primaryAction={
        advance.when
          ? { content: advance.label, loading: pending, onAction: () => run(advance.action) }
          : canReceive
            ? { content: 'Receive stock', loading: pending, onAction: () => run('receive') }
            : undefined
      }
      secondaryActions={
        props.status === 'received' || props.status === 'cancelled'
          ? []
          : [{ content: 'Cancel', destructive: true, onAction: () => run('cancel') }]
      }
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone={conflict ? 'warning' : 'critical'} title={conflict ? 'Someone else changed this' : 'Could not save'}>
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
            <InlineStack gap="600">
              {props.summary.map((item) => (
                <BlockStack gap="050" key={item.label}>
                  <Text as="span" tone="subdued" variant="bodySm">{item.label}</Text>
                  <Text as="span" fontWeight="semibold">{item.value}</Text>
                </BlockStack>
              ))}
            </InlineStack>
          </Box>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <Text as="h2" variant="headingSm">
              {props.kind === 'purchase-order' ? 'Ordered' : 'Sending'}
            </Text>
          </Box>

          {props.lines.length === 0 ? (
            <Box padding="500">
              <Text as="p" tone="subdued">No lines yet.</Text>
            </Box>
          ) : (
            props.lines.map((line) => (
              <Box key={line.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack gap="400" blockAlign="center" align="space-between">
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold">{line.title}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {line.received} of {line.expected} received
                    </Text>
                  </BlockStack>

                  <Box minWidth="120px">
                    <TextField
                      label="Received"
                      type="number"
                      value={received[line.id] ?? String(line.received)}
                      autoComplete="off"
                      disabled={!canReceive || pending}
                      min={0}
                      max={line.expected}
                      helpText={canReceive ? 'Total received' : undefined}
                      onChange={(value) =>
                        setReceived((current) => ({ ...current, [line.id]: value }))
                      }
                    />
                  </Box>
                </InlineStack>
              </Box>
            ))
          )}

          {props.lines.length > 0 ? (
            <Box padding="400">
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">Outstanding</Text>
                <Text as="span" fontWeight="semibold">{outstanding}</Text>
              </InlineStack>
            </Box>
          ) : null}
        </Card>

        {props.status === 'received' ? (
          <Banner tone="success" title="Complete">
            <Text as="p">
              Stock has been added at its destination and recorded in the adjustment log.
            </Text>
          </Banner>
        ) : null}
      </BlockStack>
    </Page>
  );
}


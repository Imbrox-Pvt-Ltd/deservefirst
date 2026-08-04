'use client';

/**
 * Web · components/SegmentDetail.tsx
 * A segment: its conditions, and who currently matches them.
 *
 * The member list is shown as a SAMPLE with a live count, not as the segment's
 * contents, because a segment has no contents — it has a question and whatever
 * currently answers it. Presenting a stored-looking list is how people come to
 * believe membership was captured at a moment in time.
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
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { saveSegment } from '../app/actions/segments';
import type { CustomerDto, SegmentConditionDto, SegmentDto } from '../lib/types';

const FIELDS = [
  { label: 'Email subscription', value: 'emailConsent' },
  { label: 'Account state', value: 'state' },
  { label: 'Country', value: 'countryCode' },
  { label: 'Number of orders', value: 'ordersCount' },
  { label: 'Total spent', value: 'totalSpent' },
  { label: 'Tag', value: 'tag' },
];

const OPERATORS = [
  { label: 'is', value: 'equals' },
  { label: 'is not', value: 'notEquals' },
  { label: 'is more than', value: 'greaterThan' },
  { label: 'is less than', value: 'lessThan' },
];

export interface SegmentDetailProps {
  readonly handle: string;
  readonly segment: SegmentDto;
  readonly members: readonly CustomerDto[];
}

export function SegmentDetail({ handle, segment, members }: SegmentDetailProps) {
  const router = useRouter();
  const [name, setName] = useState(segment.name);
  const [match, setMatch] = useState<'all' | 'any'>(segment.match);
  const [conditions, setConditions] = useState<SegmentConditionDto[]>([...segment.conditions]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== segment.name ||
    match !== segment.match ||
    JSON.stringify(conditions) !== JSON.stringify(segment.conditions);

  const save = () =>
    startTransition(async () => {
      const result = await saveSegment(handle, segment.id, segment.version, {
        name,
        match,
        conditions,
      });
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error ?? 'Could not save this segment');
      }
    });

  const patch = (index: number, next: Partial<SegmentConditionDto>) =>
    setConditions((current) =>
      current.map((condition, at) => (at === index ? { ...condition, ...next } : condition)),
    );

  return (
    <Page
      title={segment.name}
      titleMetadata={
        <Badge tone="info">
          {segment.count === undefined
            ? 'counting…'
            : `${segment.count}${segment.capped ? '+' : ''} customers`}
        </Badge>
      }
      backAction={{
        content: 'Segments',
        onAction: () => router.push(`/store/${handle}/customers/segments`),
      }}
      primaryAction={{ content: 'Save', disabled: !dirty, loading: pending, onAction: save }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save this segment">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <TextField label="Name" value={name} autoComplete="off" disabled={pending} onChange={setName} />
              <Select
                label="Customers must match"
                options={[
                  { label: 'all of these conditions', value: 'all' },
                  { label: 'any of these conditions', value: 'any' },
                ]}
                value={match}
                disabled={pending}
                onChange={(value) => setMatch(value as 'all' | 'any')}
              />
            </BlockStack>
          </Box>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Conditions</Text>
              <Button
                size="slim"
                disabled={pending}
                onClick={() =>
                  setConditions((current) => [
                    ...current,
                    { field: 'emailConsent', operator: 'equals', value: 'subscribed' },
                  ])
                }
              >
                Add condition
              </Button>
            </InlineStack>
          </Box>

          {conditions.map((condition, index) => (
            <Box key={index} padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="300" blockAlign="end" wrap={false}>
                <Box minWidth="220px">
                  <Select
                    label="Field"
                    labelHidden={index > 0}
                    options={FIELDS}
                    value={condition.field}
                    disabled={pending}
                    onChange={(value) => patch(index, { field: value })}
                  />
                </Box>
                <Box minWidth="160px">
                  <Select
                    label="Is"
                    labelHidden={index > 0}
                    options={OPERATORS}
                    value={condition.operator}
                    disabled={pending}
                    onChange={(value) => patch(index, { operator: value as never })}
                  />
                </Box>
                <Box minWidth="200px">
                  <TextField
                    label="Value"
                    labelHidden={index > 0}
                    value={condition.value}
                    autoComplete="off"
                    disabled={pending}
                    onChange={(value) => patch(index, { value })}
                  />
                </Box>
                <Button
                  variant="plain"
                  tone="critical"
                  disabled={pending}
                  onClick={() => setConditions((current) => current.filter((_, at) => at !== index))}
                >
                  Remove
                </Button>
              </InlineStack>
            </Box>
          ))}
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <BlockStack gap="100">
              <Text as="h2" variant="headingSm">Who matches right now</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Worked out when you open this page. A segment stores the question, not the answer,
                so this changes as customers do.
              </Text>
            </BlockStack>
          </Box>

          {members.length === 0 ? (
            <Box padding="500">
              <Text as="p" tone="subdued">Nobody matches these conditions today.</Text>
            </Box>
          ) : (
            members.map((customer) => (
              <Box key={customer.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center">
                  <Button
                    variant="plain"
                    onClick={() => router.push(`/store/${handle}/customers/${customer.id}`)}
                  >
                    {customer.displayName}
                  </Button>
                  <Text as="span" tone="subdued" variant="bodySm">{customer.email ?? '—'}</Text>
                </InlineStack>
              </Box>
            ))
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

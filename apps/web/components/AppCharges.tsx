'use client';

/**
 * Web · components/AppCharges.tsx
 * What apps are asking this store to pay, and what it already pays.
 *
 * Pending charges lead, because they are the only rows that need a decision and
 * the only ones where doing nothing has a cost — an app waiting on approval is
 * an app not working. Everything else is a record.
 *
 * The amount is stated before the button, in full, with the interval and the
 * trial. A merchant approving "Pro plan" should not have to open anything to
 * find out it is $29 a month after fourteen days.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  InlineStack,
  SettingsCard,
  Text,
} from '@deservefirst/ui';

import { decideCharge } from '../app/actions/billing';
import type { AppChargeDto } from '../lib/types';

const TONE = {
  pending: 'attention',
  active: 'success',
  declined: undefined,
  cancelled: undefined,
  expired: undefined,
} as const;

function priceLine(charge: AppChargeDto): string {
  const price = `${charge.price.amount} ${charge.price.currency}`;

  if (charge.kind === 'usage') {
    return `Up to ${charge.cappedAmount?.amount ?? '—'} ${charge.price.currency} per period, charged on use`;
  }
  if (charge.kind === 'one_time') return `${price}, once`;

  const every = charge.interval === 'annual' ? 'a year' : 'every 30 days';
  return charge.trialDays > 0
    ? `${price} ${every}, after a ${charge.trialDays}-day free trial`
    : `${price} ${every}`;
}

export function AppCharges({
  handle,
  charges,
  canApprove,
}: {
  readonly handle: string;
  readonly charges: readonly AppChargeDto[];
  readonly canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (chargeId: string, decision: 'approve' | 'decline' | 'cancel') =>
    startTransition(async () => {
      setError(null);
      const result = await decideCharge(handle, chargeId, decision);
      if (!result.ok) {
        setError(result.error ?? 'Could not do that');
        return;
      }
      router.refresh();
    });

  const waiting = charges.filter((charge) => charge.status === 'pending');
  const running = charges.filter((charge) => charge.status === 'active');
  const past = charges.filter(
    (charge) => charge.status !== 'pending' && charge.status !== 'active',
  );

  const row = (charge: AppChargeDto, actions: React.ReactNode) => (
    <BlockStack key={charge.id} gap="200">
      <InlineStack align="space-between" blockAlign="start" gap="200">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" fontWeight="medium">
              {charge.name}
            </Text>
            <Badge tone={TONE[charge.status]}>{charge.status}</Badge>
            {charge.isTest ? <Badge>Test — nothing is billed</Badge> : null}
          </InlineStack>

          {/* Stated in full before the decision, not behind a link. */}
          <Text as="span" tone="subdued">
            {priceLine(charge)}
          </Text>

          {charge.status === 'active' && charge.kind === 'usage' ? (
            <Text as="span" tone="subdued" variant="bodySm">
              {charge.balanceUsed.amount} used this period · {charge.remaining?.amount ?? '—'} left
            </Text>
          ) : null}
          {charge.status === 'active' && charge.due.amount !== '0.00' ? (
            <Text as="span" tone="subdued" variant="bodySm">
              Due now: {charge.due.amount} {charge.due.currency}
            </Text>
          ) : null}
        </BlockStack>
        {actions}
      </InlineStack>
    </BlockStack>
  );

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not do that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      {waiting.length > 0 ? (
        <SettingsCard title="Waiting for you">
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              These apps have asked to charge your store. Nothing is billed until you approve.
            </Text>
            {waiting.map((charge) =>
              row(
                charge,
                canApprove ? (
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={() => run(charge.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button disabled={pending} onClick={() => run(charge.id, 'decline')}>
                      Decline
                    </Button>
                  </InlineStack>
                ) : null,
              ),
            )}
          </BlockStack>
        </SettingsCard>
      ) : null}

      <SettingsCard title="Active charges">
        <BlockStack gap="400">
          {running.length === 0 ? (
            <Text as="p" tone="subdued">
              No app is charging this store.
            </Text>
          ) : (
            running.map((charge) =>
              row(
                charge,
                canApprove ? (
                  <Button
                    variant="plain"
                    tone="critical"
                    disabled={pending}
                    onClick={() => run(charge.id, 'cancel')}
                  >
                    Cancel
                  </Button>
                ) : null,
              ),
            )
          )}
        </BlockStack>
      </SettingsCard>

      {past.length > 0 ? (
        <SettingsCard title="Past">
          <BlockStack gap="400">{past.map((charge) => row(charge, null))}</BlockStack>
        </SettingsCard>
      ) : null}
    </BlockStack>
  );
}

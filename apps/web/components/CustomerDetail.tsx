'use client';

/**
 * Web · components/CustomerDetail.tsx
 * Consent is edited through its own control, not as a field on the form. That
 * mirrors the service: a consent change is legally meaningful, carries a
 * before/after, and must not be changeable by a generic save.
 * Layer: web.
 */

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Text,
  TextField,
} from '@deservefirst/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { DetailScreen, type DetailSection } from '@deservefirst/ui';

import { changeConsent, saveCustomer } from '../app/actions/customers';
import { formatMoney, type CustomerDto } from '../lib/types';

const CONSENT_TONE: Record<string, 'success' | 'attention' | undefined> = {
  subscribed: 'success',
  pending: 'attention',
  'not-subscribed': undefined,
  unknown: undefined,
};

export function CustomerDetail({ handle, customer }: { handle: string; customer: CustomerDto }) {
  const router = useRouter();
  const [saved, setSaved] = useState(customer);
  const [firstName, setFirstName] = useState(customer.firstName ?? '');
  const [lastName, setLastName] = useState(customer.lastName ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [taxExempt, setTaxExempt] = useState(customer.taxExempt);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ tone: 'critical' | 'warning' | 'success'; message: string } | null>(null);

  const dirty =
    firstName !== (saved.firstName ?? '') ||
    lastName !== (saved.lastName ?? '') ||
    phone !== (saved.phone ?? '') ||
    taxExempt !== saved.taxExempt;

  const apply = (result: { ok: boolean; data?: CustomerDto; error?: string; conflict?: boolean }, message: string) => {
    if (result.ok && result.data) {
      setSaved(result.data);
      setBanner({ tone: 'success', message });
      return;
    }
    setBanner({
      tone: result.conflict ? 'warning' : 'critical',
      message: result.conflict
        ? `${result.error} Reload to see the current version.`
        : (result.error ?? 'That did not work.'),
    });
  };

  const sections: DetailSection[] = [
    {
      id: 'identity',
      content: (
        <BlockStack gap="300">
          <TextField label="First name" autoComplete="off" value={firstName} onChange={setFirstName} />
          <TextField label="Last name" autoComplete="off" value={lastName} onChange={setLastName} />
          <TextField
            label="Email"
            autoComplete="off"
            value={saved.email ?? ''}
            disabled
            helpText="Email identifies the shopper and is how records are deduplicated; changing it is a merge, not an edit."
            onChange={() => {}}
          />
          <TextField label="Phone" autoComplete="off" value={phone} onChange={setPhone} />
          <Checkbox label="Tax exempt" checked={taxExempt} onChange={setTaxExempt} />
        </BlockStack>
      ),
    },
    {
      id: 'consent',
      title: 'Marketing',
      content: (
        <BlockStack gap="300">
          <Text as="p" tone="subdued" variant="bodySm">
            Only an explicit subscription permits marketing. “Not asked” and “pending” are not
            consent, and this is changed on its own rather than with the rest of the form.
          </Text>

          <ConsentControl
            label="Email"
            channel="email"
            state={saved.emailConsent}
            reachable={Boolean(saved.email)}
            busy={pending}
            onChange={(to) =>
              startTransition(async () =>
                apply(await changeConsent(handle, saved.id, 'email', to, saved.version), `Email consent set to ${to}.`),
              )
            }
          />

          <ConsentControl
            label="SMS"
            channel="sms"
            state={saved.smsConsent}
            reachable={Boolean(saved.phone)}
            busy={pending}
            onChange={(to) =>
              startTransition(async () =>
                apply(await changeConsent(handle, saved.id, 'sms', to, saved.version), `SMS consent set to ${to}.`),
              )
            }
          />
        </BlockStack>
      ),
    },
    {
      id: 'summary',
      title: 'Activity',
      placement: 'aside',
      content: (
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text as="span" tone="subdued">Requests</Text>
            <Text as="span">{saved.ordersCount}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" tone="subdued">Amount spent</Text>
            <Text as="span">{formatMoney(saved.totalSpent)}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" tone="subdued">Account</Text>
            <Badge>{saved.state}</Badge>
          </InlineStack>
        </BlockStack>
      ),
    },
  ];

  return (
    <DetailScreen
      title={saved.displayName}
      subtitle={saved.email ?? saved.phone ?? 'No contact details'}
      backAction={{ onAction: () => router.push(`/store/${handle}/customers`) }}
      sections={sections}
      dirty={dirty}
      saving={pending}
      onSave={() =>
        startTransition(async () =>
          apply(
            await saveCustomer(handle, {
              id: saved.id,
              version: saved.version,
              firstName: firstName || null,
              lastName: lastName || null,
              phone: phone || null,
              taxExempt,
            }),
            'Saved.',
          ),
        )
      }
      onDiscard={() => {
        setFirstName(saved.firstName ?? '');
        setLastName(saved.lastName ?? '');
        setPhone(saved.phone ?? '');
        setTaxExempt(saved.taxExempt);
        setBanner(null);
      }}
      slotContent={{
        header: banner ? (
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            <p>{banner.message}</p>
          </Banner>
        ) : null,
      }}
    />
  );
}

function ConsentControl({
  label,
  channel,
  state,
  reachable,
  busy,
  onChange,
}: {
  label: string;
  channel: 'email' | 'sms';
  state: string;
  reachable: boolean;
  busy: boolean;
  onChange(to: string): void;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
          <Badge tone={CONSENT_TONE[state]}>{state.replace(/-/g, ' ')}</Badge>
        </InlineStack>

        {!reachable && (
          <Text as="p" tone="subdued" variant="bodySm">
            No {channel === 'email' ? 'email address' : 'phone number'} on file — subscribing would
            send nothing, so it is refused.
          </Text>
        )}

        <InlineStack gap="200">
          <Button
            disabled={busy || !reachable || state === 'subscribed'}
            onClick={() => onChange('subscribed')}
          >
            Subscribe
          </Button>
          <Button
            disabled={busy || state === 'not-subscribed'}
            onClick={() => onChange('not-subscribed')}
          >
            Unsubscribe
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

'use client';

/**
 * Web · components/DomainSettings.tsx
 * Connecting a hostname, and getting it verified.
 *
 * The screen's real job is not the list — it is the gap between claiming a
 * domain and it working. That gap is DNS, it is measured in hours, and it is
 * where a merchant either succeeds or gives up and opens a support ticket. So
 * the DNS records are shown as literal name/value pairs to copy, the status
 * says which of the two checks has passed, and every pending domain carries the
 * exact next step rather than the word "pending".
 *
 * The platform subdomain is stated up front and never presented as removable,
 * because it is the thing that keeps working while the rest of this is in
 * progress. A merchant who thinks connecting a domain might break their shop
 * does it at 2am on a Sunday, or not at all.
 * Layer: web.
 */

import { useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  InlineStack,
  Text,
  TextField,
} from '@deservefirst/ui';

import {
  connectDomain,
  disconnectDomain,
  makeDomainPrimary,
  verifyDomain,
} from '../app/actions/domains';

interface DnsRecord {
  readonly type: string;
  readonly name: string;
  readonly value: string;
}

export interface DomainDto {
  readonly id: string;
  readonly host: string;
  readonly role: 'primary' | 'alias';
  readonly status: 'pending' | 'verified' | 'failed';
  readonly verifiedAt: string | null;
  readonly records: { readonly ownership: DnsRecord; readonly connectivity: DnsRecord };
}

export interface DomainSettingsProps {
  readonly handle: string;
  readonly domains: readonly DomainDto[];
  /** The hostname this store always answers on, whatever else is connected. */
  readonly platformHost: string;
}

export function DomainSettings({ handle, domains, platformHost }: DomainSettingsProps) {
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Keyed by domain, because two checks can be in flight at once. */
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; error?: string; message?: string }>, id?: string) =>
    startTransition(async () => {
      setError(null);
      const result = await work();

      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      // The platform decides the wording of a check's outcome; repeating that
      // logic here would give the merchant a second answer that could disagree.
      if (id && result.message) setNotices((current) => ({ ...current, [id]: result.message! }));
    });

  const primary = domains.find((domain) => domain.role === 'primary' && domain.status === 'verified');

  return (
    <BlockStack gap="400">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Connect a domain
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Enter a domain you already own. You will be given a DNS record to add at your
              registrar, which is how we confirm it is yours before serving anything on it.
            </Text>
          </BlockStack>

          <InlineStack gap="200" blockAlign="end">
            <Box width="100%">
              <TextField
                label="Domain"
                labelHidden
                autoComplete="off"
                placeholder="shop.example.com"
                value={host}
                onChange={setHost}
              />
            </Box>
            <Button
              variant="primary"
              loading={pending}
              disabled={host.trim() === ''}
              onClick={() =>
                run(async () => {
                  const result = await connectDomain(handle, host.trim());
                  if (result.ok) setHost('');
                  return result;
                })
              }
            >
              Connect
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {platformHost}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {/**
               * Said plainly, because it is the reassurance that makes somebody
               * willing to try the rest of this screen.
               */}
              This store’s own address. It always works and cannot be removed
              {primary ? `, and it now redirects to ${primary.host}.` : '.'}
            </Text>
          </BlockStack>
        </BlockStack>
      </Card>

      {domains.map((domain) => (
        <DomainCard
          key={domain.id}
          domain={domain}
          notice={notices[domain.id]}
          pending={pending}
          onVerify={() => run(() => verifyDomain(handle, domain.id), domain.id)}
          onPrimary={() => run(() => makeDomainPrimary(handle, domain.id))}
          onDisconnect={() => run(() => disconnectDomain(handle, domain.id))}
        />
      ))}
    </BlockStack>
  );
}

function DomainCard({
  domain,
  notice,
  pending,
  onVerify,
  onPrimary,
  onDisconnect,
}: {
  domain: DomainDto;
  notice?: string;
  pending: boolean;
  onVerify: () => void;
  onPrimary: () => void;
  onDisconnect: () => void;
}) {
  const verified = domain.status === 'verified';

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">
              {domain.host}
            </Text>
            {domain.role === 'primary' && <Badge tone="info">Primary</Badge>}
            <Badge tone={verified ? 'success' : 'attention'}>
              {verified ? 'Verified' : 'Waiting for DNS'}
            </Badge>
          </InlineStack>

          <ButtonGroup>
            <Button loading={pending} onClick={onVerify}>
              Check DNS
            </Button>
            {/**
             * Offered only once a domain is verified. An unverified primary
             * would redirect the whole storefront to a hostname that does not
             * reach us — the shop would go dark, from one click.
             */}
            {verified && domain.role !== 'primary' && (
              <Button loading={pending} onClick={onPrimary}>
                Make primary
              </Button>
            )}
            <Button tone="critical" variant="plain" loading={pending} onClick={onDisconnect}>
              Disconnect
            </Button>
          </ButtonGroup>
        </InlineStack>

        {notice && <Banner tone={verified ? 'success' : 'info'}>{notice}</Banner>}

        {/**
         * The records stay visible after verification rather than disappearing.
         *
         * A merchant migrating registrars needs to reproduce them, and a domain
         * that verified once and shows nothing is impossible to re-create
         * without asking us what it used to say.
         */}
        <Divider />
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            Add these at your registrar. The first proves the domain is yours; the second is what
            sends visitors to your store.
          </Text>
          <RecordRow label="Ownership" record={domain.records.ownership} />
          <RecordRow label="Traffic" record={domain.records.connectivity} />
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * One DNS record, laid out as a registrar's own form asks for it.
 *
 * Type, name and value in that order and separately selectable, because the
 * next thing that happens to these values is that somebody copies them one at a
 * time into three boxes on another website.
 */
function RecordRow({ label, record }: { label: string; record: DnsRecord }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {label} · {record.type} record
        </Text>
        <InlineStack gap="400" wrap>
          <Field label="Name" value={record.name} />
          <Field label="Value" value={record.value} />
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodyXs" tone="subdued">
        {label}
      </Text>
      {/* Monospace and breakable: these are long, and a wrapped token that
          cannot be selected cleanly is one that gets pasted wrong. */}
      <Text as="span" variant="bodySm" breakWord fontWeight="medium">
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</span>
      </Text>
    </BlockStack>
  );
}

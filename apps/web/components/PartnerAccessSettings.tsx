'use client';

/**
 * Web · components/PartnerAccessSettings.tsx
 * Who else has keys to this store, and what they can reach.
 *
 * This is the merchant's half of the partner gate and the only screen that can
 * open it. The design point it has to carry is that a request is not a grant:
 * a partner asking for full access is shown as an ASK, with the narrower answer
 * one click away, so the easy path is the considered one rather than the
 * permissive one.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Checkbox,
  InlineStack,
  SettingsCard,
  Text,
  TextField,
} from '@deservefirst/ui';

import { decidePartnerAccess } from '../app/actions/partners';
import type { PartnerAccessDto } from '../lib/types';

export interface PartnerAccessSettingsProps {
  readonly handle: string;
  readonly access: readonly PartnerAccessDto[];
  /** Store permissions the merchant can hand out, from the manifests. */
  readonly grantable: readonly { key: string; label: string }[];
  readonly canManage: boolean;
}

const STATUS_TONE = {
  active: 'success',
  pending: 'attention',
  revoked: 'critical',
} as const;

export function PartnerAccessSettings({
  handle,
  access,
  grantable,
  canManage,
}: PartnerAccessSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Which request is being answered, and with what. Null means none is open. */
  const [answering, setAnswering] = useState<string | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('');

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'The request failed');
        return;
      }
      setAnswering(null);
      setChosen([]);
      setReason('');
      router.refresh();
    });

  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not complete that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      <SettingsCard title="Partner access">
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Agencies and developers you have let into this store. Access is granted by you, at the
            level you choose, and you can remove it at any time — a partner cannot change what they
            were given.
          </Text>

          {access.length === 0 ? (
            <Text as="p" tone="subdued">
              No partner has access to this store, and none has asked.
            </Text>
          ) : (
            access.map((entry) => (
              <BlockStack key={entry.id} gap="200">
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="medium">
                        {entry.partnerName}
                      </Text>
                      <Badge tone={STATUS_TONE[entry.status]}>
                        {entry.status === 'pending' ? 'Requested' : entry.status}
                      </Badge>
                      {entry.createdByPartner ? <Badge>Built this store</Badge> : null}
                    </InlineStack>

                    <Text as="span" tone="subdued" variant="bodySm">
                      {entry.status === 'pending'
                        ? `Asking for ${entry.accessLevel === 'full' ? 'full access' : 'limited access'}`
                        : entry.status === 'revoked'
                          ? (entry.revokedReason ?? 'Access removed')
                          : entry.accessLevel === 'full'
                            ? 'Full access to this store'
                            : `${entry.permissions.length} permission${entry.permissions.length === 1 ? '' : 's'}`}
                    </Text>
                  </BlockStack>

                  {canManage && entry.status !== 'revoked' ? (
                    <ButtonGroup>
                      {entry.status === 'pending' ? (
                        <Button
                          disabled={pending}
                          onClick={() => {
                            setAnswering(entry.id);
                            setChosen([]);
                          }}
                        >
                          Choose what they can reach
                        </Button>
                      ) : null}
                      <Button
                        tone="critical"
                        variant="plain"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            decidePartnerAccess(handle, entry.id, {
                              grant: false,
                              reason: reason.trim() || 'Access removed by the store.',
                            }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </ButtonGroup>
                  ) : null}
                </InlineStack>

                {answering === entry.id ? (
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued" variant="bodySm">
                      They asked for {entry.accessLevel === 'full' ? 'full access' : 'limited access'}. You
                      decide what they actually get — granting less than was asked for is normal.
                    </Text>

                    {grantable.map((permission) => (
                      <Checkbox
                        key={permission.key}
                        label={permission.label}
                        checked={chosen.includes(permission.key)}
                        onChange={() => toggle(permission.key)}
                      />
                    ))}

                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        disabled={pending || chosen.length === 0}
                        onClick={() =>
                          run(() =>
                            decidePartnerAccess(handle, entry.id, {
                              grant: true,
                              accessLevel: 'limited',
                              permissions: chosen,
                            }),
                          )
                        }
                      >
                        Grant these {chosen.length ? `(${chosen.length})` : ''}
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            decidePartnerAccess(handle, entry.id, {
                              grant: true,
                              accessLevel: 'full',
                            }),
                          )
                        }
                      >
                        Grant full access
                      </Button>
                      <Button variant="plain" disabled={pending} onClick={() => setAnswering(null)}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : null}
              </BlockStack>
            ))
          )}

          {canManage && access.some((entry) => entry.status !== 'revoked') ? (
            <TextField
              label="Reason for removing access"
              value={reason}
              onChange={setReason}
              autoComplete="off"
              helpText="Recorded against the partner, so a later question about why they lost access has an answer."
            />
          ) : null}
        </BlockStack>
      </SettingsCard>
    </BlockStack>
  );
}

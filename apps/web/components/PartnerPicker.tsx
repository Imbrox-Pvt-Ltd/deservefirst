'use client';

/**
 * Web · components/PartnerPicker.tsx
 * The way in to the partner surface: choose an agency, or start one.
 *
 * Rendered outside the partner shell, because there is no partner to be inside
 * yet. It doubles as the sign-up path — an agency's first visit and a
 * consultant's tenth are the same screen, which is why creating is offered
 * beside the list rather than hidden behind an empty state.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  TextField,
} from '@deservefirst/ui';

import { createPartner } from '../app/actions/partners';
import type { PartnerSummaryDto } from '../lib/types';

export function PartnerPicker({ partners }: { partners: readonly PartnerSummaryDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createPartner({ name: name.trim() });
      if (!result.ok || !result.id) {
        setError(result.error ?? 'Could not create the partner account');
        return;
      }
      router.push(`/partners/${result.id}`);
    });

  return (
    <Page title="Partner accounts">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not create that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {partners.length > 0 ? (
          <Card>
            <ResourceList
              resourceName={{ singular: 'partner', plural: 'partners' }}
              items={[...partners]}
              renderItem={(partner) => (
                <ResourceItem
                  id={partner.id}
                  onClick={() => router.push(`/partners/${partner.id}`)}
                >
                  <Text as="span" fontWeight="medium">
                    {partner.name}
                  </Text>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {partner.role === 'owner' ? 'You own this account' : `You are ${partner.role === 'admin' ? 'an admin' : 'a member'}`}
                  </Text>
                </ResourceItem>
              )}
            />
          </Card>
        ) : (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                You do not work at a partner yet
              </Text>
              <Text as="p" tone="subdued">
                A partner account is for building or running stores that belong to somebody else.
                You do not need one to run your own store.
              </Text>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Create a partner account
            </Text>
            <TextField
              label="Agency name"
              value={name}
              onChange={setName}
              autoComplete="organization"
              helpText="Shown to merchants when you ask them for access to their store."
            />
            <InlineStack>
              <Button variant="primary" disabled={pending || !name.trim()} onClick={create}>
                Create
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

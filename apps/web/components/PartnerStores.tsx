'use client';

/**
 * Web · components/PartnerStores.tsx
 * The agency's client list, and the form for asking to join another one.
 *
 * The screen's job is to make the difference between a request and a grant
 * impossible to miss. A pending row is not access — it is a message sent to
 * somebody else, and the partner cannot move it along. Showing pending and
 * active as the same kind of row, distinguished only by a word, is how a
 * partner comes to believe they have access they do not have.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { createDevStore, requestStoreAccess, transferStore } from '../app/actions/partners';
import type { PartnerStoreDto } from '../lib/types';

const TONE = { active: 'success', pending: 'attention', revoked: 'critical' } as const;

export interface PartnerStoresProps {
  readonly partnerId: string;
  readonly stores: readonly PartnerStoreDto[];
  /** Members may look; asking to join a store is an admin's call. */
  readonly canRequest: boolean;
}

export function PartnerStores({ partnerId, stores, canRequest }: PartnerStoresProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [storeId, setStoreId] = useState('');
  const [level, setLevel] = useState<'full' | 'limited'>('limited');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devName, setDevName] = useState('');
  const [devHandle, setDevHandle] = useState('');
  const [transferring, setTransferring] = useState<string | null>(null);

  const ask = () =>
    startTransition(async () => {
      setError(null);
      setSent(false);
      const result = await requestStoreAccess(partnerId, {
        storeId: storeId.trim(),
        accessLevel: level,
        // A limited ask with nothing named means "you choose" — the merchant
        // picks the permissions on their side, which is where that choice lives.
        permissions: [],
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not send the request');
        return;
      }
      setStoreId('');
      setSent(true);
      router.refresh();
    });

  return (
    <Page title="Client stores">
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not send that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      {sent ? (
        <Banner tone="info" title="Request sent">
          <Text as="p">
            The store&rsquo;s owner decides whether to accept it, and what to give you. You will see
            it here as soon as they answer.
          </Text>
        </Banner>
      ) : null}

      <Card>
        {stores.length === 0 ? (
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              No client stores yet
            </Text>
            <Text as="p" tone="subdued">
              Ask a merchant for access below, or create a development store to build in.
            </Text>
          </BlockStack>
        ) : (
          <IndexTable
            resourceName={{ singular: 'store', plural: 'stores' }}
            itemCount={stores.length}
            selectable={false}
            headings={[
              { title: 'Store' },
              { title: 'Access' },
              { title: 'What you can reach' },
              { title: '' },
            ]}
          >
            {stores.map((entry, index) => (
              <IndexTable.Row id={entry.id} key={entry.id} position={index}>
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="medium">
                      {entry.storeName ?? 'This store no longer exists'}
                    </Text>
                    {entry.createdByPartner ? (
                      <Text as="span" tone="subdued" variant="bodySm">
                        You built this store
                      </Text>
                    ) : null}
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={TONE[entry.status]}>
                    {entry.status === 'pending' ? 'Waiting on the owner' : entry.status}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" tone={entry.status === 'active' ? undefined : 'subdued'}>
                    {entry.status === 'pending'
                      ? 'Nothing yet'
                      : entry.status === 'revoked'
                        ? (entry.revokedReason ?? 'Access removed')
                        : entry.accessLevel === 'full'
                          ? 'Everything in the store'
                          : `${entry.permissions.length} permission${entry.permissions.length === 1 ? '' : 's'}`}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200">
                    {entry.status === 'active' && entry.storeHandle ? (
                      <Button
                        variant="plain"
                        onClick={() => router.push(`/store/${entry.storeHandle}`)}
                      >
                        Open
                      </Button>
                    ) : null}
                    {entry.createdByPartner && canRequest ? (
                      <Button variant="plain" onClick={() => setTransferring(entry.storeId)}>
                        Hand to client
                      </Button>
                    ) : null}
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>

      {transferring ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Hand this store to your client
            </Text>
            {/*
              * Said before the click. This is the one action on the screen a
              * partner cannot undo on their own — after it, they are waiting on
              * the client like any other agency.
              */}
            <Banner tone="warning" title="You lose standing access">
              <Text as="p">
                The store stops being yours. You keep working in it only if the new owner grants
                you access, exactly as they would for any agency they had not worked with.
              </Text>
            </Banner>
            <InlineStack gap="200">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await transferStore(partnerId, transferring);
                    if (!result.ok) {
                      setError(result.error ?? 'Could not transfer the store');
                      return;
                    }
                    setTransferring(null);
                    router.refresh();
                  })
                }
              >
                Hand it over
              </Button>
              <Button variant="plain" disabled={pending} onClick={() => setTransferring(null)}>
                Cancel
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      {canRequest ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Build a development store
            </Text>
            <Text as="p" tone="subdued">
              Yours to work in without asking anybody. Hand it to the client when it is ready.
            </Text>
            <TextField label="Store name" value={devName} onChange={setDevName} autoComplete="off" />
            <TextField
              label="Address"
              value={devHandle}
              onChange={setDevHandle}
              autoComplete="off"
              helpText="Lowercase letters, digits and hyphens. This is the store's URL."
            />
            <InlineStack>
              <Button
                disabled={pending || !devName.trim() || !devHandle.trim()}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await createDevStore(partnerId, {
                      name: devName.trim(),
                      handle: devHandle.trim().toLowerCase(),
                    });
                    if (!result.ok) {
                      setError(result.error ?? 'Could not create the store');
                      return;
                    }
                    setDevName('');
                    setDevHandle('');
                    router.refresh();
                  })
                }
              >
                Create development store
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      {canRequest ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Ask a merchant for access
            </Text>
            <Text as="p" tone="subdued">
              They decide whether to accept, and what to give you. Asking for less makes it an
              easier yes.
            </Text>
            <TextField
              label="Store ID"
              value={storeId}
              onChange={setStoreId}
              autoComplete="off"
              helpText="The merchant can find this in their store settings."
            />
            <Select
              label="Access you are asking for"
              value={level}
              onChange={(value) => setLevel(value as 'full' | 'limited')}
              options={[
                { value: 'limited', label: 'Limited — the merchant picks what you can reach' },
                { value: 'full', label: 'Full — everything in the store' },
              ]}
            />
            <InlineStack>
              <Button variant="primary" disabled={pending || !storeId.trim()} onClick={ask}>
                Send request
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}
    </BlockStack>
    </Page>
  );
}

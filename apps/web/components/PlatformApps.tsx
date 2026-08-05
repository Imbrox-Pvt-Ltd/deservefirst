'use client';

/**
 * Web · components/PlatformApps.tsx
 * Every app on the platform, and the switch that stops one.
 *
 * The install count is shown beside the button on purpose. Suspending an app
 * running on four hundred stores is a different act from suspending one running
 * on none, and an operator should see which before they decide rather than
 * after. It is the only number on this screen and it is there to slow the click
 * down.
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
  Text,
  TextField,
} from '@deservefirst/ui';

import { setSuspension } from '../app/actions/platform';
import type { PlatformAppDto } from '../lib/types';

const TONE = { published: 'success', draft: undefined, suspended: 'critical' } as const;

export function PlatformApps({ apps }: { apps: readonly PlatformAppDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const run = (appId: string, suspend: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await setSuspension(appId, { suspend, reason });
      if (!result.ok) {
        setError(result.error ?? 'Could not change that app');
        return;
      }
      setSuspending(null);
      setReason('');
      router.refresh();
    });

  return (
    <Page title="Apps">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not do that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          {apps.length === 0 ? (
            <Text as="p" tone="subdued">
              No apps are registered on this platform.
            </Text>
          ) : (
            <IndexTable
              resourceName={{ singular: 'app', plural: 'apps' }}
              itemCount={apps.length}
              selectable={false}
              headings={[
                { title: 'App' },
                { title: 'Status' },
                { title: 'Stores' },
                { title: '' },
              ]}
            >
              {apps.map((app, index) => (
                <IndexTable.Row id={app.id} key={app.id} position={index}>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="medium">
                        {app.name}
                      </Text>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {app.requestedScopes.join(', ') || 'no scopes'}
                      </Text>
                      {app.suspendedReason ? (
                        <Text as="span" tone="critical" variant="bodySm">
                          {app.suspendedReason}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>

                  <IndexTable.Cell>
                    <Badge tone={TONE[app.status]}>{app.status}</Badge>
                  </IndexTable.Cell>

                  <IndexTable.Cell>
                    {/*
                      * The blast radius, next to the button that triggers it.
                      */}
                    <Text as="span" fontWeight={app.installCount > 0 ? 'medium' : undefined}>
                      {String(app.installCount)}
                    </Text>
                  </IndexTable.Cell>

                  <IndexTable.Cell>
                    {app.status === 'suspended' ? (
                      <Button
                        variant="plain"
                        disabled={pending}
                        onClick={() => run(app.id, false)}
                      >
                        Let it run again
                      </Button>
                    ) : (
                      <Button
                        variant="plain"
                        tone="critical"
                        disabled={pending}
                        onClick={() => {
                          setSuspending(app.id);
                          setReason('');
                        }}
                      >
                        Suspend
                      </Button>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {suspending ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Suspend {apps.find((app) => app.id === suspending)?.name}
              </Text>
              <Text as="p" tone="subdued">
                This stops the app on all{' '}
                {apps.find((app) => app.id === suspending)?.installCount ?? 0} stores running it,
                on their next request. Merchants see the reason on their apps settings, so write it
                for them.
              </Text>
              <TextField
                label="Reason"
                value={reason}
                onChange={setReason}
                autoComplete="off"
                multiline={2}
              />
              <InlineStack gap="200">
                <Button
                  tone="critical"
                  variant="primary"
                  disabled={pending || !reason.trim()}
                  onClick={() => run(suspending, true)}
                >
                  Suspend everywhere
                </Button>
                <Button variant="plain" disabled={pending} onClick={() => setSuspending(null)}>
                  Cancel
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}

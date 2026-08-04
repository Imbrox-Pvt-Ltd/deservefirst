'use client';

/**
 * Web · components/InstalledApps.tsx
 * The apps installed in this store, and what each one can actually reach.
 *
 * The scopes are spelled out rather than listed by key. A merchant reading
 * `read_customer_contact` has been told nothing; a merchant reading "Read
 * customer email addresses and phone numbers" has been told the thing they
 * would want to know before leaving it installed. Restricted scopes are marked,
 * because the line between "works with your catalogue" and "has your customer
 * list" is the one decision on this screen that is hard to undo.
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

import { uninstallApp } from '../app/actions/apps';
import type { InstalledAppDto } from '../lib/types';

export interface InstalledAppsProps {
  readonly handle: string;
  readonly installed: readonly InstalledAppDto[];
  readonly canManage: boolean;
}

export function InstalledApps({ handle, installed, canManage }: InstalledAppsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = (appId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await uninstallApp(handle, appId);
      if (!result.ok) {
        setError(result.error ?? 'Could not remove the app');
        return;
      }
      router.refresh();
    });

  const live = installed.filter((entry) => entry.status === 'installed');

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not remove that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      <SettingsCard title="Installed apps">
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Software other people wrote, running against your store with the access you approved.
            Removing an app stops it immediately — its keys stop working on the next request, not
            when they expire.
          </Text>

          {live.length === 0 ? (
            <Text as="p" tone="subdued">
              No apps are installed.
            </Text>
          ) : (
            live.map((entry) => (
              <BlockStack key={entry.id} gap="200">
                <InlineStack align="space-between" blockAlign="start" gap="200">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="medium">
                        {entry.appName}
                      </Text>
                      {entry.appStatus === 'suspended' ? (
                        <Badge tone="critical">Stopped by DeserveFirst</Badge>
                      ) : null}
                      {entry.scopeDetail.some((scope) => scope.restricted) ? (
                        <Badge tone="attention">Sensitive access</Badge>
                      ) : null}
                    </InlineStack>

                    {/*
                      * Said plainly, and above the scope list.
                      *
                      * A suspended app is still installed and still listed. Without
                      * this it looks like it is working while every call it makes
                      * fails, and the merchant blames their own store.
                      */}
                    {entry.appStatus === 'suspended' ? (
                      <Banner tone="critical" title="We stopped this app">
                        <Text as="p">
                          {entry.suspendedReason ??
                            'It has been suspended across every store while we look into it.'}
                        </Text>
                      </Banner>
                    ) : null}

                    <BlockStack gap="100">
                      {entry.scopeDetail.length === 0 ? (
                        <Text as="span" tone="subdued" variant="bodySm">
                          This app has no access to anything.
                        </Text>
                      ) : (
                        entry.scopeDetail.map((scope) => (
                          <Text
                            key={scope.key}
                            as="span"
                            variant="bodySm"
                            tone={scope.restricted ? 'critical' : 'subdued'}
                          >
                            {scope.description}
                          </Text>
                        ))
                      )}
                    </BlockStack>
                  </BlockStack>

                  {canManage ? (
                    <Button
                      variant="plain"
                      tone="critical"
                      disabled={pending}
                      onClick={() => remove(entry.appId)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </InlineStack>
              </BlockStack>
            ))
          )}
        </BlockStack>
      </SettingsCard>
    </BlockStack>
  );
}

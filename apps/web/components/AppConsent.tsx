'use client';

/**
 * Web · components/AppConsent.tsx
 * The screen where a merchant decides what an app may reach.
 *
 * This is the only place on the platform where somebody grants access to
 * software they did not write, so it is written to be read rather than clicked
 * through. Scopes appear as sentences about their own data — "Read customer
 * email addresses and phone numbers" — never as `read_customer_contact`, which
 * tells a merchant nothing while looking like it told them something.
 *
 * Sensitive scopes are called out separately and first. Burying the one line
 * that matters in a list of six is how consent screens become theatre.
 * Layer: web.
 */

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
  Text,
} from '@deservefirst/ui';

import { approveInstall } from '../app/actions/consent';
import type { AppConsentDto } from '../lib/types';

export interface AppConsentProps {
  readonly handle: string;
  readonly consent: AppConsentDto;
  readonly canInstall: boolean;
}

export function AppConsent({ handle, consent, canInstall }: AppConsentProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sensitive = consent.scopes.filter((scope) => scope.restricted);
  const ordinary = consent.scopes.filter((scope) => !scope.restricted);

  const decide = (grant: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await approveInstall(handle, {
        grant,
        clientId: consent.clientId,
        redirectUri: consent.redirectUri,
        scopes: consent.scopes.map((scope) => scope.key),
        state: consent.state,
        codeChallenge: consent.codeChallenge,
        codeChallengeMethod: consent.codeChallengeMethod,
      });
      // On success the action redirects to the app's callback and never
      // returns; reaching here at all means it did not.
      if (!result.ok) setError(result.error ?? 'Could not complete the install');
    });

  return (
    <Page title={consent.alreadyInstalled ? 'Update access' : 'Install app'} narrowWidth>
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not complete that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                {consent.appName}
              </Text>
              <Text as="p" tone="subdued">
                {consent.alreadyInstalled
                  ? 'This app is already installed. It is asking to change what it can reach.'
                  : 'This app was written by someone else. It will be able to reach the following in your store until you remove it.'}
              </Text>
            </BlockStack>

            {sensitive.length > 0 ? (
              <Banner tone="warning" title="This app is asking for personal data">
                <BlockStack gap="100">
                  {sensitive.map((scope) => (
                    <Text as="p" key={scope.key}>
                      {scope.description}
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            ) : null}

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                What it can reach
              </Text>
              {ordinary.length === 0 && sensitive.length === 0 ? (
                <Text as="p" tone="subdued">
                  Nothing. This app is not asking for any access.
                </Text>
              ) : (
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    {consent.scopes.map((scope) => (
                      <InlineStack key={scope.key} gap="200" blockAlign="start" wrap={false}>
                        <Badge tone={scope.access === 'write' ? 'attention' : undefined}>
                          {scope.access === 'write' ? 'Change' : 'Read'}
                        </Badge>
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="medium">
                            {scope.label}
                          </Text>
                          <Text as="span" tone="subdued" variant="bodySm">
                            {scope.description}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Box>
              )}
            </BlockStack>

            <Text as="p" tone="subdued" variant="bodySm">
              You can remove this app at any time in Settings → Apps. Removing it stops its access
              immediately.
            </Text>

            {canInstall ? (
              <InlineStack gap="200">
                <Button variant="primary" disabled={pending} onClick={() => decide(true)}>
                  {consent.alreadyInstalled ? 'Update access' : 'Install app'}
                </Button>
                <Button disabled={pending} onClick={() => decide(false)}>
                  Cancel
                </Button>
              </InlineStack>
            ) : (
              // Not a disabled button: the person needs to know WHY, and that
              // the answer is somebody else rather than a broken page.
              <Banner tone="info" title="You cannot install apps in this store">
                <Text as="p">
                  Ask someone with permission to manage apps to complete this install.
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

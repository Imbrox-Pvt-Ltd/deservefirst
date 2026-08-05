'use client';

/**
 * Web · components/PartnerApps.tsx
 * The agency's apps: what they ask merchants for, and their client credentials.
 *
 * The client secret appears exactly once, at registration, and the screen says
 * so plainly rather than letting a developer assume they can come back for it.
 * There is no endpoint that returns it — losing it means registering again,
 * which is the correct trade for a credential that grants every install.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { registerApp, setAppStatus } from '../app/actions/apps';
import type { AppScopeDto, PartnerAppDto } from '../lib/types';

export interface PartnerAppsProps {
  readonly partnerId: string;
  readonly apps: readonly PartnerAppDto[];
  readonly scopes: readonly AppScopeDto[];
}

export function PartnerApps({ partnerId, apps, scopes }: PartnerAppsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [redirect, setRedirect] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ clientId: string; clientSecret: string } | null>(null);

  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await registerApp(partnerId, {
        name: name.trim(),
        handle: handle.trim().toLowerCase(),
        appUrl: null,
        redirectUris: [redirect.trim()],
        requestedScopes: chosen,
      });
      if (!result.ok || !result.clientSecret) {
        setError(result.error ?? 'Could not register the app');
        return;
      }
      setIssued({ clientId: result.clientId!, clientSecret: result.clientSecret });
      setName('');
      setHandle('');
      setRedirect('');
      setChosen([]);
      router.refresh();
    });

  // Grouped as the consent screen groups them: feature, then read before write.
  const byFeature = new Map<string, AppScopeDto[]>();
  for (const scope of scopes) {
    byFeature.set(scope.feature, [...(byFeature.get(scope.feature) ?? []), scope]);
  }

  return (
    <Page title="Apps">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not register that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {issued ? (
          <Banner tone="warning" title="Copy the client secret now">
            <BlockStack gap="200">
              <Text as="p">
                This is the only time it will be shown. There is no endpoint that returns it — if
                it is lost, register the app again.
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    <code>client_id: {issued.clientId}</code>
                  </Text>
                  <Text as="p" variant="bodySm" breakWord>
                    <code>client_secret: {issued.clientSecret}</code>
                  </Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Banner>
        ) : null}

        <Card>
          {apps.length === 0 ? (
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                No apps yet
              </Text>
              <Text as="p" tone="subdued">
                An app is software you write that merchants install into their store.
              </Text>
            </BlockStack>
          ) : (
            <BlockStack gap="400">
              {apps.map((entry) => (
                <InlineStack key={entry.id} align="space-between" blockAlign="start" gap="200">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="medium">
                        {entry.name}
                      </Text>
                      <Badge tone={entry.status === 'published' ? 'success' : undefined}>
                        {entry.status}
                      </Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      Asks for: {entry.requestedScopes.join(', ') || 'nothing'}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      <code>{entry.clientId}</code>
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200">
                    <Button
                      variant="plain"
                      onClick={() =>
                        router.push(`/partners/${partnerId}/apps/${entry.id}/monitoring/api_health`)
                      }
                    >
                      API health
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => router.push(`/partners/${partnerId}/apps/${entry.id}/versions`)}
                    >
                      Versions
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => router.push(`/partners/${partnerId}/apps/${entry.id}/functions`)}
                    >
                      Functions
                    </Button>
                  {entry.status === 'draft' ? (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await setAppStatus(
                            partnerId,
                            entry.id,
                            'published',
                            entry.version,
                          );
                          if (!result.ok) setError(result.error ?? 'Could not publish');
                          router.refresh();
                        })
                      }
                    >
                      Publish
                    </Button>
                  ) : null}
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Register an app
            </Text>
            <TextField label="Name" value={name} onChange={setName} autoComplete="off" />
            <TextField
              label="Handle"
              value={handle}
              onChange={setHandle}
              autoComplete="off"
              helpText="Lowercase letters, digits and hyphens."
            />
            <TextField
              label="Redirect URL"
              value={redirect}
              onChange={setRedirect}
              autoComplete="off"
              helpText="Matched exactly, so register every callback you use. https, except on localhost."
            />

            <Text as="h3" variant="headingSm">
              What it asks merchants for
            </Text>
            {[...byFeature.entries()].map(([feature, entries]) => (
              <BlockStack key={feature} gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  {feature}
                </Text>
                {entries.map((scope) => (
                  <Checkbox
                    key={scope.key}
                    label={scope.restricted ? `${scope.label} (needs approval)` : scope.label}
                    helpText={scope.description}
                    checked={chosen.includes(scope.key)}
                    onChange={() => toggle(scope.key)}
                  />
                ))}
              </BlockStack>
            ))}

            <InlineStack>
              <Button
                variant="primary"
                disabled={pending || !name.trim() || !handle.trim() || !redirect.trim()}
                onClick={create}
              >
                Register
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

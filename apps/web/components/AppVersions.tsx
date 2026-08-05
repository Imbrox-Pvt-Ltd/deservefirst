'use client';

/**
 * Web · components/AppVersions.tsx
 * An app's releases, and the draft being prepared.
 *
 * The screen's job is to make "released is frozen" obvious before somebody
 * relies on it being otherwise. A released version has no edit controls at all
 * — not disabled ones — because a disabled field invites the question "how do I
 * enable this" for something that must never be enabled.
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
  Checkbox,
  InlineStack,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { draftVersion, releaseVersion, updateVersion } from '../app/actions/versions';
import type { AppScopeDto, AppVersionDto } from '../lib/types';

export interface AppVersionsProps {
  readonly partnerId: string;
  readonly appId: string;
  readonly appName: string;
  readonly versions: readonly AppVersionDto[];
  readonly scopes: readonly AppScopeDto[];
}

export function AppVersions({
  partnerId,
  appId,
  appName,
  versions,
  scopes,
}: AppVersionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const draft = versions.find((version) => version.status === 'draft');
  const released = versions.filter((version) => version.status === 'released');
  const live = released[0];

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'Could not do that');
        return;
      }
      setName('');
      router.refresh();
    });

  const toggleScope = (key: string) => {
    if (!draft) return;
    const next = draft.scopes.includes(key)
      ? draft.scopes.filter((scope) => scope !== key)
      : [...draft.scopes, key];
    run(() => updateVersion(partnerId, appId, draft.id, { scopes: next }));
  };

  return (
    <Page
      title={`${appName} — versions`}
      backAction={{ content: 'Apps', url: `/partners/${partnerId}/apps` }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not do that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Banner tone="info" title="What merchants install">
          <Text as="p">
            {live
              ? `Everyone installing this app now gets ${live.name}. Merchants already on an older version stay there until a wider release asks them again.`
              : 'This app has no released version yet, so merchants install against its registered scopes. Release one to pin what they agree to.'}
          </Text>
        </Banner>

        {draft ? (
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {draft.name}
                </Text>
                <Badge tone="attention">Draft</Badge>
              </InlineStack>

              <TextField
                label="Release notes"
                value={draft.message ?? ''}
                onChange={(value) =>
                  run(() => updateVersion(partnerId, appId, draft.id, { message: value }))
                }
                autoComplete="off"
                multiline={2}
                helpText="Merchants see this when a wider release asks them to approve it again."
              />

              <TextField
                label="Webhooks API version"
                value={draft.webhookApiVersion}
                onChange={(value) =>
                  run(() =>
                    updateVersion(partnerId, appId, draft.id, { webhookApiVersion: value }),
                  )
                }
                autoComplete="off"
                helpText="The payload shape this release expects. Pinned per version, so moving does not change deliveries for merchants on an older one."
              />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  API access scopes
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {draft.scopes.length} of {scopes.length}
                </Text>
                {scopes.map((scope) => (
                  <Checkbox
                    key={scope.key}
                    label={scope.restricted ? `${scope.label} (needs approval)` : scope.label}
                    helpText={scope.description}
                    checked={draft.scopes.includes(scope.key)}
                    disabled={pending}
                    onChange={() => toggleScope(scope.key)}
                  />
                ))}
              </BlockStack>

              <InlineStack>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => run(() => releaseVersion(partnerId, draft.id))}
                >
                  Release this version
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Start a new version
              </Text>
              <Text as="p" tone="subdued">
                It begins as a copy of {live ? live.name : 'the app’s registered settings'}, so you
                change what moved rather than retyping everything — a scope dropped by omission is
                an install that breaks.
              </Text>
              <TextField
                label="Version name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="1.1.0"
              />
              <InlineStack>
                <Button
                  disabled={pending || !name.trim()}
                  onClick={() => run(() => draftVersion(partnerId, appId, { name: name.trim() }))}
                >
                  Create draft
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Released
            </Text>
            {released.length === 0 ? (
              <Text as="p" tone="subdued">
                Nothing released yet.
              </Text>
            ) : (
              released.map((version) => (
                <BlockStack key={version.id} gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="medium">
                      {version.name}
                    </Text>
                    {version.id === live?.id ? <Badge tone="success">Current</Badge> : null}
                    <Text as="span" tone="subdued" variant="bodySm">
                      {version.releasedAt ? new Date(version.releasedAt).toLocaleDateString() : ''}
                    </Text>
                  </InlineStack>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {version.scopes.join(', ') || 'no scopes'}
                  </Text>
                  {version.message ? (
                    <Text as="span" tone="subdued" variant="bodySm">
                      {version.message}
                    </Text>
                  ) : null}
                </BlockStack>
              ))
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

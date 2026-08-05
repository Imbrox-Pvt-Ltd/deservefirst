'use client';

/**
 * Web · components/PlatformModules.tsx
 * The kill switch: turning a module off for every store at once.
 *
 * The most dangerous screen on the platform, so it reads like it. Disabling a
 * module here overrides every store's own setting and cannot be undone from a
 * store — a merchant who turns it back on in their settings gets nothing,
 * because platform-off is absolute. The screen says that rather than leaving an
 * operator to discover it from a support queue.
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
  InlineStack,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { setModuleEnabled } from '../app/actions/platform';
import type { PlatformModuleStateDto } from '../lib/types';

export function PlatformModules({ modules }: { modules: readonly PlatformModuleStateDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const run = (moduleId: string, enabled: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await setModuleEnabled(moduleId, { enabled, reason });
      if (!result.ok) {
        setError(result.error ?? 'Could not change that module');
        return;
      }
      setDisabling(null);
      setReason('');
      router.refresh();
    });

  return (
    <Page title="Modules">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not do that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Banner tone="warning" title="This applies to every store">
          <Text as="p">
            Turning a module off here overrides each store&rsquo;s own setting and cannot be undone
            from a store. Merchants who switch it back on in their settings will get nothing.
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="400">
            {modules.map((module) => (
              <InlineStack key={module.moduleId} align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="medium">
                      {module.label}
                    </Text>
                    <Badge tone={module.enabled ? 'success' : 'critical'}>
                      {module.enabled ? 'on' : 'off everywhere'}
                    </Badge>
                  </InlineStack>
                  {module.disabledReason ? (
                    <Text as="span" tone="critical" variant="bodySm">
                      {module.disabledReason}
                    </Text>
                  ) : null}
                </BlockStack>

                {module.enabled ? (
                  <Button
                    variant="plain"
                    tone="critical"
                    disabled={pending}
                    onClick={() => {
                      setDisabling(module.moduleId);
                      setReason('');
                    }}
                  >
                    Turn off everywhere
                  </Button>
                ) : (
                  <Button
                    variant="plain"
                    disabled={pending}
                    onClick={() => run(module.moduleId, true)}
                  >
                    Turn back on
                  </Button>
                )}
              </InlineStack>
            ))}
          </BlockStack>
        </Card>

        {disabling ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Turn off {modules.find((module) => module.moduleId === disabling)?.label}
              </Text>
              <Text as="p" tone="subdued">
                Every screen and every endpoint this module owns stops responding, on every store.
              </Text>
              <TextField
                label="Reason"
                value={reason}
                onChange={setReason}
                autoComplete="off"
                multiline={2}
                helpText="Recorded against the module, so the next operator knows why it is off."
              />
              <InlineStack gap="200">
                <Button
                  tone="critical"
                  variant="primary"
                  disabled={pending || !reason.trim()}
                  onClick={() => run(disabling, false)}
                >
                  Turn off everywhere
                </Button>
                <Button variant="plain" disabled={pending} onClick={() => setDisabling(null)}>
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

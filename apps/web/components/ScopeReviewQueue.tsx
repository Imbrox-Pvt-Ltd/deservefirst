'use client';

/**
 * Web · components/ScopeReviewQueue.tsx
 * Apps asking for access to personal data, and the operator's answer.
 *
 * Each restricted scope is answered on its own. Approving an app to read
 * customer contact details is not approving it for everything else it happens
 * to ask for, and a single "approve app" button would quietly make it so.
 *
 * The description shown is the one the merchant will see on their consent
 * screen. An operator approving "read_customer_contact" is really approving the
 * sentence "Read customer email addresses and phone numbers", and that is the
 * thing to put in front of them.
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

import { decideScope } from '../app/actions/platform';
import type { ScopeReviewDto } from '../lib/types';

export function ScopeReviewQueue({ queue }: { queue: readonly ScopeReviewDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const decide = (appId: string, scope: string, approve: boolean) =>
    startTransition(async () => {
      setError(null);
      const key = `${appId}:${scope}`;
      const result = await decideScope(appId, { scope, approve, reason: reasons[key] ?? '' });
      if (!result.ok) {
        setError(result.error ?? 'Could not record that decision');
        return;
      }
      router.refresh();
    });

  return (
    <Page title="Scope requests">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not record that">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {queue.length === 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Nothing waiting
              </Text>
              <Text as="p" tone="subdued">
                Apps appear here when they ask for a scope that reaches personal data. Until one is
                approved, the app cannot be published.
              </Text>
            </BlockStack>
          </Card>
        ) : (
          queue.map((item) => {
            const restricted = item.requested.filter((scope) => scope.restricted);
            const answered = new Set(item.decisions.map((decision) => decision.scope));

            return (
              <Card key={item.appId}>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {item.name}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {item.handle} · partner {item.partnerId}
                    </Text>
                  </BlockStack>

                  {restricted.map((scope) => {
                    const key = `${item.appId}:${scope.key}`;
                    const decision = item.decisions.find((entry) => entry.scope === scope.key);

                    return (
                      <BlockStack key={scope.key} gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="medium">
                            {scope.label}
                          </Text>
                          {decision ? (
                            <Badge tone={decision.status === 'approved' ? 'success' : 'critical'}>
                              {decision.status}
                            </Badge>
                          ) : (
                            <Badge tone="attention">Waiting</Badge>
                          )}
                        </InlineStack>

                        {/*
                          * The merchant's words, not the scope key. An operator
                          * approving `read_customer_contact` is approving this
                          * sentence, so this is the sentence to show them.
                          */}
                        <Text as="p" tone="subdued">
                          Merchants will be asked: &ldquo;{scope.description}&rdquo;
                        </Text>

                        {decision?.reason ? (
                          <Text as="p" tone="subdued" variant="bodySm">
                            {decision.reason}
                          </Text>
                        ) : null}

                        {!answered.has(scope.key) ? (
                          <BlockStack gap="200">
                            <TextField
                              label="Reason"
                              value={reasons[key] ?? ''}
                              onChange={(value) => setReasons((all) => ({ ...all, [key]: value }))}
                              autoComplete="off"
                              helpText="Required to deny. The partner reads this, so it should say what would change the answer."
                            />
                            <InlineStack gap="200">
                              <Button
                                variant="primary"
                                disabled={pending}
                                onClick={() => decide(item.appId, scope.key, true)}
                              >
                                Approve
                              </Button>
                              <Button
                                tone="critical"
                                disabled={pending || !(reasons[key] ?? '').trim()}
                                onClick={() => decide(item.appId, scope.key, false)}
                              >
                                Deny
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        ) : null}
                      </BlockStack>
                    );
                  })}
                </BlockStack>
              </Card>
            );
          })
        )}
      </BlockStack>
    </Page>
  );
}

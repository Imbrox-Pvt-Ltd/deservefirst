'use client';

/**
 * Web · components/AppHealth.tsx
 * One app's API health.
 *
 * Ordered by what the author cannot already see from their own logs. Deprecated
 * calls lead however few there are, because a single call to something being
 * removed is a release that WILL break and nothing on their side says so; a
 * thousand 404s is an app already broken, whose author knows.
 *
 * The app's errors and ours are separate numbers. One "error rate" hides which
 * of two conversations they are about to have.
 * Layer: web.
 */

import {
  Badge,
  Banner,
  BlockStack,
  Card,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from '@deservefirst/ui';

import type { AppHealthDto } from '../lib/types';

export function AppHealth({
  partnerId,
  appName,
  health,
}: {
  partnerId: string;
  appName: string;
  health: AppHealthDto;
}) {
  const tiles = [
    { label: 'Calls', value: health.total, hint: `Last ${health.days} days` },
    { label: 'Your errors', value: health.clientErrors, hint: '4xx — the app asked wrongly' },
    { label: 'Our errors', value: health.serverErrors, hint: '5xx — our fault' },
    { label: 'Deprecated', value: health.deprecatedCalls, hint: 'Calls that will stop working' },
  ];

  return (
    <Page
      title={`${appName} — API health`}
      backAction={{ content: 'Apps', url: `/partners/${partnerId}/apps` }}
    >
      <BlockStack gap="400">
        {health.headline ? (
          <Banner tone={health.deprecatedCalls > 0 ? 'warning' : 'critical'} title="Worth looking at">
            <Text as="p">{health.headline}</Text>
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, sm: 4 }} gap="400">
          {tiles.map((tile) => (
            <Card key={tile.label}>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  {tile.label}
                </Text>
                <Text as="p" variant="heading2xl">
                  {String(tile.value)}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {tile.hint}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {health.deprecations.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Being removed
              </Text>
              {health.deprecations.map((entry) => (
                <Text as="p" key={entry.deprecation}>
                  {entry.deprecation} — {entry.calls} call{entry.calls === 1 ? '' : 's'}
                </Text>
              ))}
            </BlockStack>
          </Card>
        ) : null}

        {health.slowest.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Slowest endpoints
              </Text>
              {health.slowest.map((entry) => (
                <InlineStack key={entry.path} align="space-between">
                  <Text as="span">{entry.path}</Text>
                  <Text as="span" tone="subdued">
                    {entry.averageMs}ms average over {entry.calls}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        ) : null}

        <Card>
          {health.recent.length === 0 ? (
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                No calls yet
              </Text>
              <Text as="p" tone="subdued">
                Requests appear here once a merchant installs this app and it starts working.
              </Text>
            </BlockStack>
          ) : (
            <IndexTable
              resourceName={{ singular: 'call', plural: 'calls' }}
              itemCount={health.recent.length}
              selectable={false}
              headings={[
                { title: 'When' },
                { title: 'Request' },
                { title: 'Status' },
                { title: 'Took' },
              ]}
            >
              {health.recent.map((entry, index) => (
                <IndexTable.Row id={`${entry.at}-${index}`} key={`${entry.at}-${index}`} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {new Date(entry.at).toLocaleTimeString()}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span">
                        {entry.method} {entry.path}
                      </Text>
                      {entry.deprecation ? (
                        <Text as="span" tone="critical" variant="bodySm">
                          {entry.deprecation}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge
                      tone={
                        entry.status >= 500 ? 'critical' : entry.status >= 400 ? 'attention' : 'success'
                      }
                    >
                      {String(entry.status)}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued">
                      {entry.durationMs}ms
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

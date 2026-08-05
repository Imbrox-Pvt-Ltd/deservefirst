'use client';

/**
 * Web · components/ApiExplorer.tsx
 * Reading the API and trying it, in the same place (§26.2).
 *
 * GraphiQL's actual value is not the editor — it is that the schema you are
 * reading and the endpoint you are calling cannot disagree. So this reads the
 * SAME generated document `platform docs:api` writes and CI checks, rather than
 * a description maintained beside it. An explorer that documents a different
 * API from the one it calls is worse than no explorer.
 *
 * Requests go through a server action carrying the operator's own session, so
 * "try it" means what it says: the same authorisation, the same tenant guard,
 * the same refusals. A console that bypassed those would teach people an API
 * that does not exist.
 * Layer: web.
 */

import { useMemo, useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { sendApiRequest } from '../app/actions/explorer';

export interface ApiOperation {
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly permission: string | null;
  readonly tag: string;
}

export function ApiExplorer({ operations }: { operations: readonly ApiOperation[] }) {
  const [pending, startTransition] = useTransition();
  const [tag, setTag] = useState('all');
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [path, setPath] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<{ status: number; body: string } | null>(null);

  const tags = useMemo(
    () => ['all', ...[...new Set(operations.map((operation) => operation.tag))].sort()],
    [operations],
  );

  const shown = useMemo(
    () => operations.filter((operation) => tag === 'all' || operation.tag === tag),
    [operations, tag],
  );

  const choose = (operation: ApiOperation) => {
    setSelected(operation);
    setPath(operation.path);
    setResult(null);
    // A body only where one is meaningful. Prefilling `{}` on a GET invites
    // somebody to fill it in and wonder why nothing happened.
    setBody(operation.method === 'GET' || operation.method === 'DELETE' ? '' : '{\n  \n}');
  };

  const send = () =>
    startTransition(async () => {
      const response = await sendApiRequest({
        method: selected?.method ?? 'GET',
        path,
        body: body.trim() ? body : null,
      });
      setResult(response);
    });

  return (
    <Page title="API explorer">
      <BlockStack gap="400">
        <Banner tone="info" title="This is the real API">
          <Text as="p">
            Requests are sent with your own session, so you see exactly what your permissions allow
            — including the refusals. Anything you change here is changed for real.
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Select
              label="Area"
              value={tag}
              onChange={setTag}
              options={tags.map((entry) => ({ value: entry, label: entry }))}
            />

            <BlockStack gap="100">
              {shown.slice(0, 60).map((operation) => (
                <InlineStack
                  key={`${operation.method} ${operation.path}`}
                  gap="200"
                  blockAlign="center"
                >
                  <Button variant="plain" onClick={() => choose(operation)}>
                    {operation.method} {operation.path}
                  </Button>
                  {operation.permission ? (
                    <Badge>{operation.permission}</Badge>
                  ) : null}
                </InlineStack>
              ))}
              {shown.length > 60 ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  Showing 60 of {shown.length}. Narrow by area.
                </Text>
              ) : null}
            </BlockStack>
          </BlockStack>
        </Card>

        {selected ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {selected.method} {selected.path}
              </Text>
              <Text as="p" tone="subdued">
                {selected.summary}
              </Text>
              {selected.permission ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  Needs <code>{selected.permission}</code>
                </Text>
              ) : null}

              <TextField
                label="Path"
                value={path}
                onChange={setPath}
                autoComplete="off"
                helpText="Replace anything in braces with a real id."
              />

              {selected.method !== 'GET' && selected.method !== 'DELETE' ? (
                <TextField
                  label="Body"
                  value={body}
                  onChange={setBody}
                  autoComplete="off"
                  multiline={6}
                />
              ) : null}

              <InlineStack>
                <Button variant="primary" disabled={pending || path.includes('{')} onClick={send}>
                  Send
                </Button>
              </InlineStack>

              {path.includes('{') ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  The path still has a placeholder in it.
                </Text>
              ) : null}

              {result ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="medium">
                      Response
                    </Text>
                    <Badge
                      tone={
                        result.status >= 500
                          ? 'critical'
                          : result.status >= 400
                            ? 'attention'
                            : 'success'
                      }
                    >
                      {String(result.status)}
                    </Badge>
                  </InlineStack>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="bodySm" breakWord>
                      <code>{result.body}</code>
                    </Text>
                  </Box>
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}

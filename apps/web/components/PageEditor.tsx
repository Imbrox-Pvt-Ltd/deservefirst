'use client';

/**
 * Web · components/PageEditor.tsx
 * One page: its title, its content, its address, and whether it is live.
 *
 * Visibility is a separate control from Save, because publishing is a separate
 * operation on the service. A merchant editing a typo on a live page must not
 * have to think about whether saving will change who can see it.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { savePage, setPageStatus } from '../app/actions/content';
import type { PageDto } from '../lib/types';

export function PageEditor({ handle, page }: { handle: string; page: PageDto }) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [slug, setSlug] = useState(page.handle);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = title !== page.title || body !== page.body || slug !== page.handle;

  const report = (result: { ok: boolean; error?: string; conflict?: boolean }) => {
    if (result.ok) {
      setError(null);
      setConflict(false);
      router.refresh();
      return;
    }
    setError(result.error ?? 'Could not save');
    setConflict(Boolean(result.conflict));
  };

  const save = () =>
    startTransition(async () => {
      report(await savePage(handle, page.id, page.version, { title, body, handle: slug }));
    });

  const toggleVisibility = () =>
    startTransition(async () => {
      report(
        await setPageStatus(
          handle,
          page.id,
          page.version,
          page.status === 'published' ? 'draft' : 'published',
        ),
      );
    });

  return (
    <Page
      title={page.title || 'Untitled page'}
      titleMetadata={
        <Badge tone={page.status === 'published' ? 'success' : 'info'}>{page.status}</Badge>
      }
      backAction={{ content: 'Pages', onAction: () => router.push(`/store/${handle}/pages`) }}
      primaryAction={{ content: 'Save', disabled: !dirty, loading: pending, onAction: save }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error ? (
              <Banner
                tone={conflict ? 'warning' : 'critical'}
                title={conflict ? 'Someone else changed this page' : 'Could not save'}
              >
                <Text as="p">{error}</Text>
                {conflict ? (
                  <Box paddingBlockStart="200">
                    <Button onClick={() => router.refresh()}>Reload</Button>
                  </Box>
                ) : null}
              </Banner>
            ) : null}

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <TextField
                    label="Title"
                    value={title}
                    autoComplete="off"
                    onChange={setTitle}
                    disabled={pending}
                  />
                  <TextField
                    label="Content"
                    value={body}
                    multiline={12}
                    autoComplete="off"
                    onChange={setBody}
                    disabled={pending}
                    helpText="A published page cannot be empty."
                  />
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">Visibility</Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={page.status === 'published' ? 'success' : 'info'}>
                      {page.status === 'published' ? 'Visible' : 'Hidden'}
                    </Badge>
                    <Button size="slim" loading={pending} onClick={toggleVisibility}>
                      {page.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                  </InlineStack>
                  {page.publishedAt ? (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {/* The first publication date, kept across republishes. */}
                      First published {new Date(page.publishedAt).toLocaleDateString()}
                    </Text>
                  ) : null}
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">Search engine listing</Text>
                  <TextField
                    label="URL handle"
                    prefix="/pages/"
                    value={slug}
                    autoComplete="off"
                    onChange={setSlug}
                    disabled={pending}
                    helpText="Changing this breaks existing links to the page."
                  />
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

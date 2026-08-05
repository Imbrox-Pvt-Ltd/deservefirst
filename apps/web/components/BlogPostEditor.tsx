'use client';

/**
 * Web · components/BlogPostEditor.tsx
 * Writing a post, publishing it, or scheduling it.
 *
 * Scheduling is not a third status. A scheduled post is `published` with a date
 * in the future, and the storefront asks `isVisible` rather than reading the
 * status — so this screen has to make the difference between "live" and "will
 * go live" obvious from the badge alone. A merchant who thinks a post is out
 * when it is not will find out from whoever was waiting for it.
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

import { saveBlogPost } from '../app/actions/content-editing';
import type { BlogPostDto } from '../lib/types';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, without the zone or seconds. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
}

export function BlogPostEditor({ handle, post }: { handle: string; post: BlogPostDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [publishedAt, setPublishedAt] = useState(toLocalInput(post.publishedAt));
  const [error, setError] = useState<string | null>(null);

  const scheduled =
    post.status === 'published' &&
    post.publishedAt !== null &&
    new Date(post.publishedAt).getTime() > Date.now();

  const live = post.status === 'published' && !scheduled;
  const dirty =
    title !== post.title || body !== post.body || publishedAt !== toLocalInput(post.publishedAt);

  const run = (patch: Parameters<typeof saveBlogPost>[3]) =>
    startTransition(async () => {
      setError(null);
      const result = await saveBlogPost(handle, post.id, post.version, patch);
      if (!result.ok) {
        setError(result.error ?? 'Could not save this post');
        return;
      }
      router.refresh();
    });

  return (
    <Page
      title={post.title}
      backAction={{ content: 'Blog posts', url: `/store/${handle}/blogs` }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              {/*
                * Three states from two fields. "Scheduled" is the one that gets
                * mistaken for live, so it says the date rather than just a word.
                */}
              <Badge tone={live ? 'success' : scheduled ? 'attention' : undefined}>
                {live ? 'Live' : scheduled ? 'Scheduled' : 'Draft'}
              </Badge>
              {scheduled && post.publishedAt ? (
                <Text as="span" tone="subdued" variant="bodySm">
                  Goes live {new Date(post.publishedAt).toLocaleString()} — not visible yet
                </Text>
              ) : null}
            </InlineStack>

            <TextField label="Title" value={title} onChange={setTitle} autoComplete="off" />
            <TextField
              label="Content"
              value={body}
              onChange={setBody}
              autoComplete="off"
              multiline={10}
              helpText="Publishing needs content."
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Visibility
            </Text>

            <TextField
              label="Publish date"
              type="datetime-local"
              value={publishedAt}
              onChange={setPublishedAt}
              autoComplete="off"
              helpText="Leave empty to publish immediately. A future date schedules it."
            />

            <InlineStack gap="200">
              {post.status === 'draft' ? (
                <Button
                  variant="primary"
                  disabled={pending || !body.trim()}
                  onClick={() =>
                    run({
                      title,
                      body,
                      status: 'published',
                      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
                    })
                  }
                >
                  {publishedAt && new Date(publishedAt).getTime() > Date.now()
                    ? 'Schedule'
                    : 'Publish now'}
                </Button>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() => run({ title, body, status: 'draft' })}
                >
                  Revert to draft
                </Button>
              )}

              <Button
                disabled={pending || !dirty}
                onClick={() =>
                  run({
                    title,
                    body,
                    // Only sent when it changed, so saving text on a live post
                    // does not quietly move its publish date.
                    ...(publishedAt !== toLocalInput(post.publishedAt)
                      ? { publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null }
                      : {}),
                  })
                }
              >
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

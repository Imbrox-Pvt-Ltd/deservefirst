/**
 * Web · app/store/[handle]/blogs/page.tsx
 * Blog posts. Listed rather than the blogs that hold them, because the captured
 * nav says "Blog posts" — a merchant manages posts, and the blog is a field on
 * one. See `blogResource`, which declares no screens for the same reason.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'title', label: 'Title', defaultVisible: true },
  { field: 'status', label: 'Visibility', defaultVisible: true },
  { field: 'publishedAt', label: 'Published', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'BlogPost', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'published', entity: 'BlogPost', name: 'Published', query: 'status:published', sort: null, columns: [], shared: true, position: 1 },
  { id: 'draft', entity: 'BlogPost', name: 'Drafts', query: 'status:draft', sort: null, columns: [], shared: true, position: 2 },
];

export default async function BlogPostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const query = listQueryFrom(await searchParams, VIEWS);

  try {
    const response = await apiFetch<Record<string, unknown>[]>(
      withSearch('/content/blog_posts', query),
    );

    const connection = {
      nodes: response.data as ({ id: string } & Record<string, unknown>)[],
      pageInfo: response.meta.pagination ?? {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    } satisfies Connection<{ id: string } & Record<string, unknown>>;

    return (
      <EntityList
        title="Blog posts"
        handle={handle}
        urlSegment="blogs"
        resourceName={{ singular: 'post', plural: 'posts' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add blog post"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Blog posts"
        title="Could not load blog posts"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

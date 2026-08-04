/**
 * Web · app/store/[handle]/pages/page.tsx
 * Pages — the screen the Content section opens, matching the reference nav where
 * Metaobjects, Files, Menus and Blog posts sit beneath it.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom, storeIdFor } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'title', label: 'Title', defaultVisible: true },
  { field: 'status', label: 'Visibility', defaultVisible: true },
  { field: 'publishedAt', label: 'Published', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Page', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'published', entity: 'Page', name: 'Published', query: 'status:published', sort: null, columns: [], shared: true, position: 1 },
  { id: 'draft', entity: 'Page', name: 'Drafts', query: 'status:draft', sort: null, columns: [], shared: true, position: 2 },
];

export default async function PagesPage({
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
      withSearch('/content/pages', query),
      { storeId: storeIdFor(handle), permissions: ['content.read', 'content.manage'] },
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
        title="Pages"
        handle={handle}
        urlSegment="pages"
        resourceName={{ singular: 'page', plural: 'pages' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add page"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Pages"
        title="Could not load pages"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

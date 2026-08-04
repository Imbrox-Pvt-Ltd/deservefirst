/**
 * Web · app/store/[handle]/collections/page.tsx
 * Collections. The screen is the generic EntityList driven by the resource's own
 * declared columns — there is no collections-specific list component, which is the
 * property the platform claims and this file is the evidence for.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

/** Declared on the resource; mirrored here until the registry serves them. */
const COLUMNS = [
  { field: 'title', label: 'Title', defaultVisible: true },
  { field: 'type', label: 'Type', defaultVisible: true },
  { field: 'sortOrder', label: 'Product sorting', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Collection', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'automated', entity: 'Collection', name: 'Automated', query: 'type:automated', sort: null, columns: [], shared: true, position: 1 },
  { id: 'manual', entity: 'Collection', name: 'Manual', query: 'type:manual', sort: null, columns: [], shared: true, position: 2 },
];

export default async function CollectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const search = await searchParams;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  const view = VIEWS.find((entry) => entry.id === query.get('savedViewId'));
  if (view && view.query && !query.get('query')) query.set('query', view.query);

  try {
    const response = await apiFetch<Record<string, unknown>[]>(
      withSearch('/catalog/collections', query),
      { storeId, permissions: ['catalog.read', 'catalog.write'] },
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
        title="Collections"
        handle={handle}
        urlSegment="collections"
        resourceName={{ singular: 'collection', plural: 'collections' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Create collection"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Collections"
        title="Could not load collections"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

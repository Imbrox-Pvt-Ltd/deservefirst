/**
 * Web · app/store/[handle]/requests/page.tsx
 * Requests for quote — the Phase-1 commerce surface (ADR 0001 D10). Same generic
 * EntityList as products, collections and customers; the fourth entity added no
 * list code at all.
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

const COLUMNS = [
  { field: 'reference', label: 'Request', defaultVisible: true },
  { field: 'contactName', label: 'Customer', defaultVisible: true },
  { field: 'status', label: 'Status', defaultVisible: true },
  { field: 'lineCount', label: 'Items', defaultVisible: true },
  { field: 'subtotal', label: 'Subtotal', defaultVisible: true },
];

/** The queue a merchant actually works from, in the order they work it. */
const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Request', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'to-quote', entity: 'Request', name: 'To quote', query: 'status:submitted', sort: null, columns: [], shared: true, position: 1 },
  { id: 'awaiting', entity: 'Request', name: 'Awaiting reply', query: 'status:quoted', sort: null, columns: [], shared: true, position: 2 },
  { id: 'accepted', entity: 'Request', name: 'Accepted', query: 'status:accepted', sort: null, columns: [], shared: true, position: 3 },
];

export default async function RequestsPage({
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
      withSearch('/orders/requests', query),
      { storeId, permissions: ['orders.read', 'orders.manage'] },
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
        title="Requests"
        handle={handle}
        urlSegment="requests"
        resourceName={{ singular: 'request', plural: 'requests' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Create request"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Requests"
        title="Could not load requests"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

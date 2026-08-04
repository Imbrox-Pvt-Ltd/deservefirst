/**
 * Web · app/store/[handle]/transfers/page.tsx
 * Stock moving between locations.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom, storeIdFor } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'reference', label: 'Transfer', defaultVisible: true },
  { field: 'status', label: 'Status', defaultVisible: true },
  { field: 'lineCount', label: 'Items', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Transfer', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'transit', entity: 'Transfer', name: 'In transit', query: 'status:in-transit', sort: null, columns: [], shared: true, position: 1 },
  { id: 'received', entity: 'Transfer', name: 'Received', query: 'status:received', sort: null, columns: [], shared: true, position: 2 },
];

export default async function TransfersPage({
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
      withSearch('/inventory/transfers', query),
      { storeId: storeIdFor(handle), permissions: ['inventory.read', 'inventory.manage'] },
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
        title="Transfers"
        handle={handle}
        urlSegment="transfers"
        resourceName={{ singular: 'transfer', plural: 'transfers' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Create transfer"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Transfers"
        title="Could not load transfers"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

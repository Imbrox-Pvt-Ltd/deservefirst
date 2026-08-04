/**
 * Web · app/store/[handle]/purchase_orders/page.tsx
 * Purchase orders. The underscore in the path is the reference admin's own URL
 * convention, kept deliberately; our API segments stay kebab-cased.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom, storeIdFor } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'reference', label: 'Purchase order', defaultVisible: true },
  { field: 'supplierName', label: 'Supplier', defaultVisible: true },
  { field: 'status', label: 'Status', defaultVisible: true },
  { field: 'expectedAt', label: 'Expected', defaultVisible: true },
  { field: 'lineCount', label: 'Items', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'PurchaseOrder', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'open', entity: 'PurchaseOrder', name: 'Open', query: 'status:ordered', sort: null, columns: [], shared: true, position: 1 },
  { id: 'partial', entity: 'PurchaseOrder', name: 'Partially received', query: 'status:partial', sort: null, columns: [], shared: true, position: 2 },
  { id: 'closed', entity: 'PurchaseOrder', name: 'Received', query: 'status:received', sort: null, columns: [], shared: true, position: 3 },
];

export default async function PurchaseOrdersPage({
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
      withSearch('/inventory/purchase-orders', query),
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
        title="Purchase orders"
        handle={handle}
        urlSegment="purchase_orders"
        resourceName={{ singular: 'purchase order', plural: 'purchase orders' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Create purchase order"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Purchase orders"
        title="Could not load purchase orders"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

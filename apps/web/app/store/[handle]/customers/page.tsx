/**
 * Web · app/store/[handle]/customers/page.tsx
 * Customers. The screen is the generic EntityList driven by the resource's own
 * declared columns — there is no customers-specific list component, which is the
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
  { field: 'firstName', label: 'Customer name', defaultVisible: true },
  { field: 'emailConsent', label: 'Email subscription', defaultVisible: true },
  { field: 'ordersCount', label: 'Orders', defaultVisible: true },
  { field: 'totalSpent', label: 'Amount spent', defaultVisible: true },
  { field: 'state', label: 'Account status', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Customer', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'subscribed', entity: 'Customer', name: 'Email subscribers', query: 'emailConsent:subscribed', sort: null, columns: [], shared: true, position: 1 },
  { id: 'active', entity: 'Customer', name: 'With accounts', query: 'state:active', sort: null, columns: [], shared: true, position: 2 },
];

export default async function CustomersPage({
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
      withSearch('/customers/customers', query),
      { storeId, permissions: ['customers.read', 'customers.manage'] },
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
        title="Customers"
        handle={handle}
        urlSegment="customers"
        resourceName={{ singular: 'customer', plural: 'customers' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add customer"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Customers"
        title="Could not load customers"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

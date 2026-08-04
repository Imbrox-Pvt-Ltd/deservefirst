/**
 * Web · app/store/[handle]/companies/page.tsx
 * Companies.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'name', label: 'Company', defaultVisible: true },
  { field: 'status', label: 'Status', defaultVisible: true },
  { field: 'locationCount', label: 'Locations', defaultVisible: true },
  { field: 'contactCount', label: 'Contacts', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Company', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
];

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const query = listQueryFrom(await searchParams, VIEWS);

  try {
    const response = await apiFetch<Record<string, unknown>[]>(withSearch('/customers/companies', query));

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
        title="Companies"
        handle={handle}
        urlSegment="companies"
        resourceName={{ singular: 'company', plural: 'companies' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add company"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Companies"
        title="Could not load companies"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

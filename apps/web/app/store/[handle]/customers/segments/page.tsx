/**
 * Web · app/store/[handle]/customers/segments/page.tsx
 * Segments — saved questions about customers, not saved lists of them.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../../components/EntityList';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../../lib/api';
import { listQueryFrom } from '../../../../../lib/stores';

const COLUMNS = [
  { field: 'name', label: 'Segment', defaultVisible: true },
  { field: 'match', label: 'Matches', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Segment', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
];

export default async function SegmentsPage({
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
      withSearch('/customers/segments', query),
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
        title="Segments"
        handle={handle}
        urlSegment="customers/segments"
        resourceName={{ singular: 'segment', plural: 'segments' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Create segment"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Segments"
        title="Could not load segments"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

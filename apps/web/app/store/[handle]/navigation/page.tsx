/**
 * Web · app/store/[handle]/navigation/page.tsx
 * Storefront menus. Lives at /navigation rather than /menus because that is the
 * captured URL, and the URL is the part a merchant bookmarks.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'title', label: 'Title', defaultVisible: true },
  { field: 'handle', label: 'Handle', defaultVisible: true },
];

// One view: a menu has no lifecycle to filter on. Inventing tabs here would be
// chrome the reference product does not have.
const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Menu', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
];

export default async function MenusPage({
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
      withSearch('/content/menus', query),
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
        title="Menus"
        handle={handle}
        urlSegment="navigation"
        resourceName={{ singular: 'menu', plural: 'menus' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add menu"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Menus"
        title="Could not load menus"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

/**
 * Web · app/store/[handle]/content/metaobjects/page.tsx
 * The content types a merchant has defined.
 *
 * Metaobjects are browsed definition-first — a merchant thinks "edit an Author",
 * not "edit entry 41" — so this lists definitions and the entries live one level
 * down, under the type they belong to.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../../components/EntityList';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../../lib/api';
import { listQueryFrom } from '../../../../../lib/stores';

const COLUMNS = [
  { field: 'name', label: 'Name', defaultVisible: true },
  { field: 'type', label: 'Type', defaultVisible: true },
  { field: 'description', label: 'Description', defaultVisible: true },
];

const VIEWS: SavedView[] = [
  { id: 'all', entity: 'MetaobjectDefinition', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
];

export default async function MetaobjectsPage({
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
      withSearch('/content/metaobject-definitions', query),
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
        title="Metaobjects"
        handle={handle}
        urlSegment="content/metaobjects"
        resourceName={{ singular: 'content type', plural: 'content types' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
        createLabel="Add definition"
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Metaobjects"
        title="Could not load content types"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

/**
 * Web · app/store/[handle]/messages/page.tsx
 * What customers sent through the storefront contact form.
 *
 * The counterpart to the POST surface: a form that stores a message nobody can
 * read is a form that loses it. This is where a merchant finds out somebody
 * asked whether they ship to Ireland.
 *
 * The views matter more than usual here. A single undifferentiated list of
 * everything ever received is one people stop opening, so "New" leads — a
 * message inbox is only useful if it can be emptied.
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { EntityList } from '../../../../components/EntityList';
import { ErrorState } from '../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../lib/api';
import { listQueryFrom } from '../../../../lib/stores';

const COLUMNS = [
  { field: 'email', label: 'From', defaultVisible: true },
  // The message is a column rather than something behind a click: the decision
  // "does this need an answer" is made by reading the first line.
  { field: 'body', label: 'Message', defaultVisible: true },
  { field: 'status', label: 'Status', defaultVisible: true },
  { field: 'createdAt', label: 'Received', defaultVisible: true },
];

/**
 * New first, and spam kept rather than hidden away.
 *
 * A merchant who thinks something was wrongly marked spam needs somewhere to
 * look — which is also why the platform never deletes one.
 */
const VIEWS: SavedView[] = [
  {
    id: 'new',
    entity: 'ContactMessage',
    name: 'New',
    query: 'status:new',
    sort: { field: 'createdAt', direction: 'desc' },
    columns: [],
    shared: true,
    position: 0,
  },
  {
    id: 'all',
    entity: 'ContactMessage',
    name: 'All',
    query: '',
    sort: { field: 'createdAt', direction: 'desc' },
    columns: [],
    shared: true,
    position: 1,
  },
  {
    id: 'spam',
    entity: 'ContactMessage',
    name: 'Spam',
    query: 'status:spam',
    sort: { field: 'createdAt', direction: 'desc' },
    columns: [],
    shared: true,
    position: 2,
  },
];

export default async function MessagesPage({
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
      withSearch('/storefront/contact-messages', query),
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
        title="Contact messages"
        handle={handle}
        urlSegment="messages"
        resourceName={{ singular: 'message', plural: 'messages' }}
        columns={COLUMNS}
        connection={connection}
        views={VIEWS}
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Contact messages"
        title="Could not load messages"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

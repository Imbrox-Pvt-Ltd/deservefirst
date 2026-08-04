/**
 * Web · app/store/[handle]/products/page.tsx
 * The products list. Server-rendered from the API using the URL's own search
 * params — the same string the browser holds is the one the API receives, so a
 * shared link reproduces exactly what the sender saw (§24.3).
 * Layer: web.
 */

import type { Connection, SavedView } from '@deservefirst/contracts';

import { ErrorState } from '../../../../components/ErrorState';
import { ProductsList } from '../../../../components/ProductsList';
import { apiFetch, withSearch } from '../../../../lib/api';
import type { ProductDto } from '../../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

/** Saved views come from the toolkit's saved_views table; these are the defaults. */
const VIEWS: SavedView[] = [
  { id: 'all', entity: 'Product', name: 'All', query: '', sort: null, columns: [], shared: true, position: 0 },
  { id: 'active', entity: 'Product', name: 'Active', query: 'status:active', sort: null, columns: [], shared: true, position: 1 },
  { id: 'draft', entity: 'Product', name: 'Drafts', query: 'status:draft', sort: null, columns: [], shared: true, position: 2 },
  { id: 'archived', entity: 'Product', name: 'Archived', query: 'status:archived', sort: null, columns: [], shared: true, position: 3 },
];

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const search = await searchParams;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  // Rebuild the query string verbatim — the list engine understands it directly,
  // so no screen has to translate URL state into an API call.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  // A saved view supplies its own filter when the URL carries no explicit query.
  const view = VIEWS.find((entry) => entry.id === query.get('savedViewId'));
  if (view && view.query && !query.get('query')) query.set('query', view.query);

  try {
    const response = await apiFetch<ProductDto[]>(
      withSearch('/catalog/products', query),
      { storeId },
    );

    const connection: Connection<ProductDto> = {
      nodes: response.data,
      pageInfo: response.meta.pagination ?? {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };

    return <ProductsList handle={handle} connection={connection} views={VIEWS} />;
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Products"
        title="Could not load products"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

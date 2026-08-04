/**
 * Web · app/store/[handle]/collections/[id]/page.tsx
 * The condition builder. Uses the module's own detail endpoint because the
 * generic reader returns rules as opaque JSON columns rather than the shape the
 * builder edits.
 * Layer: web.
 */

import { CollectionDetail } from '../../../../../components/CollectionDetail';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { CollectionDto } from '../../../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  try {
    const response = await apiFetch<CollectionDto>(`/catalog/collections/${id}/detail`, {
      storeId,
      permissions: ['catalog.read', 'catalog.write'],
    });
    return <CollectionDetail handle={handle} collection={response.data} />;
  } catch (error) {
    const notFound = isNotFound(error);
    return (
      <ErrorState
        pageTitle="Collection"
        backUrl={`/store/${handle}/collections`}
        tone={notFound ? 'warning' : 'critical'}
        title={notFound ? 'Collection not found' : 'Could not load collection'}
        message={
          notFound
            ? 'This collection does not exist in this store.'
            : error instanceof Error
              ? error.message
              : 'Unknown error'
        }
      />
    );
  }
}

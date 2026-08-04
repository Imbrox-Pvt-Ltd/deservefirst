/**
 * Web · app/store/[handle]/content/metaobjects/[id]/entries/new/page.tsx
 * A new entry of one content type.
 *
 * Its own route rather than an `entryId === 'new'` branch on the detail screen.
 * That branch worked, but it made "new" a reserved entry id and left the create
 * path invisible to anything reading the route tree — which is precisely how
 * eight other create screens went missing without anyone noticing.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../../../../components/ErrorState';
import { MetaobjectEntryForm } from '../../../../../../../../components/MetaobjectEntryForm';
import { apiFetch, isNotFound } from '../../../../../../../../lib/api';
import { storeIdFor } from '../../../../../../../../lib/stores';
import type { MetaobjectDefinitionDto } from '../../../../../../../../lib/types';

export default async function NewEntryPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    const definition = await apiFetch<MetaobjectDefinitionDto>(
      `/content/metaobject-definitions/${id}/detail`,
      { storeId: storeIdFor(handle), permissions: ['content.read', 'content.manage'] },
    );
    return <MetaobjectEntryForm handle={handle} definition={definition.data} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="New entry"
        title="Could not load this content type"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

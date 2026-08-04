/**
 * Web · app/store/[handle]/content/metaobjects/[id]/page.tsx
 * One content type: its fields, and the entries using them.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../../components/ErrorState';
import { MetaobjectDefinitionDetail } from '../../../../../../components/MetaobjectDefinitionDetail';
import { apiFetch, isNotFound } from '../../../../../../lib/api';
import { storeIdFor } from '../../../../../../lib/stores';
import type { MetaobjectDefinitionDto, MetaobjectEntryDto } from '../../../../../../lib/types';

const PERMISSIONS = ['content.read', 'content.manage', 'content.definitions.manage'];

export default async function DefinitionDetail({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    // One call: the entry list already carries its definition, because rendering
    // entries without it would mean guessing which field names each row.
    const response = await apiFetch<{
      definition: MetaobjectDefinitionDto;
      entries: MetaobjectEntryDto[];
    }>(`/content/metaobject-definitions/${id}/entries`, {
      storeId: storeIdFor(handle),
      permissions: PERMISSIONS,
    });

    return (
      <MetaobjectDefinitionDetail
        handle={handle}
        definition={response.data.definition}
        entries={response.data.entries}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Content type"
        title="Could not load this content type"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

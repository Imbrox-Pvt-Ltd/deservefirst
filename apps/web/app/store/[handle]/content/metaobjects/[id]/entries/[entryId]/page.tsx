/**
 * Web · app/store/[handle]/content/metaobjects/[id]/entries/[entryId]/page.tsx
 * One entry, on a form generated from its definition. `new` creates one.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../../../../components/ErrorState';
import { MetaobjectEntryForm } from '../../../../../../../../components/MetaobjectEntryForm';
import { apiFetch, isNotFound } from '../../../../../../../../lib/api';
import { storeIdFor } from '../../../../../../../../lib/stores';
import type { MetaobjectDefinitionDto, MetaobjectEntryDto } from '../../../../../../../../lib/types';

const PERMISSIONS = ['content.read', 'content.manage'];

export default async function EntryDetail({
  params,
}: {
  params: Promise<{ handle: string; id: string; entryId: string }>;
}) {
  const { handle, id, entryId } = await params;
  const scope = { storeId: storeIdFor(handle), permissions: PERMISSIONS };

  try {
    // Creating still needs the definition — it is what the form is generated
    // from — so the two cases differ only in whether an entry comes with it.
    if (entryId === 'new') {
      const definition = await apiFetch<MetaobjectDefinitionDto>(
        `/content/metaobject-definitions/${id}/detail`,
        scope,
      );
      return <MetaobjectEntryForm handle={handle} definition={definition.data} />;
    }

    const response = await apiFetch<{
      definition: MetaobjectDefinitionDto;
      entry: MetaobjectEntryDto;
    }>(`/content/metaobjects/${entryId}/detail`, scope);

    return (
      <MetaobjectEntryForm
        handle={handle}
        definition={response.data.definition}
        entry={response.data.entry}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Entry"
        title="Could not load this entry"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

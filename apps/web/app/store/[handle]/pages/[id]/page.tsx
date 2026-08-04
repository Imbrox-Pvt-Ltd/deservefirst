/**
 * Web · app/store/[handle]/pages/[id]/page.tsx
 * One page, at the reference admin's own URL.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../components/ErrorState';
import { PageEditor } from '../../../../../components/PageEditor';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import { storeIdFor } from '../../../../../lib/stores';
import type { PageDto } from '../../../../../lib/types';

export default async function PageDetail({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    const response = await apiFetch<PageDto>(`/content/pages/${id}/detail`, {
      storeId: storeIdFor(handle),
      permissions: ['content.read', 'content.manage', 'content.publish'],
    });
    return <PageEditor handle={handle} page={response.data} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Page"
        title="Could not load this page"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

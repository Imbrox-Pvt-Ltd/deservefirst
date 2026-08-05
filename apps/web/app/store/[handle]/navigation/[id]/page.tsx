/**
 * Web · app/store/[handle]/navigation/[id]/page.tsx
 * One menu, and its tree.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../components/ErrorState';
import { MenuEditor } from '../../../../../components/MenuEditor';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { MenuDto } from '../../../../../lib/types';

export default async function MenuDetail({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    const response = await apiFetch<MenuDto>(`/content/menus/${id}/detail`);
    return <MenuEditor handle={handle} menu={response.data} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Menu"
        title="Could not load this menu"
        message={error instanceof Error ? error.message : 'Unknown error'}
        backUrl={`/store/${handle}/navigation`}
      />
    );
  }
}

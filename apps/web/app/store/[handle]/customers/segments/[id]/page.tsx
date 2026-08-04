/**
 * Web · app/store/[handle]/customers/segments/[id]/page.tsx
 * One segment, with who currently matches it.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../../components/ErrorState';
import { SegmentDetail } from '../../../../../../components/SegmentDetail';
import { apiFetch, isNotFound } from '../../../../../../lib/api';
import type { CustomerDto, SegmentDto } from '../../../../../../lib/types';

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    // Two reads with different jobs: the segment's question, and the answer to
    // it right now. The count travels with the first because it is the only
    // number that says whether the conditions describe anybody.
    const [segment, members] = await Promise.all([
      apiFetch<SegmentDto>(`/customers/segments/${id}/detail`),
      apiFetch<{ members: CustomerDto[] }>(`/customers/segments/${id}/members`),
    ]);

    return <SegmentDetail handle={handle} segment={segment.data} members={members.data.members} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Segment"
        title="Could not load this segment"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}

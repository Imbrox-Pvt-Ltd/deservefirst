/**
 * Web · app/store/[handle]/customers/segments/new/page.tsx
 * New segment — one condition to start; the builder refines it.
 * Layer: web.
 */

import { CreateForm } from '../../../../../../components/CreateForm';

export default async function NewSegmentPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="segment" handle={handle} />;
}

/**
 * Web · app/store/[handle]/collections/new/page.tsx
 * New collection — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="collection" handle={handle} />;
}

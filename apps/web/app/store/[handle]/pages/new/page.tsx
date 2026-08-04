/**
 * Web · app/store/[handle]/pages/new/page.tsx
 * New page — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="page" handle={handle} />;
}

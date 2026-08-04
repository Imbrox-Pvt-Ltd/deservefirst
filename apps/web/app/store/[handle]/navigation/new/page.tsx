/**
 * Web · app/store/[handle]/navigation/new/page.tsx
 * New menu — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewMenu({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="menu" handle={handle} />;
}

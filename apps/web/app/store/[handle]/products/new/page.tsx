/**
 * Web · app/store/[handle]/products/new/page.tsx
 * New product — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="product" handle={handle} />;
}

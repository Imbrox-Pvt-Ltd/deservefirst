/**
 * Web · app/store/[handle]/content/metaobjects/new/page.tsx
 * New content type — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../../components/CreateForm';

export default async function NewPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="metaobject-definition" handle={handle} />;
}

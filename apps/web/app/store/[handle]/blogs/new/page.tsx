/**
 * Web · app/store/[handle]/blogs/new/page.tsx
 * New blog post — rendered from the shared create-form declaration.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewBlogPost({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="blog-post" handle={handle} />;
}

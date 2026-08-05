/**
 * Web · app/store/[handle]/blogs/[id]/page.tsx
 * One blog post.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { BlogPostEditor } from '../../../../../components/BlogPostEditor';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { BlogPostDto } from '../../../../../lib/types';

export default async function BlogPostDetail({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    const response = await apiFetch<BlogPostDto>(`/content/blog_posts/${id}/detail`);
    return <BlogPostEditor handle={handle} post={response.data} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Blog post"
        title="Could not load this post"
        message={error instanceof Error ? error.message : 'Unknown error'}
        backUrl={`/store/${handle}/blogs`}
      />
    );
  }
}

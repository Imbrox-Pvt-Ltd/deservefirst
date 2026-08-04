/**
 * Content · domain/blog.ts
 * Blogs and their posts.
 *
 * Deliberately close to `Page`, because it is nearly the same thing with two
 * differences that matter: a post belongs to a blog, and a post can be
 * scheduled. Everything else — handles, draft/published, SEO — behaves the same
 * way on purpose, so a merchant who has learned pages already knows this.
 * Layer: domain (pure).
 */

import { ContentInvariantError } from './content';

export type PostStatus = 'draft' | 'published';

export interface Blog {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  /** Merchants moderate comments elsewhere; this records the policy only. */
  readonly commentPolicy: 'closed' | 'moderated' | 'open';
  readonly version: number;
}

export interface BlogPost {
  readonly id: string;
  readonly blogId: string;
  readonly title: string;
  readonly handle: string;
  readonly body: string;
  readonly excerpt: string | null;
  readonly author: string | null;
  readonly status: PostStatus;
  /**
   * When it goes live. May be in the future, which is what scheduling IS —
   * `status: 'published'` with a future date means "will publish", and the
   * storefront asks `isVisible` rather than reading the status.
   */
  readonly publishedAt: Date | null;
  readonly version: number;
}

export function assertBlogValid(blog: Blog): void {
  if (blog.title.trim().length === 0) throw new ContentInvariantError('title', 'is required');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(blog.handle)) {
    throw new ContentInvariantError('handle', 'must be lowercase letters, digits and hyphens');
  }
}

export function assertPostValid(post: BlogPost): void {
  if (post.title.trim().length === 0) throw new ContentInvariantError('title', 'is required');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(post.handle)) {
    throw new ContentInvariantError('handle', 'must be lowercase letters, digits and hyphens');
  }
  if (post.blogId.trim().length === 0) {
    throw new ContentInvariantError('blogId', 'a post must belong to a blog');
  }

  if (post.status === 'published') {
    // Publishing something empty is almost always a mis-click, and the place it
    // is noticed is the storefront.
    if (post.body.trim().length === 0) {
      throw new ContentInvariantError('body', 'a published post needs a body');
    }
    if (post.publishedAt === null) {
      throw new ContentInvariantError('publishedAt', 'a published post needs a date');
    }
  }
}

/**
 * Whether the storefront should show this post right now.
 *
 * Asked instead of reading `status`, because a scheduled post is `published`
 * with a future date — a storefront that filtered on status alone would publish
 * every scheduled post immediately, which is the whole point of scheduling and
 * exactly the bug that would reach a customer before anybody noticed.
 */
export function isVisible(post: BlogPost, now: Date): boolean {
  if (post.status !== 'published') return false;
  if (post.publishedAt === null) return false;
  return post.publishedAt.getTime() <= now.getTime();
}

/** Posts waiting for their date, for the "Scheduled" view. */
export function isScheduled(post: BlogPost, now: Date): boolean {
  return post.status === 'published' && post.publishedAt !== null && !isVisible(post, now);
}

/**
 * Storefront · domain/drops/content.ts
 * Pages, blogs, articles and comments.
 *
 * The one rule worth stating: a drop never decides whether something is
 * publishable, it only reports what it was handed. `page.published_at` is here
 * because themes render it; the decision that an unpublished page is not served
 * belongs to the route that loaded it, where it can be made once instead of
 * hoped for in every template.
 *
 * A theme that could reach a draft would be a content leak, and the reason it
 * cannot is that the loader never returns one — not that every theme remembers
 * to check.
 * Layer: domain (pure).
 */

import { defineDrop, dropList } from './define';

export interface PageRow {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly body?: string | null;
  readonly templateSuffix?: string | null;
  readonly author?: string | null;
  readonly publishedAt?: string | Date | null;
  readonly createdAt?: string | Date | null;
  readonly updatedAt?: string | Date | null;
}

export interface BlogRow {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly commentPolicy?: string | null;
}

export interface ArticleRow {
  readonly id: string;
  readonly blogId: string;
  readonly handle: string;
  readonly title: string;
  readonly body?: string | null;
  readonly excerpt?: string | null;
  readonly author?: string | null;
  readonly imageId?: string | null;
  readonly tags?: readonly string[] | null;
  readonly publishedAt?: string | Date | null;
  readonly updatedAt?: string | Date | null;
  readonly commentCount?: number | null;
}

export interface CommentRow {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly status?: string | null;
  readonly createdAt?: string | Date | null;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Plain text from HTML, for an excerpt or a meta description.
 *
 * Tags are replaced with a space rather than removed, or `<p>a</p><p>b</p>`
 * becomes "ab" and two sentences run together in every search result.
 */
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const pageDrop = defineDrop<PageRow>('page', {
  id: (page) => page.id,
  handle: (page) => page.handle,
  title: (page) => page.title,
  content: (page) => page.body ?? '',
  author: (page) => page.author ?? '',
  url: (page) => `/pages/${page.handle}`,
  template_suffix: (page) => page.templateSuffix ?? null,
  published_at: (page) => isoOrNull(page.publishedAt),
  created_at: (page) => isoOrNull(page.createdAt),
  updated_at: (page) => isoOrNull(page.updatedAt),
});

export const commentDrop = defineDrop<CommentRow>('comment', {
  id: (comment) => comment.id,
  author: (comment) => comment.author,
  content: (comment) => comment.content,
  /**
   * No email address, ever.
   *
   * A comment carries the address its author submitted, and a theme rendering a
   * comment list would publish every one of them to anybody who reads the page.
   * Themes have never needed it; the merchant sees it in the admin.
   */
  status: (comment) => comment.status ?? 'published',
  created_at: (comment) => isoOrNull(comment.createdAt),
});

export const articleDrop = defineDrop<ArticleRow>('article', {
  id: (article) => article.id,
  handle: (article) => article.handle,
  title: (article) => article.title,
  content: (article) => article.body ?? '',
  /**
   * A written excerpt if there is one, otherwise the opening of the body.
   *
   * `excerpt_or_content` is what themes actually use in a card, and having it
   * here means one behaviour rather than each theme's own truncation.
   */
  excerpt: (article) => article.excerpt ?? '',
  excerpt_or_content: (article) =>
    article.excerpt && article.excerpt.trim() !== '' ? article.excerpt : (article.body ?? ''),
  author: (article) => article.author ?? '',
  tags: (article) => article.tags ?? [],

  image: (article, context) => {
    if (!article.imageId) return null;
    const load = context.load.image as ((id: string) => unknown) | undefined;
    const image = load?.(article.imageId);
    if (!image) return null;
    const build = context.load.buildImageDrop as ((row: unknown) => unknown) | undefined;
    return build ? build(image) : image;
  },

  comments: (article, context) => {
    const load = context.load.commentsOfArticle as
      | ((id: string) => readonly CommentRow[])
      | undefined;
    return dropList(commentDrop, load?.(article.id) ?? [], context);
  },
  comments_count: (article) => article.commentCount ?? 0,
  comments_enabled: (article, context) => {
    const policy = context.load.commentPolicyOfArticle as ((id: string) => string) | undefined;
    return (policy?.(article.id) ?? 'closed') !== 'closed';
  },

  url: (article, context) => {
    const blog = context.load.blogOfArticle as ((id: string) => BlogRow | null) | undefined;
    const handle = blog?.(article.blogId)?.handle;
    return handle ? `/blogs/${handle}/${article.handle}` : `/articles/${article.handle}`;
  },
  published_at: (article) => isoOrNull(article.publishedAt),
  updated_at: (article) => isoOrNull(article.updatedAt),

  /** For a meta description, where markup would be noise. */
  summary: (article) => plainText(article.excerpt ?? article.body ?? '').slice(0, 320),
});

export const blogDrop = defineDrop<BlogRow>('blog', {
  id: (blog) => blog.id,
  handle: (blog) => blog.handle,
  title: (blog) => blog.title,
  url: (blog) => `/blogs/${blog.handle}`,
  comments_enabled: (blog) => (blog.commentPolicy ?? 'closed') !== 'closed',
  moderated: (blog) => blog.commentPolicy === 'moderated',

  articles: (blog, context) => {
    const load = context.load.articlesOfBlog as ((id: string) => readonly ArticleRow[]) | undefined;
    return dropList(articleDrop, load?.(blog.id) ?? [], context);
  },
  articles_count: (blog, context) =>
    (context.load.articleCountOfBlog as ((id: string) => number) | undefined)?.(blog.id) ?? 0,
  all_tags: (blog, context) =>
    (context.load.tagsOfBlog as ((id: string) => readonly string[]) | undefined)?.(blog.id) ?? [],
});

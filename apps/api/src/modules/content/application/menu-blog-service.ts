/**
 * Content · application/menu-blog-service.ts
 * Creating and editing menus and blog posts.
 *
 * Thin on purpose. The rules that matter — tree depth, cycles, `javascript:`
 * links, what "published" means when the date is in the future — are in the
 * domain, and these two services do ordering and identity around them.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import type { Connection, ListQuery } from '@deservefirst/contracts';

import {
  assertMenuValid,
  assertPostValid,
  type BlogPost,
  type Menu,
} from '../domain';
// The module's existing not-found error, so both halves of content answer the
// same way and the transport keeps one mapping.
import { ContentNotFoundError } from './index';

/**
 * What both services need from storage — matching the aggregate repository
 * exactly, rather than a shape it happens to satisfy. `update` takes the
 * expected version and throws on a mismatch; it does not return a boolean.
 */
interface Store<T> {
  list(query: ListQuery): Promise<Connection<T>>;
  findById(id: string): Promise<T | null>;
  insert(entity: T): Promise<T>;
  update(entity: T, expectedVersion: number): Promise<T>;
  takenHandles(prefix: string): Promise<ReadonlySet<string>>;
}

export class HandleTakenError extends Error {
  readonly status = 409;
  constructor(what: string, handle: string) {
    super(`A ${what} with the handle "${handle}" already exists.`);
    this.name = 'HandleTakenError';
  }
}

export class MenuService {
  constructor(private readonly menus: Store<Menu>) {}

  list(query: ListQuery): Promise<Connection<Menu>> {
    return this.menus.list(query);
  }

  async get(id: string): Promise<Menu> {
    const menu = await this.menus.findById(id);
    if (!menu) throw new ContentNotFoundError('Menu', id);
    return menu;
  }

  async create(input: { title: string; handle: string; items?: Menu['items'] }): Promise<Menu> {
    const menu: Menu = {
      id: randomUUID(),
      title: input.title.trim(),
      handle: input.handle.trim().toLowerCase(),
      items: input.items ?? [],
      version: 1,
    };
    assertMenuValid(menu);

    // Checked before the insert so the merchant gets "that handle is taken"
    // rather than a unique-constraint error naming a column.
    const taken = await this.menus.takenHandles(menu.handle);
    if (taken.has(menu.handle)) {
      throw new HandleTakenError('menu', menu.handle);
    }

    return this.menus.insert(menu);
  }

  async save(id: string, version: number, patch: Partial<Pick<Menu, 'title' | 'items'>>): Promise<Menu> {
    const current = await this.get(id);
    const next: Menu = {
      ...current,
      ...defined(patch),
      title: patch.title?.trim() ?? current.title,
      /**
       * The NEXT version, not the one the caller sent.
       *
       * The repository writes `entity.version` and matches on the expected one.
       * Passing the caller's version for both wrote the same number back, so the
       * row never advanced and a stale save kept succeeding forever — silently
       * overwriting whoever saved first, which is the exact failure the version
       * column exists to prevent.
       */
      version: version + 1,
    };
    assertMenuValid(next);
    // The repository decides the outcome from affected rows and throws its own
    // stale-write error, which the transport already maps to a 409.
    return this.menus.update(next, version);
  }
}

export class BlogPostService {
  constructor(private readonly posts: Store<BlogPost>) {}

  list(query: ListQuery): Promise<Connection<BlogPost>> {
    return this.posts.list(query);
  }

  async get(id: string): Promise<BlogPost> {
    const post = await this.posts.findById(id);
    if (!post) throw new ContentNotFoundError('BlogPost', id);
    return post;
  }

  async create(input: {
    blogId: string;
    title: string;
    body?: string;
    handle?: string;
  }): Promise<BlogPost> {
    const post: BlogPost = {
      id: randomUUID(),
      blogId: input.blogId.trim(),
      title: input.title.trim(),
      handle: (input.handle ?? slug(input.title)).trim().toLowerCase(),
      body: input.body ?? '',
      excerpt: null,
      author: null,
      // Always a draft. A post that went live the moment it was created is the
      // wrong default in every case, and publishing is one click away.
      status: 'draft',
      publishedAt: null,
      version: 1,
    };
    assertPostValid(post);
    return this.posts.insert(post);
  }

  async save(
    id: string,
    version: number,
    patch: Partial<Pick<BlogPost, 'title' | 'body' | 'excerpt' | 'author' | 'status' | 'publishedAt'>>,
  ): Promise<BlogPost> {
    const current = await this.get(id);
    // `version + 1` for the same reason as the menu above: the repository
    // writes what it is given and matches on what it is told to expect.
    const next: BlogPost = { ...current, ...defined(patch), version: version + 1 };

    // Publishing with no date means "now". Leaving it null would make the post
    // published and permanently invisible, since `isVisible` needs a date.
    if (next.status === 'published' && next.publishedAt === null) {
      Object.assign(next, { publishedAt: new Date() });
    }
    assertPostValid(next);
    return this.posts.update(next, version);
  }
}

/**
 * Drops keys whose value is `undefined`.
 *
 * `{...current, ...patch}` looks like "apply what changed" and is not: a patch
 * carrying `title: undefined` — which is what a controller produces for a field
 * the caller omitted — overwrites the real title with nothing, and the next
 * validation fails on `undefined.trim()` a long way from the cause. The nav DTO
 * had exactly this bug with icons; it is the spread that is wrong, not the
 * caller.
 */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** A handle from a title, so a merchant does not have to invent one. */
function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'post'
  );
}

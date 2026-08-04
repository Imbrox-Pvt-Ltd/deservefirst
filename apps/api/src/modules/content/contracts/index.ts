/**
 * Content · contracts/index.ts
 * The only surface other modules may import.
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

export interface PageSummary {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly status: 'draft' | 'published';
}

export interface PagePublishedPayload {
  readonly pageId: string;
  readonly handle: string;
  /** SEO listens for this to keep the sitemap current (§34.1). */
  readonly path: string;
}

export const pageResource: ResourceDefinition = {
  name: 'Page',
  entity: 'Page',
  pluralName: 'Pages',
  urlSegment: 'pages',
  aggregateRoot: 'Page',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'title', type: 'string', required: true, filterable: true, sortable: true, searchable: true, translatable: true },
    { name: 'handle', type: 'handle', unique: true, indexed: true, filterable: true, translatable: true },
    { name: 'body', type: 'richtext', searchable: true, translatable: true },
    { name: 'status', type: 'enum', values: ['draft', 'published'], filterable: true, sortable: true },
    { name: 'templateSuffix', type: 'string', filterable: true },
    { name: 'publishedAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'title', label: 'Title', defaultVisible: true, position: 0 },
    { field: 'status', label: 'Visibility', defaultVisible: true, position: 1 },
    { field: 'publishedAt', label: 'Published', defaultVisible: true, position: 2 },
  ],
  permissions: { read: 'content.read', write: 'content.manage', delete: 'content.manage' },
};

export const metaobjectDefinitionResource: ResourceDefinition = {
  name: 'MetaobjectDefinition',
  entity: 'MetaobjectDefinition',
  pluralName: 'MetaobjectDefinitions',
  urlSegment: 'metaobject-definitions',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'type', type: 'string', unique: true, indexed: true, filterable: true, searchable: true },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'description', type: 'text' },
    { name: 'fields', type: 'json' },
    { name: 'displayNameKey', type: 'string' },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'content.read', write: 'content.definitions.manage' },
};

export const metaobjectEntryResource: ResourceDefinition = {
  name: 'MetaobjectEntry',
  entity: 'MetaobjectEntry',
  pluralName: 'MetaobjectEntries',
  urlSegment: 'metaobjects',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'definitionId', type: 'reference', references: 'MetaobjectDefinition', indexed: true, filterable: true },
    { name: 'handle', type: 'handle', indexed: true, filterable: true, searchable: true },
    { name: 'values', type: 'json' },
    { name: 'status', type: 'enum', values: ['draft', 'published'], filterable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'content.read', write: 'content.manage' },
};

/**
 * A storefront menu.
 *
 * Its items are a tree and live in one JSON column rather than a table of rows
 * with parent pointers. A menu is always read and written whole — nobody edits
 * one item of it — so the join buys nothing and costs the ordering guarantees a
 * tree needs.
 */
export const menuResource: ResourceDefinition = {
  name: 'Menu',
  entity: 'Menu',
  pluralName: 'Menus',
  urlSegment: 'menus',
  aggregateRoot: 'Menu',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'title', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'handle', type: 'handle', unique: true, indexed: true, filterable: true },
    { name: 'items', type: 'json' },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'title', label: 'Title', defaultVisible: true, position: 0 },
    { field: 'handle', label: 'Handle', defaultVisible: true, position: 1 },
  ],
  permissions: { read: 'content.read', write: 'content.manage', delete: 'content.manage' },
};

export const blogResource: ResourceDefinition = {
  name: 'Blog',
  entity: 'Blog',
  pluralName: 'Blogs',
  urlSegment: 'blogs',
  aggregateRoot: 'Blog',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'title', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'handle', type: 'handle', unique: true, indexed: true, filterable: true },
    { name: 'commentPolicy', type: 'enum', values: ['closed', 'moderated', 'open'], filterable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  /**
   * No screens of its own.
   *
   * The captured nav says "Blog posts", not "Blogs" — a merchant manages posts
   * and the blog they sit in is a field on the post. Declaring list/detail here
   * would put a screen in the admin that the reference product does not have,
   * which is the drift that turns "matches the reference" into "similar to it".
   * It keeps its REST surface, because an app importing posts needs it.
   */
  screens: [],
  columns: [
    { field: 'title', label: 'Title', defaultVisible: true, position: 0 },
    { field: 'commentPolicy', label: 'Comments', defaultVisible: true, position: 1 },
  ],
  permissions: { read: 'content.read', write: 'content.manage', delete: 'content.manage' },
};

export const blogPostResource: ResourceDefinition = {
  name: 'BlogPost',
  entity: 'BlogPost',
  pluralName: 'Blog posts',
  urlSegment: 'blog_posts',
  aggregateRoot: 'BlogPost',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'blogId', type: 'reference', references: 'Blog', required: true, indexed: true, filterable: true },
    { name: 'title', type: 'string', required: true, filterable: true, sortable: true, searchable: true, translatable: true },
    { name: 'handle', type: 'handle', indexed: true, filterable: true, translatable: true },
    { name: 'body', type: 'richtext', searchable: true, translatable: true },
    { name: 'excerpt', type: 'text', translatable: true },
    { name: 'author', type: 'string', filterable: true },
    { name: 'status', type: 'enum', values: ['draft', 'published'], filterable: true, sortable: true },
    // Sortable and filterable because "scheduled" is a view over this, not a
    // separate status — see `isVisible`.
    { name: 'publishedAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'title', label: 'Title', defaultVisible: true, position: 0 },
    { field: 'status', label: 'Visibility', defaultVisible: true, position: 1 },
    { field: 'publishedAt', label: 'Published', defaultVisible: true, position: 2 },
  ],
  permissions: { read: 'content.read', write: 'content.manage', delete: 'content.manage' },
};

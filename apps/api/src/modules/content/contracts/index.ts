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

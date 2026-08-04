/**
 * Content · content.manifest.ts
 * Pages and metaobjects. The first module where SEO genuinely applies — a page
 * IS the destination, where a product is usually reached through a collection.
 *
 * Metaobject definitions are the interesting part: a merchant inventing a
 * content type never triggers a migration, because the definition and its
 * entries are data (§17.4). That is what lets millions of tenants have their own
 * structure on shared tables.
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

import {
  metaobjectDefinitionResource,
  metaobjectEntryResource,
  pageResource,
} from './contracts';

export const contentManifest: ModuleManifest = {
  id: 'content',
  version: '0.1.0',
  label: 'Content',
  description: 'Pages and merchant-defined content types.',

  entitlementKey: 'content',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
  ],

  capabilities: ['entities', 'resources', 'routes', 'navigation', 'permissions', 'events', 'search', 'seo'],

  entities: [
    {
      name: 'Page',
      tableName: 'pages',
      // The one entity so far that genuinely needs SEO.
      toolkit: { seo: true },
      translatableFields: ['title', 'body', 'handle'],
    },
    {
      name: 'MetaobjectDefinition',
      tableName: 'metaobject_definitions',
      toolkit: { metafields: false, tags: false, savedViews: false, seo: false, importExport: false },
    },
    {
      name: 'MetaobjectEntry',
      tableName: 'metaobject_entries',
      toolkit: { metafields: false, seo: false },
      translatableFields: ['handle'],
    },
  ],

  resources: [pageResource, metaobjectDefinitionResource, metaobjectEntryResource],

  routes: [
    { path: '/store/:handle/pages', screen: 'ListScreen', entity: 'Page', permission: 'content.read' },
    { path: '/store/:handle/pages/new', screen: 'CreateScreen', entity: 'Page', permission: 'content.manage' },
    { path: '/store/:handle/pages/:id', screen: 'DetailScreen', entity: 'Page', permission: 'content.read' },
    { path: '/store/:handle/content/metaobjects', screen: 'ListScreen', entity: 'MetaobjectEntry', permission: 'content.read' },
    { path: '/store/:handle/content/metaobject-definitions', screen: 'ListScreen', entity: 'MetaobjectDefinition', permission: 'content.read' },
  ],

  navigation: [
    {
      id: 'content',
      label: 'Content',
      path: '/store/:handle/pages',
      section: 'primary',
      position: 40,
      permission: 'content.read',
    },
  ],

  permissions: [
    { key: 'content.read', label: 'View content', description: 'Open pages and content types.', categories: ['organization', 'store'] },
    { key: 'content.manage', label: 'Manage content', description: 'Create and edit pages and entries.', categories: ['organization', 'store'] },
    { key: 'content.publish', label: 'Publish content', description: 'Make pages publicly visible.', categories: ['organization', 'store'] },
    { key: 'content.definitions.manage', label: 'Manage content types', description: 'Define new content types and their fields.', categories: ['organization'] },
  ],

  events: [
    { type: 'content.page.published', version: 1, label: 'Page published', description: 'A page became publicly visible; SEO updates the sitemap.', direction: 'emits' },
    { type: 'content.page.unpublished', version: 1, label: 'Page unpublished', description: 'A page was hidden.', direction: 'emits' },
    { type: 'content.definition.created', version: 1, label: 'Content type created', description: 'A merchant defined a new content type — no migration involved.', direction: 'emits' },
  ],

  searchProviders: [
    { entity: 'Page', indexKey: 'pages', permission: 'content.read', fields: ['title', 'handle', 'body'] },
  ],

  lifecycle: { startup: 'lazy' },
};

export default contentManifest;

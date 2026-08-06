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
  policyResource,
  menuResource,
  blogResource,
  blogPostResource,
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

  capabilities: ['entities', 'resources', 'routes', 'navigation', 'permissions', 'events', 'search', 'dashboards', 'seo'],

  entities: [
    {
      name: 'Page',
      tableName: 'pages',
      // The one entity so far that genuinely needs SEO.
      toolkit: { seo: true },
      translatableFields: ['title', 'body', 'handle'],
    },
    {
      name: 'Policy',
      tableName: 'policies',
      // A policy is a page a shopper lands on, so it gets the same SEO surface.
      toolkit: { seo: true },
      translatableFields: ['title', 'body', 'handle'],
    },
    {
      name: 'Menu',
      tableName: 'menus',
      // No SEO: a menu is navigation, not a page anybody lands on.
      toolkit: { metafields: false, seo: false, importExport: false },
    },
    {
      name: 'Blog',
      tableName: 'blogs',
      toolkit: { seo: true },
      translatableFields: ['title', 'handle'],
    },
    {
      name: 'BlogPost',
      tableName: 'blog_posts',
      toolkit: { seo: true },
      translatableFields: ['title', 'body', 'excerpt', 'handle'],
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

  resources: [
    pageResource,
    policyResource,
    menuResource,
    blogResource,
    blogPostResource,
    metaobjectDefinitionResource,
    metaobjectEntryResource,
  ],

  routes: [
    { path: '/store/:handle/navigation', screen: 'ListScreen', entity: 'Menu', permission: 'content.read' },
    { path: '/store/:handle/navigation/new', screen: 'CreateScreen', entity: 'Menu', permission: 'content.manage' },
    { path: '/store/:handle/navigation/:id', screen: 'DetailScreen', entity: 'Menu', permission: 'content.read' },
    { path: '/store/:handle/blogs', screen: 'ListScreen', entity: 'BlogPost', permission: 'content.read' },
    { path: '/store/:handle/blogs/new', screen: 'CreateScreen', entity: 'BlogPost', permission: 'content.manage' },
    { path: '/store/:handle/blogs/:id', screen: 'DetailScreen', entity: 'BlogPost', permission: 'content.read' },
    { path: '/store/:handle/pages', screen: 'ListScreen', entity: 'Page', permission: 'content.read' },
    { path: '/store/:handle/pages/new', screen: 'CreateScreen', entity: 'Page', permission: 'content.manage' },
    { path: '/store/:handle/pages/:id', screen: 'DetailScreen', entity: 'Page', permission: 'content.read' },
    /**
     * Policies are listed and edited, never created or deleted from here.
     *
     * Which policies exist is decided by the platform, not by a merchant — a
     * theme asks for `shop.refund_policy` by name, so a merchant inventing a
     * seventh kind would produce a record nothing could ever read. Writing the
     * body is the merchant's job; deciding the set is not.
     */
    { path: '/store/:handle/settings/policies', screen: 'ListScreen', entity: 'Policy', permission: 'content.read' },
    { path: '/store/:handle/settings/policies/:id', screen: 'DetailScreen', entity: 'Policy', permission: 'content.read' },
    // Metaobjects are browsed definition-first: a merchant thinks "edit an
    // Author", not "edit entry 41". The definition id is therefore part of the
    // path rather than a filter on a flat entry list.
    { path: '/store/:handle/content/metaobjects', screen: 'ListScreen', entity: 'MetaobjectDefinition', permission: 'content.read' },
    { path: '/store/:handle/content/metaobjects/new', screen: 'CreateScreen', entity: 'MetaobjectDefinition', permission: 'content.manage' },
    { path: '/store/:handle/content/metaobjects/:id', screen: 'DetailScreen', entity: 'MetaobjectDefinition', permission: 'content.read' },
    { path: '/store/:handle/content/metaobjects/:id/entries', screen: 'ListScreen', entity: 'MetaobjectEntry', permission: 'content.read' },
    { path: '/store/:handle/content/metaobjects/:id/entries/new', screen: 'CreateScreen', entity: 'MetaobjectEntry', permission: 'content.manage' },
    { path: '/store/:handle/content/metaobjects/:id/entries/:entryId', screen: 'DetailScreen', entity: 'MetaobjectEntry', permission: 'content.read' },
  ],

  navigation: [
    {
      // "Content" opens Pages — the captured nav lists Metaobjects, Files,
      // Menus and Blog posts beneath it, but not Pages, because Pages is the
      // section's own screen.
      id: 'content',
      label: 'Content',
      path: '/store/:handle/pages',
      section: 'primary',
      position: 40,
      permission: 'content.read',
    },
    {
      id: 'metaobjects',
      label: 'Metaobjects',
      path: '/store/:handle/content/metaobjects',
      parentId: 'content',
      section: 'primary',
      position: 41,
      permission: 'content.read',
    },
    // Positions match the captured nav order: Files sits between these two and
    // is still a placeholder, because it needs the CDN story first (§22).
    {
      id: 'menus',
      label: 'Menus',
      path: '/store/:handle/navigation',
      parentId: 'content',
      section: 'primary',
      position: 43,
      permission: 'content.read',
    },
    {
      id: 'blog-posts',
      label: 'Blog posts',
      path: '/store/:handle/blogs',
      parentId: 'content',
      section: 'primary',
      position: 44,
      permission: 'content.read',
    },
  ],

  dashboards: [
    {
      id: 'content.published-pages',
      label: 'Published pages',
      slot: 'home',
      permission: 'content.read',
      size: 'small',
      metric: 'publishedPages',
      href: '/store/:handle/pages?query=status%3Apublished',
      position: 50,
    },
  ],

  permissions: [
    { key: 'content.read', label: 'View content', description: 'Open pages and content types.', categories: ['organization', 'store'] },
    { key: 'content.manage', label: 'Manage content', description: 'Create and edit pages and entries.', categories: ['organization', 'store'] },
    { key: 'content.publish', label: 'Publish content', description: 'Make pages publicly visible.', categories: ['organization', 'store'] },
    { key: 'content.definitions.manage', label: 'Manage content types', description: 'Define new content types and their fields.', categories: ['organization'] },
  ],

  apiScopes: [
    {
      key: 'read_content', label: 'View content', family: 'Admin API', feature: 'Content',
      access: 'read', description: 'Read pages and metaobject entries.',
      grants: ['content.read'],
    },
    {
      key: 'write_content', label: 'Manage content', family: 'Admin API', feature: 'Content',
      access: 'write', description: 'Create and change pages and metaobject entries.',
      grants: ['content.read', 'content.manage', 'content.publish'],
    },
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

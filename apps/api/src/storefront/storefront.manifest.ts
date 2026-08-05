/**
 * Storefront · storefront.manifest.ts
 * What the storefront module declares.
 *
 * Two entities, both store-scoped, and both existing because the storefront
 * needed somewhere to keep state that until now lived only in a test fixture:
 * which theme is published, and which old URLs still need to lead somewhere.
 * Layer: manifest.
 */

import type { ModuleManifest } from '@deservefirst/contracts';

const STOREFRONT_TOOLKIT = {
  metafields: false,
  metaobjects: false,
  tags: false,
  savedViews: false,
  bulkActions: false,
  seo: false,
} as const;

export const storefrontManifest: ModuleManifest = {
  id: 'storefront',
  version: '0.1.0',
  label: 'Online store',
  description: 'The public storefront: themes, templates and the URLs customers arrive on.',

  entitlementKey: 'core',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'catalog', type: 'required' },
    { module: 'content', type: 'required' },
  ],

  /**
   * Every kind of thing declared below must be listed here.
   *
   * Not a duplicate of the declarations — it is what the composer reads to
   * decide what to wire. A manifest declaring `routes` without the capability
   * gets screens nobody can reach, which is why the validator refuses it rather
   * than composing half a module.
   */
  capabilities: ['entities', 'permissions', 'events', 'routes', 'navigation'],

  entities: [
    {
      /**
       * A theme a merchant has installed.
       *
       * `role` is what decides which one the public sees. Exactly one theme per
       * store may be `main`; the rest are drafts a merchant is working on, and
       * a preview of one is what the editor renders. Enforced by the service
       * rather than the column, because "exactly one" is a statement about the
       * set rather than about any row.
       */
      name: 'Theme',
      tableName: 'themes',
      toolkit: { ...STOREFRONT_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'name', type: 'string', required: true, searchable: true, sortable: true },
        { name: 'role', type: 'enum', values: ['main', 'unpublished', 'development'], filterable: true, indexed: true },
        /**
         * Where the theme's files are.
         *
         * A locator rather than the files themselves: a theme is hundreds of
         * files and several megabytes, which belongs in object storage rather
         * than in a row. The `ThemeSource` implementations read from whatever
         * this points at.
         */
        { name: 'sourceKind', type: 'enum', values: ['filesystem', 'object_store'], filterable: true },
        { name: 'sourceRef', type: 'string', required: true },
        { name: 'themeVersion', type: 'string' },
        { name: 'author', type: 'string' },
        { name: 'publishedAt', type: 'datetime', sortable: true, filterable: true },
        { name: 'createdAt', type: 'datetime', sortable: true },
        { name: 'updatedAt', type: 'datetime', sortable: true },
      ],
    },
    {
      /**
       * A URL that used to work.
       *
       * Its own entity rather than a column on whatever was renamed, because a
       * redirect outlives the record that caused it — a deleted product's links
       * still need to lead somewhere, and a foreign key to a deleted row does
       * not.
       */
      name: 'UrlRedirect',
      tableName: 'url_redirects',
      toolkit: { ...STOREFRONT_TOOLKIT, importExport: true, audit: true },
      fields: [
        { name: 'path', type: 'string', required: true, indexed: true, filterable: true, searchable: true },
        { name: 'target', type: 'string', required: true, searchable: true },
        /** Set when the platform created it, e.g. on a handle change. */
        { name: 'createdBySystem', type: 'boolean', filterable: true },
        { name: 'createdAt', type: 'datetime', sortable: true },
      ],
    },
  ],

  permissions: [
    {
      key: 'store.themes.read',
      label: 'View themes',
      description: 'See the themes installed on this store.',
      categories: ['store'],
    },
    {
      key: 'store.themes.manage',
      label: 'Manage themes',
      description: 'Install, edit and publish themes. Publishing changes what every customer sees.',
      categories: ['store'],
    },
    {
      key: 'store.redirects.manage',
      label: 'Manage URL redirects',
      description: 'Decide where old links lead.',
      categories: ['store'],
    },
  ],

  events: [
    {
      type: 'storefront.theme.published',
      version: 1,
      label: 'Theme published',
      description: 'A different theme became the one customers see.',
      direction: 'emits',
    },
    {
      type: 'storefront.redirect.created',
      version: 1,
      label: 'Redirect created',
      description: 'An old URL was given somewhere to lead.',
      direction: 'emits',
    },
  ],

  navigation: [
    {
      id: 'storefront',
      label: 'Online store',
      icon: 'StoreIcon',
      path: '/store/:handle/themes',
      // A storefront is a sales channel rather than a primary admin area: it is
      // where the store is presented, not where its records are edited.
      section: 'sales-channels',
      position: 10,
      permission: 'store.themes.read',
    },
  ],

  routes: [
    { path: '/store/:handle/themes', screen: 'ListScreen', entity: 'Theme', permission: 'store.themes.read' },
    { path: '/store/:handle/themes/:id', screen: 'DetailScreen', entity: 'Theme', permission: 'store.themes.read' },
    { path: '/store/:handle/redirects', screen: 'ListScreen', entity: 'UrlRedirect', permission: 'store.redirects.manage' },
  ],
};

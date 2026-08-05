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

import { contactMessageResource, storeDomainResource } from './contracts';

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
  capabilities: ['entities', 'resources', 'permissions', 'events', 'routes', 'navigation'],

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
    {
      /**
       * One published state of a theme, kept forever.
       *
       * The row is the history; the files live in the version store under a
       * content-addressed reference. Rolling back is pointing a theme at an
       * older row, which is why nothing here is ever updated — a version that
       * could change would make a rollback land somewhere unpredictable.
       */
      name: 'ThemeVersion',
      tableName: 'theme_versions',
      toolkit: { ...STOREFRONT_TOOLKIT, timeline: false, audit: true },
      fields: [
        { name: 'themeId', type: 'reference', references: 'Theme', indexed: true, filterable: true },
        { name: 'versionRef', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'publishedAt', type: 'datetime', sortable: true, filterable: true },
        { name: 'publishedBy', type: 'string' },
        { name: 'createdAt', type: 'datetime', sortable: true },
      ],
    },
    {
      /**
       * A merchant's unsaved edits to one template.
       *
       * In the database rather than in memory, because an editor that forgets
       * unsaved work when a server restarts is one people learn not to trust.
       * Held apart from the theme's own files: a draft written into the theme
       * would be visible to customers the moment it was saved, which is the one
       * thing the editor must never do.
       */
      name: 'ThemeDraft',
      tableName: 'theme_drafts',
      toolkit: { ...STOREFRONT_TOOLKIT, timeline: false, audit: false },
      fields: [
        { name: 'themeId', type: 'reference', references: 'Theme', indexed: true, filterable: true },
        { name: 'templatePath', type: 'string', required: true, indexed: true },
        /** The whole document, as the editor model holds it. */
        { name: 'document', type: 'json' },
        /** The editor's own version, for the conflict check. Not the row's. */
        { name: 'documentVersion', type: 'integer' },
        { name: 'updatedBy', type: 'string' },
        { name: 'createdAt', type: 'datetime', sortable: true },
        { name: 'updatedAt', type: 'datetime', sortable: true },
      ],
    },
    {
      /**
       * A message somebody sent through the storefront's contact form.
       *
       * Its own entity rather than a Request with no lines. A contact message is
       * not an order at any stage of its life, and putting one in the quote
       * pipeline would fill a merchant's RFQ queue with "do you ship to
       * Ireland?" — which is how a queue stops being read.
       */
      name: 'ContactMessage',
      tableName: 'contact_messages',
      toolkit: { ...STOREFRONT_TOOLKIT, timeline: true, audit: false },
      fields: [
        { name: 'email', type: 'string', required: true, filterable: true, searchable: true },
        { name: 'name', type: 'string', searchable: true },
        { name: 'body', type: 'text', required: true, searchable: true },
        { name: 'status', type: 'enum', values: ['new', 'read', 'replied', 'spam'], filterable: true, indexed: true },
        /**
         * Where it came from. Not shown to anyone by default — it is here so a
         * merchant drowning in spam can see a pattern and we can act on it.
         */
        { name: 'sourcePath', type: 'string' },
        { name: 'createdAt', type: 'datetime', sortable: true },
      ],
    },
    {
      /**
       * A hostname a merchant has connected to their store.
       *
       * The row exists from the moment it is claimed, in `pending`, and that is
       * the point: it records a claim, and the claim is worthless until
       * `verifiedAt` is set. Nothing is served on the strength of a row alone —
       * `isServable` is the only thing the resolver asks, and it asks about
       * status rather than existence.
       *
       * `host` is indexed because it is looked up on every anonymous request
       * that arrives on a hostname we do not otherwise recognise, which on a
       * busy platform is the hottest query the storefront makes.
       */
      name: 'StoreDomain',
      tableName: 'store_domains',
      toolkit: { ...STOREFRONT_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'host', type: 'string', required: true, indexed: true, filterable: true, searchable: true },
        /**
         * Exactly one primary per store, computed over the set rather than
         * constrained on the column — the same reasoning as a theme's `main`
         * role, and for the same reason: "exactly one" is a statement about the
         * set, not about any row.
         */
        { name: 'role', type: 'enum', values: ['primary', 'alias'], filterable: true, indexed: true },
        { name: 'status', type: 'enum', values: ['pending', 'verified', 'failed'], filterable: true, indexed: true },
        /**
         * The value the merchant publishes in DNS to prove they own this name.
         *
         * Per domain and never reused, so a token observed on one domain cannot
         * be replayed to claim another.
         */
        { name: 'verificationToken', type: 'string', required: true },
        /** Null until ownership was proved. This is what gates serving. */
        { name: 'verifiedAt', type: 'datetime', sortable: true, filterable: true },
        /** When we last looked, so a merchant knows whether to wait or retry. */
        { name: 'lastCheckedAt', type: 'datetime', sortable: true },
        /** Whether traffic actually arrives. Diagnostic, never a gate. */
        { name: 'reachesUs', type: 'boolean', filterable: true },
        { name: 'createdAt', type: 'datetime', sortable: true },
        { name: 'updatedAt', type: 'datetime', sortable: true },
      ],
    },
  ],

  /**
   * Declared here, and the generic read surface does the rest.
   *
   * A list and a get come from the declaration alone — writing a controller for
   * them would be a second way into the same rows, and the two would eventually
   * disagree about filtering.
   */
  resources: [contactMessageResource, storeDomainResource],

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
      key: 'store.messages.read',
      label: 'Read contact messages',
      description: 'See what customers sent through the storefront contact form.',
      categories: ['store'],
    },
    {
      key: 'store.redirects.manage',
      label: 'Manage URL redirects',
      description: 'Decide where old links lead.',
      categories: ['store'],
    },
    {
      /**
       * Its own permission rather than the general settings one.
       *
       * Connecting a hostname decides where every customer of this store lands,
       * and disconnecting the primary one moves the whole shop. That is a
       * larger blast radius than most of what lives under settings, and staff
       * who may change a shipping rate should not inherit it by accident.
       */
      key: 'store.domains.manage',
      label: 'Manage domains',
      description:
        'Connect and verify the hostnames this store answers on, and choose the primary one.',
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
    { path: '/store/:handle/messages', screen: 'ListScreen', entity: 'ContactMessage', permission: 'store.messages.read' },
    /**
     * Under `/settings/` rather than beside themes, matching the reference
     * product's own placement — a domain is a store-wide setting, and a
     * merchant looking for it looks in settings.
     */
    { path: '/store/:handle/settings/domains', screen: 'ListScreen', entity: 'StoreDomain', permission: 'store.domains.manage' },
  ],
};

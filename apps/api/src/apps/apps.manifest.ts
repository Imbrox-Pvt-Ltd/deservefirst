/**
 * Apps · apps.manifest.ts
 * What the app platform declares: its tables, its permissions, its events.
 *
 * The scopes apps may request are NOT declared here. Each module declares its
 * own, because the module is what knows which of its data a scope opens — and a
 * central list would go stale the day somebody adds a module, in the direction
 * that quietly denies access rather than the one that grants it.
 * Layer: manifest.
 */

import type { ModuleManifest } from '@deservefirst/contracts';

/** App tables carry no merchant content, so most toolkit features are off. */
const APP_TOOLKIT = {
  metafields: false,
  metaobjects: false,
  tags: false,
  savedViews: false,
  bulkActions: false,
  importExport: false,
  seo: false,
} as const;

export const appsManifest: ModuleManifest = {
  id: 'apps',
  version: '0.1.0',
  label: 'Apps',
  description: 'Third-party apps, their installations, and the tokens they call with.',

  entitlementKey: 'core',
  dependsOn: [{ module: 'core', type: 'required' }],

  capabilities: ['entities', 'permissions', 'events'],

  entities: [
    {
      name: 'App',
      tableName: 'apps',
      // Platform scope: an app exists above any store, and is installed INTO
      // stores. Scoping the app itself to a store would mean one row per
      // install of the same software.
      scope: 'platform',
      toolkit: { ...APP_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'partnerId', type: 'reference', references: 'Partner', indexed: true, filterable: true },
        { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
        { name: 'status', type: 'enum', values: ['draft', 'published', 'suspended'], filterable: true },
        { name: 'distribution', type: 'enum', values: ['public', 'custom'], filterable: true },
        { name: 'appUrl', type: 'string' },
        { name: 'redirectUris', type: 'json' },
        { name: 'requestedScopes', type: 'json' },
        { name: 'clientId', type: 'string', unique: true, indexed: true, filterable: true },
        // Hashed, never stored in the clear: a database disclosure must not
        // hand somebody the ability to impersonate every installed app.
        { name: 'clientSecretHash', type: 'string', visibility: 'internal' },
        { name: 'webhookUrl', type: 'string' },
        // Recoverable, because an HMAC cannot be computed from a digest.
        { name: 'webhookSecret', type: 'string', visibility: 'internal' },
        // Shown to the merchants who installed it, so "it stopped working" has
        // an answer without a support ticket each.
        { name: 'suspendedReason', type: 'text' },
      ],
    },
    {
      name: 'AppInstallation',
      tableName: 'app_installations',
      scope: 'platform',
      toolkit: { ...APP_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'appId', type: 'reference', references: 'App', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', indexed: true, filterable: true },
        { name: 'status', type: 'enum', values: ['installed', 'uninstalled'], filterable: true },
        // The merchant's answer, frozen at consent — not read back off the app,
        // which can change what it asks for at any time.
        { name: 'grantedScopes', type: 'json' },
        { name: 'installedAt', type: 'datetime', sortable: true },
        { name: 'uninstalledAt', type: 'datetime', sortable: true },
      ],
    },
    {
      name: 'AppAuthorizationCode',
      tableName: 'app_authorization_codes',
      scope: 'platform',
      toolkit: { ...APP_TOOLKIT, timeline: false, softDelete: false },
      fields: [
        { name: 'code', type: 'string', unique: true, indexed: true },
        { name: 'appId', type: 'reference', references: 'App', indexed: true },
        { name: 'storeId', type: 'reference', references: 'Store', indexed: true },
        { name: 'userId', type: 'reference', references: 'User' },
        { name: 'redirectUri', type: 'string' },
        { name: 'scopes', type: 'json' },
        { name: 'tokenType', type: 'enum', values: ['online', 'offline'] },
        // The app's own CSRF token. Carried, never interpreted.
        { name: 'state', type: 'text' },
        { name: 'codeChallenge', type: 'string' },
        { name: 'codeChallengeMethod', type: 'string' },
        { name: 'expiresAt', type: 'datetime', filterable: true },
        /** Set on exchange. Its presence is what makes a code single-use. */
        { name: 'usedAt', type: 'datetime', filterable: true },
      ],
    },
    {
      name: 'AppToken',
      tableName: 'app_tokens',
      scope: 'platform',
      toolkit: { ...APP_TOOLKIT, timeline: false, softDelete: false },
      fields: [
        { name: 'appId', type: 'reference', references: 'App', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', indexed: true, filterable: true },
        { name: 'tokenType', type: 'enum', values: ['online', 'offline'], filterable: true },
        { name: 'userId', type: 'reference', references: 'User' },
        // Hashed for the same reason a password is: the database is not a place
        // to keep something that grants access on sight.
        { name: 'tokenHash', type: 'string', indexed: true, visibility: 'internal' },
        { name: 'scopes', type: 'json' },
        { name: 'expiresAt', type: 'datetime', filterable: true },
        { name: 'revokedAt', type: 'datetime', filterable: true },
      ],
    },

    {
      name: 'AppScopeApproval',
      tableName: 'app_scope_approvals',
      scope: 'platform',
      toolkit: { ...APP_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'appId', type: 'reference', references: 'App', indexed: true, filterable: true },
        // Per SCOPE, not per app: approving an app to read customer contact
        // details is not approving it for everything else it may later ask for.
        { name: 'scope', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'status', type: 'enum', values: ['approved', 'denied'], filterable: true },
        { name: 'decidedBy', type: 'reference', references: 'User' },
        { name: 'reason', type: 'text' },
        { name: 'decidedAt', type: 'datetime', sortable: true },
      ],
    },
  ],

  permissions: [
    {
      key: 'platform.apps.suspend',
      label: 'Suspend an app',
      description: 'Stop an app across every store it is installed on.',
      categories: ['platform'],
    },
    {
      key: 'platform.apps.review',
      label: 'Review app scope requests',
      description: 'Approve or deny an app asking for a restricted scope.',
      categories: ['platform'],
    },
    {
      key: 'store.apps.manage',
      label: 'Install and remove apps',
      description: 'Approve what an app may reach, and remove it.',
      categories: ['store'],
    },
    {
      key: 'partner.apps.manage',
      label: 'Manage apps',
      description: 'Register apps and change what they ask merchants for.',
      categories: ['partner'],
    },
  ],

  events: [
    { type: 'apps.app.installed', version: 1, label: 'App installed', description: 'A merchant installed an app.', direction: 'emits' },
    { type: 'apps.app.uninstalled', version: 1, label: 'App uninstalled', description: 'A merchant removed an app; its tokens stop working.', direction: 'emits' },
    { type: 'apps.app.suspended', version: 1, label: 'App suspended', description: 'An operator stopped an app across every store.', direction: 'emits' },
    { type: 'apps.app.unsuspended', version: 1, label: 'App unsuspended', description: 'An operator let a suspended app run again.', direction: 'emits' },
    { type: 'apps.scopes.updated', version: 1, label: 'App scopes changed', description: 'A merchant changed what an installed app may reach.', direction: 'emits' },
  ],

  lifecycle: { startup: 'eager' },
};

export default appsManifest;

/**
 * Core · platform.manifest.ts
 * Core's own entities, declared the same way a module declares its own.
 *
 * These four tables hold operator decisions, not tenant data: which modules the
 * platform permits, which each store has turned on, and the settings each level
 * has chosen. They belong to Core rather than to any module — a module cannot
 * own the switch that turns it off.
 *
 * Declaring them here rather than hand-writing DDL means `platform db:sync`
 * builds them from the same source as everything else, and the isolation checks
 * apply to them like any other table (§14.2).
 * Layer: core.
 */

import type { ModuleManifest } from '@deservefirst/contracts';

/**
 * Operator state, not business records: no metafields, no tags, no saved views.
 * Timeline stays ON — who turned a module off, and when, is exactly the question
 * asked after an incident.
 */
const OPERATOR_TOOLKIT = {
  metafields: false,
  metaobjects: false,
  tags: false,
  timeline: true,
  savedViews: false,
  seo: false,
  translations: false,
  importExport: false,
  softDelete: true,
} as const;

export const platformManifest: ModuleManifest = {
  id: 'platform',
  version: '1.0.0',
  label: 'Platform',
  description: 'Module availability and layered settings — the controls an operator uses.',
  capabilities: ['entities'],
  // Core is never itself gated by a plan: the switch cannot live behind the
  // thing it switches, and a plan that "does not include" module availability
  // would make the platform unadministrable. The key exists because the
  // manifest contract requires one; nothing bills against it.
  entitlementKey: 'platform',
  dependsOn: [],

  entities: [
    {
      // Platform-wide module state. `handle` carries the module id, so the base
      // entity's unique index is exactly the constraint we want: one decision
      // per module, enforced by the schema rather than by hoping.
      name: 'PlatformModuleState',
      tableName: 'platform_module_states',
      scope: 'platform',
      toolkit: OPERATOR_TOOLKIT,
      fields: [
        { name: 'moduleId', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'enabled', type: 'boolean', filterable: true },
        // Required when disabling: the person who finds a module missing is
        // never the person who turned it off.
        { name: 'reason', type: 'text' },
      ],
    },
    {
      name: 'StoreModuleState',
      tableName: 'store_module_states',
      toolkit: OPERATOR_TOOLKIT,
      fields: [
        { name: 'moduleId', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'enabled', type: 'boolean', filterable: true },
      ],
    },
    {
      // Registered by a store; delivered to by the platform. Store-scoped,
      // because who receives a store's events is the store's business.
      name: 'WebhookSubscription',
      tableName: 'webhook_subscriptions',
      toolkit: OPERATOR_TOOLKIT,
      fields: [
        { name: 'eventType', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'url', type: 'string', required: true },
        // Never returned after creation — see the service.
        { name: 'secret', type: 'string', required: true, visibility: 'private' },
        { name: 'status', type: 'enum', values: ['active', 'paused', 'disabled'], filterable: true },
        { name: 'consecutiveFailures', type: 'integer' },
        { name: 'disabledReason', type: 'text' },
      ],
    },
    {
      // The outbox. Rows are written before anything is sent and KEPT after —
      // the history is the answer to "we never received it".
      name: 'WebhookDelivery',
      tableName: 'webhook_deliveries',
      toolkit: { ...OPERATOR_TOOLKIT, timeline: false, softDelete: false },
      fields: [
        { name: 'subscriptionId', type: 'reference', references: 'WebhookSubscription', indexed: true },
        { name: 'eventId', type: 'string', indexed: true, filterable: true },
        { name: 'eventType', type: 'string', indexed: true, filterable: true },
        { name: 'payload', type: 'text' },
        { name: 'status', type: 'enum', values: ['pending', 'delivered', 'failed', 'dead'], filterable: true },
        { name: 'attempts', type: 'integer' },
        { name: 'responseStatus', type: 'integer' },
        { name: 'error', type: 'text' },
        { name: 'nextAttemptAt', type: 'datetime', indexed: true, sortable: true },
        { name: 'deliveredAt', type: 'datetime', sortable: true },
      ],
    },
    {
      name: 'PlatformSetting',
      tableName: 'platform_settings',
      scope: 'platform',
      toolkit: OPERATOR_TOOLKIT,
      fields: [
        { name: 'settingKey', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'value', type: 'json' },
      ],
    },
    {
      name: 'StoreSetting',
      tableName: 'store_settings',
      toolkit: OPERATOR_TOOLKIT,
      fields: [
        { name: 'settingKey', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'value', type: 'json' },
      ],
    },
  ],

  permissions: [
    {
      key: 'platform.modules.manage',
      label: 'Enable and disable modules platform-wide',
      description:
        'Turn a module off for every store at once. This overrides every store setting and cannot be undone from a store.',
      categories: ['organization'],
    },
    {
      key: 'store.webhooks.manage',
      label: 'Manage webhook endpoints',
      description: 'Register where this store\'s events are delivered, and replay a delivery.',
      categories: ['organization', 'store'],
    },
    {
      key: 'platform.settings.manage',
      label: 'Set platform-wide setting defaults',
      description: 'Change the default a store inherits when it has not chosen its own.',
      categories: ['organization'],
    },
  ],
};

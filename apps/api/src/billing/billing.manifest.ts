/**
 * Billing · billing.manifest.ts
 * What the billing module declares.
 * Layer: manifest.
 */

import type { ModuleManifest } from '@deservefirst/contracts';

const BILLING_TOOLKIT = {
  metafields: false,
  metaobjects: false,
  tags: false,
  savedViews: false,
  bulkActions: false,
  importExport: false,
  seo: false,
} as const;

export const billingManifest: ModuleManifest = {
  id: 'billing',
  version: '0.1.0',
  label: 'App billing',
  description: 'How third-party apps charge merchants through the platform.',

  entitlementKey: 'core',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'apps', type: 'required' },
  ],

  capabilities: ['entities', 'permissions', 'events'],

  entities: [
    {
      name: 'AppCharge',
      tableName: 'app_charges',
      // Store-scoped: a charge is one merchant agreeing to one amount, and the
      // tenant guard should refuse any query that forgets which merchant.
      toolkit: { ...BILLING_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'appId', type: 'reference', references: 'App', indexed: true, filterable: true },
        { name: 'kind', type: 'enum', values: ['recurring', 'usage', 'one_time'], filterable: true },
        { name: 'name', type: 'string', required: true, searchable: true },
        { name: 'status', type: 'enum', values: ['pending', 'active', 'declined', 'cancelled', 'expired'], filterable: true },
        // Money is a pair of columns, never a float — the entity toolkit knows
        // how to store it and the list engine how to sort it.
        { name: 'price', type: 'money' },
        { name: 'interval', type: 'enum', values: ['every_30_days', 'annual'], filterable: true },
        { name: 'cappedAmount', type: 'money' },
        { name: 'balanceUsed', type: 'money' },
        { name: 'trialDays', type: 'integer' },
        { name: 'activatedAt', type: 'datetime', sortable: true, filterable: true },
        { name: 'currentPeriodEnd', type: 'datetime', sortable: true, filterable: true },
        { name: 'cancelledAt', type: 'datetime', filterable: true },
        { name: 'isTest', type: 'boolean', filterable: true },
      ],
    },
  ],

  permissions: [
    {
      key: 'store.billing.approve',
      label: 'Approve app charges',
      description: 'Agree to what an app charges this store.',
      categories: ['store'],
    },
    {
      key: 'store.billing.read',
      label: 'View app charges',
      description: 'See what apps are charging this store.',
      categories: ['organization', 'store'],
    },
  ],

  events: [
    { type: 'billing.charge.created', version: 1, label: 'Charge created', description: 'An app asked a merchant to approve a charge.', direction: 'emits' },
    { type: 'billing.charge.approved', version: 1, label: 'Charge approved', description: 'A merchant agreed to a charge.', direction: 'emits' },
    { type: 'billing.charge.declined', version: 1, label: 'Charge declined', description: 'A merchant refused a charge.', direction: 'emits' },
    { type: 'billing.charge.cancelled', version: 1, label: 'Charge cancelled', description: 'An active charge stopped.', direction: 'emits' },
  ],

  lifecycle: { startup: 'eager' },
};

export default billingManifest;

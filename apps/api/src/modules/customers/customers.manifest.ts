/**
 * Customers · customers.manifest.ts
 * The second product module, and therefore the real test of composition: its
 * navigation, routes, permissions and settings merge with catalog's into one
 * admin without either module knowing the other exists.
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

import { customerResource, segmentResource } from './contracts';

export const customersManifest: ModuleManifest = {
  id: 'customers',
  version: '0.1.0',
  label: 'Customers',
  description: 'Shoppers, their consent state, addresses and segments.',

  entitlementKey: 'customers',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
    // Optional on purpose: customers is useful without a catalog, and an unmet
    // optional dependency degrades this module rather than stopping the boot.
    { module: 'catalog', type: 'optional', capability: 'entities' },
  ],

  capabilities: [
    'entities',
    'resources',
    'routes',
    'navigation',
    'permissions',
    'settings',
    'events',
    'search',
    'dashboards',
  ],

  entities: [
    {
      name: 'Customer',
      tableName: 'customers',
      // No SEO: a shopper is never a public page.
      toolkit: { seo: false },
      moneyFields: ['totalSpent'],
    },
    {
      name: 'Segment',
      tableName: 'customer_segments',
      toolkit: { metafields: false, tags: false, seo: false, savedViews: false, importExport: false },
    },
  ],

  resources: [customerResource, segmentResource],

  routes: [
    { path: '/store/:handle/customers', screen: 'ListScreen', entity: 'Customer', permission: 'customers.read' },
    { path: '/store/:handle/customers/new', screen: 'CreateScreen', entity: 'Customer', permission: 'customers.manage' },
    { path: '/store/:handle/customers/:id', screen: 'DetailScreen', entity: 'Customer', permission: 'customers.read' },
    { path: '/store/:handle/customers/segments', screen: 'ListScreen', entity: 'Segment', permission: 'customers.read' },
    { path: '/store/:handle/customers/segments/:id', screen: 'DetailScreen', entity: 'Segment', permission: 'customers.read' },
  ],

  navigation: [
    {
      id: 'customers',
      label: 'Customers',
      path: '/store/:handle/customers',
      section: 'primary',
      position: 30,
      permission: 'customers.read',
    },
  ],

  dashboards: [
    {
      id: 'customers.total',
      label: 'Customers',
      slot: 'home',
      permission: 'customers.read',
      size: 'small',
      metric: 'totalCustomers',
      href: '/store/:handle/customers',
      position: 30,
    },
  ],

  permissions: [
    {
      key: 'customers.read',
      label: 'View customers',
      description: 'Open the customer list and read customer records.',
      categories: ['organization', 'store', 'point-of-sale'],
    },
    {
      key: 'customers.manage',
      label: 'Manage customers',
      description: 'Create, edit and delete customer records.',
      categories: ['organization', 'store'],
    },
    {
      key: 'customers.pii.read',
      label: 'View personal details',
      description: 'See full contact details, addresses and private notes.',
      categories: ['organization', 'store'],
    },
    {
      key: 'customers.export',
      label: 'Export customers',
      description: 'Export customer data, including personal details.',
      categories: ['organization'],
    },
  ],

  // Contributed into the SHARED customer-accounts group, not a page of its own —
  // which is the whole point of schema-driven settings (§31.9).
  settings: [
    {
      key: 'defaultMarketingConsent',
      label: 'Default email marketing consent',
      description: 'Applied to customers created by staff. Storefront sign-ups always ask explicitly.',
      group: 'customer_accounts',
      section: 'Marketing',
      kind: 'select',
      scope: 'store',
      defaultValue: 'unknown',
      options: [
        { value: 'unknown', label: 'Not asked' },
        { value: 'pending', label: 'Pending confirmation' },
      ],
      permission: 'customers.manage',
    },
    {
      key: 'requireDoubleOptIn',
      label: 'Require confirmed opt-in',
      description: 'Send a confirmation email before treating a subscription as consent.',
      group: 'customer_accounts',
      section: 'Marketing',
      kind: 'boolean',
      scope: 'store',
      defaultValue: true,
      permission: 'customers.manage',
    },
  ],

  events: [
    { type: 'customers.customer.created', version: 1, label: 'Customer created', description: 'A customer record was created.', direction: 'emits' },
    { type: 'customers.customer.updated', version: 1, label: 'Customer updated', description: 'A customer record changed.', direction: 'emits' },
    { type: 'customers.customer.consent-changed', version: 1, label: 'Consent changed', description: 'A customer subscribed or unsubscribed from a channel.', direction: 'emits' },
    { type: 'customers.segment.created', version: 1, label: 'Segment created', description: 'A customer segment was created.', direction: 'emits' },
  ],

  searchProviders: [
    {
      entity: 'Customer',
      indexKey: 'customers',
      permission: 'customers.read',
      fields: ['firstName', 'lastName', 'email', 'phone'],
    },
  ],

  lifecycle: { startup: 'lazy' },
};

export default customersManifest;

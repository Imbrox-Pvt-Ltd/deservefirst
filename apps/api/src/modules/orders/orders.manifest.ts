/**
 * Orders · orders.manifest.ts
 * Requests for quote. The third product module, and the first to depend on two
 * others — catalog for what is being asked about, customers for who is asking.
 * Both are reached only through their published contracts.
 *
 * What this manifest does NOT declare is the point: no payment capability, no
 * tax settings, no fulfilment events. ADR 0001 D10 defers those, and a manifest
 * that hinted at them would invite the half-built checkout the phasing exists to
 * prevent.
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

import { requestResource } from './contracts';

export const ordersManifest: ModuleManifest = {
  id: 'orders',
  version: '0.1.0',
  label: 'Requests',
  description: 'Requests for quote: what a buyer asked for, and what the merchant offered.',

  entitlementKey: 'orders',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
    // Required, both: a request is about products, from a customer. Without
    // either, this module has nothing to model.
    { module: 'catalog', type: 'required', capability: 'entities' },
    { module: 'customers', type: 'required', capability: 'entities' },
  ],

  capabilities: ['entities', 'resources', 'routes', 'navigation', 'permissions', 'settings', 'events', 'search', 'dashboards'],

  entities: [
    {
      name: 'Request',
      tableName: 'requests',
      // No SEO: a quote is never a public page.
      toolkit: { seo: false },
      moneyFields: ['subtotal'],
    },
    {
      name: 'RequestLine',
      tableName: 'request_lines',
      toolkit: { metafields: false, tags: false, savedViews: false, seo: false, importExport: false },
      moneyFields: ['listPrice', 'quotedPrice'],
      fields: [
        { name: 'requestId', type: 'reference', references: 'Request', indexed: true, filterable: true },
        { name: 'productId', type: 'reference', references: 'Product', indexed: true, filterable: true },
        { name: 'variantId', type: 'reference', references: 'ProductVariant', filterable: true },
        // Captured at request time so a later catalog change cannot rewrite what
        // the buyer actually asked for.
        { name: 'title', type: 'string', searchable: true },
        { name: 'sku', type: 'string', filterable: true, searchable: true },
        { name: 'quantity', type: 'integer', sortable: true },
        { name: 'listPrice', type: 'money' },
        { name: 'quotedPrice', type: 'money' },
        { name: 'position', type: 'integer', sortable: true },
        { name: 'note', type: 'text' },
      ],
    },
  ],

  resources: [requestResource],

  routes: [
    { path: '/store/:handle/requests', screen: 'ListScreen', entity: 'Request', permission: 'orders.read' },
    { path: '/store/:handle/requests/new', screen: 'CreateScreen', entity: 'Request', permission: 'orders.manage' },
    { path: '/store/:handle/requests/:id', screen: 'DetailScreen', entity: 'Request', permission: 'orders.read' },
  ],

  navigation: [
    {
      // Claims the reference admin's "Orders" slot rather than sitting beside
      // it. This module IS that section — a buyer request is how an order
      // begins here — so contributing a separate entry produced two menu items
      // for one concept, which is worse than either name on its own.
      id: 'orders',
      label: 'Requests',
      path: '/store/:handle/requests',
      section: 'primary',
      position: 10,
      permission: 'orders.read',
    },
  ],

  dashboards: [
    {
      id: 'orders.quoted-awaiting-answer',
      label: 'Quotes awaiting an answer',
      slot: 'growth',
      permission: 'orders.read',
      size: 'small',
      metric: 'quotedAwaitingAnswer',
      href: '/store/:handle/requests?query=status%3Aquoted',
      position: 10,
      description: 'Priced and sent. Nothing moves until the buyer replies.',
    },
    {
      id: 'orders.accepted',
      label: 'Accepted quotes',
      slot: 'analytics',
      permission: 'orders.read',
      size: 'small',
      metric: 'acceptedRequests',
      href: '/store/:handle/requests?query=status%3Aaccepted',
      position: 10,
    },
    {
      id: 'orders.declined',
      label: 'Declined',
      slot: 'analytics',
      permission: 'orders.read',
      size: 'small',
      metric: 'declinedRequests',
      href: '/store/:handle/requests?query=status%3Adeclined',
      position: 11,
      description: 'Worth reading before changing prices.',
    },
    {
      id: 'orders.awaiting-quote',
      label: 'Awaiting a quote',
      slot: 'home',
      permission: 'orders.read',
      size: 'small',
      metric: 'awaitingQuote',
      href: '/store/:handle/requests?query=status%3Asubmitted',
      position: 10,
      description: 'Submitted by a buyer and not yet priced.',
    },
  ],

  permissions: [
    { key: 'orders.read', label: 'View requests', description: 'Open the request list and read requests.', categories: ['organization', 'store', 'point-of-sale'] },
    { key: 'orders.manage', label: 'Manage requests', description: 'Create and edit requests.', categories: ['organization', 'store'] },
    { key: 'orders.quote', label: 'Send quotes', description: 'Price a request and send the quote to the buyer.', categories: ['organization', 'store'] },
  ],

  settings: [
    {
      key: 'requestPrefix',
      label: 'Request number prefix',
      description: 'Shown to buyers, e.g. RFQ-1001.',
      group: 'general',
      section: 'Request numbering',
      kind: 'text',
      scope: 'store',
      defaultValue: 'RFQ-',
      permission: 'orders.manage',
    },
    {
      key: 'quoteValidityDays',
      label: 'Quote validity (days)',
      description: 'How long a quote stays acceptable. An open-ended quote is a price list.',
      group: 'general',
      section: 'Request numbering',
      kind: 'number',
      scope: 'store',
      defaultValue: 14,
      permission: 'orders.quote',
    },
  ],

  events: [
    { type: 'orders.request.submitted', version: 1, label: 'Request submitted', description: 'A buyer submitted a request for quote.', direction: 'emits' },
    { type: 'orders.request.quoted', version: 1, label: 'Request quoted', description: 'A merchant sent a quote.', direction: 'emits' },
    { type: 'orders.request.accepted', version: 1, label: 'Request accepted', description: 'A buyer accepted a quote. Phase 2 turns this into an order.', direction: 'emits' },
    { type: 'orders.request.declined', version: 1, label: 'Request declined', description: 'A request was declined by either side.', direction: 'emits' },
  ],

  searchProviders: [
    {
      entity: 'Request',
      indexKey: 'requests',
      permission: 'orders.read',
      fields: ['reference', 'contactName', 'contactEmail'],
    },
  ],

  lifecycle: { startup: 'lazy' },
};

export default ordersManifest;

/**
 * Catalog · catalog.manifest.ts
 * The module manifest — one declaration from which the platform composes this
 * module's entities, API, routes, navigation, permissions, settings, events and
 * search. Nothing here is wiring: every key is metadata the runtime reads.
 * If it is not declared here, the platform does not load it (§31.2, §14.1).
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

import { collectionResource, productResource, productVariantResource } from './contracts';

export const catalogManifest: ModuleManifest = {
  id: 'catalog',
  version: '0.1.0',
  label: 'Catalog',
  description: 'Products, variants and collections for a store.',

  entitlementKey: 'catalog',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
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
    'seo',
    'dashboards',
  ],

  // Declaring the entity is what earns the Entity Toolkit: metafields, tags,
  // timeline, audit, saved views, bulk actions, import/export and soft delete
  // all arrive without a line of code (§12.1).
  entities: [
    {
      name: 'Product',
      tableName: 'products',
      toolkit: { seo: true },
      translatableFields: ['title', 'description', 'handle'],
      moneyFields: ['price', 'compareAtPrice', 'costPerItem'],
    },
    {
      name: 'Collection',
      tableName: 'collections',
      toolkit: { seo: true },
      translatableFields: ['title', 'description', 'handle'],
    },
    {
      name: 'ProductVariant',
      tableName: 'product_variants',
      toolkit: { metaobjects: false, savedViews: false, seo: false, importExport: false },
      moneyFields: ['price', 'compareAtPrice'],
    },
  ],

  resources: [productResource, productVariantResource, collectionResource],

  routes: [
    { path: '/store/:handle/products', screen: 'ListScreen', entity: 'Product', permission: 'catalog.read' },
    { path: '/store/:handle/products/new', screen: 'CreateScreen', entity: 'Product', permission: 'catalog.write' },
    { path: '/store/:handle/products/:id', screen: 'DetailScreen', entity: 'Product', permission: 'catalog.read' },
    {
      path: '/store/:handle/products/:id/variants/:variantId',
      screen: 'DetailScreen',
      entity: 'ProductVariant',
      permission: 'catalog.write',
      presentation: 'drawer',
    },
    { path: '/store/:handle/collections', screen: 'ListScreen', entity: 'Collection', permission: 'catalog.read' },
    { path: '/store/:handle/collections/new', screen: 'CreateScreen', entity: 'Collection', permission: 'catalog.write' },
    { path: '/store/:handle/collections/:id', screen: 'DetailScreen', entity: 'Collection', permission: 'catalog.read' },
  ],

  navigation: [
    {
      id: 'collections',
      label: 'Collections',
      path: '/store/:handle/collections',
      parentId: 'products',
      section: 'primary',
      position: 21,
      permission: 'catalog.read',
    },
    {
      id: 'products',
      label: 'Products',
      path: '/store/:handle/products',
      section: 'primary',
      position: 20,
      permission: 'catalog.read',
    },
  ],

  dashboards: [
    {
      id: 'catalog.unpublished',
      label: 'Not on any channel',
      slot: 'growth',
      permission: 'catalog.read',
      size: 'small',
      metric: 'draftProducts',
      href: '/store/:handle/products?query=status%3Adraft',
      position: 20,
      description: 'Finished products nobody can buy yet.',
    },
    {
      id: 'catalog.total-products',
      label: 'Products',
      slot: 'analytics',
      permission: 'catalog.read',
      size: 'small',
      metric: 'totalProducts',
      href: '/store/:handle/products',
      position: 20,
    },
    {
      id: 'catalog.collections',
      label: 'Collections',
      slot: 'analytics',
      permission: 'catalog.read',
      size: 'small',
      metric: 'totalCollections',
      href: '/store/:handle/collections',
      position: 21,
    },
    {
      id: 'catalog.active-products',
      label: 'Active products',
      slot: 'home',
      permission: 'catalog.read',
      size: 'small',
      metric: 'activeProducts',
      href: '/store/:handle/products?query=status%3Aactive',
      position: 20,
      description: 'Published and buyable right now.',
    },
    {
      id: 'catalog.draft-products',
      label: 'Drafts',
      slot: 'home',
      permission: 'catalog.read',
      size: 'small',
      metric: 'draftProducts',
      href: '/store/:handle/products?query=status%3Adraft',
      position: 21,
      description: 'Started but not yet live.',
    },
  ],

  permissions: [
    {
      key: 'catalog.read',
      label: 'View products',
      description: 'Open the catalog and read products, variants and collections.',
      categories: ['organization', 'store'],
    },
    {
      key: 'catalog.write',
      label: 'Manage products',
      description: 'Create, edit, archive and delete catalog records.',
      categories: ['organization', 'store'],
    },
    {
      key: 'catalog.publish',
      label: 'Publish products',
      description: 'Publish products to sales channels and markets.',
      categories: ['organization', 'store'],
    },
  ],

  // Contributed into a shared settings group rather than adding a page (§31.9).
  settings: [
    {
      key: 'defaultWeightUnit',
      label: 'Default weight unit',
      description: 'Applied to new products that do not specify one.',
      group: 'general',
      section: 'Store defaults',
      kind: 'select',
      scope: 'store',
      defaultValue: 'kg',
      options: [
        { value: 'kg', label: 'Kilogram (kg)' },
        { value: 'lb', label: 'Pound (lb)' },
      ],
      permission: 'catalog.write',
    },
    {
      key: 'continueSellingWhenOutOfStock',
      label: 'Continue selling when out of stock',
      group: 'general',
      section: 'Store defaults',
      kind: 'boolean',
      scope: 'store',
      defaultValue: false,
      permission: 'catalog.write',
    },
  ],

  apiScopes: [
    {
      key: 'read_products', label: 'View products', family: 'Admin API', feature: 'Products',
      access: 'read', description: 'Read products, variants and collections.',
      grants: ['catalog.read'],
    },
    {
      key: 'write_products', label: 'Manage products', family: 'Admin API', feature: 'Products',
      access: 'write', description: 'Create and change products, variants and collections.',
      // Write implies read: an app that can change a product but not read one
      // would have to guess at what it is changing.
      grants: ['catalog.read', 'catalog.write', 'catalog.publish'],
    },
  ],

  events: [
    {
      type: 'catalog.product.created',
      version: 1,
      label: 'Product created',
      description: 'A product was created in the store.',
      direction: 'emits',
    },
    {
      type: 'catalog.product.updated',
      version: 1,
      label: 'Product updated',
      description: 'A product changed.',
      direction: 'emits',
    },
    {
      type: 'catalog.product.published',
      version: 1,
      label: 'Product published',
      description: 'A product became visible on a sales channel.',
      direction: 'emits',
    },
    {
      type: 'catalog.product.archived',
      version: 1,
      label: 'Product archived',
      description: 'A product was archived and removed from sales channels.',
      direction: 'emits',
    },
  ],

  searchProviders: [
    {
      entity: 'Collection',
      indexKey: 'collections',
      permission: 'catalog.read',
      fields: ['title', 'handle'],
    },
    {
      entity: 'Product',
      indexKey: 'products',
      permission: 'catalog.read',
      fields: ['title', 'vendor', 'productType', 'sku'],
    },
  ],

  lifecycle: { startup: 'lazy' },
};

export default catalogManifest;

/**
 * Inventory · inventory.manifest.ts
 * Locations, stock levels, purchase orders and transfers — the Products sub-nav
 * captured from the reference product, which until now returned 404.
 *
 * Catalog is an optional dependency: inventory is meaningful without it (a
 * warehouse still has locations), and declaring it required would stop the boot
 * for a store that has not enabled a catalog.
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

import {
  inventoryLevelResource,
  locationResource,
  purchaseOrderResource,
  transferResource,
} from './contracts';

const OPERATIONAL_TOOLKIT = {
  metaobjects: false,
  seo: false,
  savedViews: false,
} as const;

export const inventoryManifest: ModuleManifest = {
  id: 'inventory',
  version: '0.1.0',
  label: 'Inventory',
  description: 'Locations, stock levels, purchase orders and transfers.',

  entitlementKey: 'inventory',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
    { module: 'catalog', type: 'optional', capability: 'entities' },
  ],

  capabilities: ['entities', 'resources', 'routes', 'navigation', 'permissions', 'settings', 'events', 'search', 'dashboards'],

  entities: [
    { name: 'Location', tableName: 'locations', toolkit: { ...OPERATIONAL_TOOLKIT, metafields: true } },
    {
      name: 'InventoryLevel',
      tableName: 'inventory_levels',
      toolkit: { ...OPERATIONAL_TOOLKIT, metafields: false, tags: false, timeline: false, savedViews: true },
    },
    {
      name: 'InventoryAdjustment',
      tableName: 'inventory_adjustments',
      // Append-only: an adjustment is the audit trail, so it has no soft delete
      // and nothing edits it.
      toolkit: { metafields: false, tags: false, timeline: false, savedViews: false, seo: false, importExport: false, softDelete: false },
      fields: [
        { name: 'locationId', type: 'reference', references: 'Location', indexed: true, filterable: true },
        { name: 'productId', type: 'reference', references: 'Product', indexed: true, filterable: true },
        { name: 'variantId', type: 'reference', references: 'ProductVariant', filterable: true },
        { name: 'delta', type: 'integer', filterable: true },
        { name: 'reason', type: 'enum', values: ['received', 'sold', 'returned', 'damaged', 'shrinkage', 'recount', 'transfer-in', 'transfer-out', 'correction'], filterable: true },
        { name: 'reference', type: 'string', filterable: true },
        { name: 'occurredAt', type: 'datetime', filterable: true, sortable: true },
      ],
    },
    { name: 'PurchaseOrder', tableName: 'purchase_orders', toolkit: OPERATIONAL_TOOLKIT },
    {
      name: 'PurchaseOrderLine',
      tableName: 'purchase_order_lines',
      toolkit: { metafields: false, tags: false, timeline: false, savedViews: false, seo: false, importExport: false },
      fields: [
        { name: 'purchaseOrderId', type: 'reference', references: 'PurchaseOrder', indexed: true, filterable: true },
        { name: 'productId', type: 'reference', references: 'Product', indexed: true },
        { name: 'variantId', type: 'reference', references: 'ProductVariant' },
        { name: 'title', type: 'string', searchable: true },
        { name: 'ordered', type: 'integer' },
        { name: 'received', type: 'integer' },
        { name: 'position', type: 'integer', sortable: true },
      ],
    },
    { name: 'Transfer', tableName: 'transfers', toolkit: OPERATIONAL_TOOLKIT },
    {
      name: 'TransferLine',
      tableName: 'transfer_lines',
      toolkit: { metafields: false, tags: false, timeline: false, savedViews: false, seo: false, importExport: false },
      fields: [
        { name: 'transferId', type: 'reference', references: 'Transfer', indexed: true, filterable: true },
        { name: 'productId', type: 'reference', references: 'Product', indexed: true },
        { name: 'variantId', type: 'reference', references: 'ProductVariant' },
        { name: 'title', type: 'string', searchable: true },
        { name: 'quantity', type: 'integer' },
        { name: 'receivedQuantity', type: 'integer' },
        { name: 'position', type: 'integer', sortable: true },
      ],
    },
  ],

  resources: [locationResource, inventoryLevelResource, purchaseOrderResource, transferResource],

  routes: [
    {
      // The captured URL, kept. It sits inside catalog's /products/:id, so the
      // precedence is declared rather than left to the router: inventory is a
      // real section of the admin, not a product whose id happens to read
      // "inventory".
      path: '/store/:handle/products/inventory',
      screen: 'ListScreen',
      entity: 'InventoryLevel',
      permission: 'inventory.read',
      shadows: ['/store/:handle/products/:id'],
    },
    { path: '/store/:handle/purchase_orders', screen: 'ListScreen', entity: 'PurchaseOrder', permission: 'inventory.read' },
    { path: '/store/:handle/purchase_orders/new', screen: 'CreateScreen', entity: 'PurchaseOrder', permission: 'inventory.manage' },
    { path: '/store/:handle/purchase_orders/:id', screen: 'DetailScreen', entity: 'PurchaseOrder', permission: 'inventory.read' },
    { path: '/store/:handle/transfers', screen: 'ListScreen', entity: 'Transfer', permission: 'inventory.read' },
    { path: '/store/:handle/transfers/new', screen: 'CreateScreen', entity: 'Transfer', permission: 'inventory.manage' },
    { path: '/store/:handle/transfers/:id', screen: 'DetailScreen', entity: 'Transfer', permission: 'inventory.read' },
    { path: '/store/:handle/settings/locations', screen: 'SettingsScreen', entity: 'Location', permission: 'inventory.read', presentation: 'overlay' },
  ],

  // Children of Products, as in the reference admin. Contributed with a
  // parentId rather than as top-level entries: inventory owns these screens,
  // but they belong under Products in the merchant's mental model.
  navigation: [
    { id: 'inventory', label: 'Inventory', path: '/store/:handle/products/inventory', parentId: 'products', section: 'primary', position: 22, permission: 'inventory.read' },
    { id: 'purchase-orders', label: 'Purchase orders', path: '/store/:handle/purchase_orders', parentId: 'products', section: 'primary', position: 23, permission: 'inventory.read' },
    { id: 'transfers', label: 'Transfers', path: '/store/:handle/transfers', parentId: 'products', section: 'primary', position: 24, permission: 'inventory.read' },
  ],

  dashboards: [
    {
      id: 'inventory.out-of-stock',
      label: 'Out of stock',
      slot: 'home',
      permission: 'inventory.read',
      size: 'small',
      metric: 'outOfStock',
      href: '/store/:handle/products/inventory',
      position: 40,
      // Counts positions at or below zero: a negative on-hand is evidence of an
      // unrecorded movement, and hiding it here would hide the thing worth
      // acting on.
      description: 'Nothing available to sell at some location.',
    },
    {
      id: 'inventory.incoming',
      label: 'On order',
      slot: 'home',
      permission: 'inventory.read',
      size: 'small',
      metric: 'openPurchaseOrders',
      href: '/store/:handle/purchase_orders?query=status%3Aordered',
      position: 41,
      description: 'Purchase orders placed and not yet fully received.',
    },
  ],

  permissions: [
    { key: 'inventory.read', label: 'View inventory', description: 'See stock levels, purchase orders and transfers.', categories: ['organization', 'store', 'point-of-sale'] },
    { key: 'inventory.adjust', label: 'Adjust inventory', description: 'Change on-hand quantities with a reason.', categories: ['organization', 'store', 'point-of-sale'] },
    { key: 'inventory.manage', label: 'Manage inventory', description: 'Create purchase orders, transfers and locations.', categories: ['organization', 'store'] },
  ],

  settings: [
    {
      key: 'allowNegativeStock',
      label: 'Allow negative stock',
      description: 'Recording a sale of more than is on hand produces a negative level rather than an error. Negative stock is evidence of an unrecorded movement.',
      group: 'general',
      section: 'Inventory',
      kind: 'boolean',
      scope: 'store',
      defaultValue: true,
      permission: 'inventory.manage',
    },
  ],

  events: [
    { type: 'inventory.level.adjusted', version: 1, label: 'Stock adjusted', description: 'On-hand changed at a location; catalog listens to update its denormalised quantity.', direction: 'emits' },
    { type: 'inventory.purchase-order.received', version: 1, label: 'Purchase order received', description: 'Stock arrived from a supplier.', direction: 'emits' },
    { type: 'inventory.transfer.received', version: 1, label: 'Transfer received', description: 'Stock arrived at its destination location.', direction: 'emits' },
  ],

  searchProviders: [
    { entity: 'PurchaseOrder', indexKey: 'purchase-orders', permission: 'inventory.read', fields: ['reference', 'supplierName'] },
  ],

  lifecycle: { startup: 'lazy' },
};

export default inventoryManifest;

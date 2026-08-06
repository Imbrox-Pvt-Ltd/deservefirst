/**
 * Inventory · contracts/index.ts
 * The only surface other modules may import. Catalog consumes the adjusted event
 * to keep its denormalised quantity current without reaching into these tables.
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

export interface InventoryLevelSummary {
  readonly locationId: string;
  readonly productId: string;
  readonly onHand: number;
  readonly available: number;
}

export interface LevelAdjustedPayload {
  readonly productId: string;
  readonly variantId: string | null;
  readonly locationId: string;
  readonly delta: number;
  readonly reason: string;
  readonly onHandAfter: number;
}

export const locationResource: ResourceDefinition = {
  name: 'Location',
  entity: 'Location',
  pluralName: 'Locations',
  urlSegment: 'locations',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'address', type: 'text', searchable: true },
    { name: 'countryCode', type: 'string', required: true, filterable: true },
    { name: 'fulfilsOrders', type: 'boolean', filterable: true },
    /**
     * Whether customers may collect from here.
     *
     * Its own field rather than a reading of `fulfilsOrders`, because the two
     * are genuinely different: a warehouse fulfils every order and no customer
     * may walk into it, and a showroom may take collections while shipping
     * nothing. Deriving one from the other would put a merchant's fulfilment
     * centre address on their storefront.
     */
    { name: 'pickupEnabled', type: 'boolean', filterable: true },
    /**
     * What the storefront promises about collection times.
     *
     * A merchant's own words — "Usually ready in 24 hours" — because it is a
     * promise to a customer and no formula the platform could compute would be
     * one the merchant is willing to make.
     */
    { name: 'pickupTime', type: 'string' },
    { name: 'archivedAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'inventory.read', write: 'inventory.manage' },
};

export const inventoryLevelResource: ResourceDefinition = {
  name: 'InventoryLevel',
  entity: 'InventoryLevel',
  pluralName: 'InventoryLevels',
  urlSegment: 'inventory',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'locationId', type: 'reference', references: 'Location', indexed: true, filterable: true },
    { name: 'productId', type: 'reference', references: 'Product', indexed: true, filterable: true },
    { name: 'variantId', type: 'reference', references: 'ProductVariant', filterable: true },
    { name: 'title', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'sku', type: 'string', filterable: true, searchable: true },
    { name: 'onHand', type: 'integer', filterable: true, sortable: true },
    { name: 'committed', type: 'integer', filterable: true, sortable: true },
    { name: 'incoming', type: 'integer', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list'],
  columns: [
    { field: 'title', label: 'Product', defaultVisible: true, position: 0 },
    { field: 'sku', label: 'SKU', defaultVisible: true, position: 1 },
    { field: 'incoming', label: 'Incoming', defaultVisible: true, position: 2 },
    { field: 'committed', label: 'Committed', defaultVisible: true, position: 3 },
    { field: 'onHand', label: 'On hand', defaultVisible: true, position: 4 },
  ],
  permissions: { read: 'inventory.read', write: 'inventory.adjust' },
};

export const purchaseOrderResource: ResourceDefinition = {
  name: 'PurchaseOrder',
  entity: 'PurchaseOrder',
  pluralName: 'PurchaseOrders',
  urlSegment: 'purchase-orders',
  aggregateRoot: 'PurchaseOrder',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'reference', type: 'string', unique: true, indexed: true, filterable: true, sortable: true, searchable: true },
    { name: 'supplierName', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'destinationLocationId', type: 'reference', references: 'Location', filterable: true },
    { name: 'status', type: 'enum', values: ['draft', 'ordered', 'partial', 'received', 'cancelled'], filterable: true, sortable: true },
    { name: 'expectedAt', type: 'datetime', filterable: true, sortable: true },
    // Lines live as JSON on the order rather than as rows: they are read and
    // written only as a whole set, and a table would add joins and ordering
    // concerns for no query we intend to run. Internal so the list surface does
    // not ship every line of every order to a screen showing four columns —
    // the detail endpoint returns them.
    { name: 'lines', type: 'json', visibility: 'internal' },
    { name: 'lineCount', type: 'integer', sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'reference', label: 'Purchase order', defaultVisible: true, position: 0 },
    { field: 'supplierName', label: 'Supplier', defaultVisible: true, position: 1 },
    { field: 'status', label: 'Status', defaultVisible: true, position: 2 },
    { field: 'expectedAt', label: 'Expected', defaultVisible: true, position: 3 },
  ],
  permissions: { read: 'inventory.read', write: 'inventory.manage' },
};

export const transferResource: ResourceDefinition = {
  name: 'Transfer',
  entity: 'Transfer',
  pluralName: 'Transfers',
  urlSegment: 'transfers',
  aggregateRoot: 'Transfer',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'reference', type: 'string', unique: true, indexed: true, filterable: true, sortable: true, searchable: true },
    { name: 'originLocationId', type: 'reference', references: 'Location', filterable: true },
    { name: 'destinationLocationId', type: 'reference', references: 'Location', filterable: true },
    { name: 'status', type: 'enum', values: ['draft', 'in-transit', 'received', 'cancelled'], filterable: true, sortable: true },
    { name: 'lines', type: 'json', visibility: 'internal' },
    { name: 'lineCount', type: 'integer', sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'reference', label: 'Transfer', defaultVisible: true, position: 0 },
    { field: 'status', label: 'Status', defaultVisible: true, position: 1 },
    { field: 'lineCount', label: 'Items', defaultVisible: true, position: 2 },
  ],
  permissions: { read: 'inventory.read', write: 'inventory.manage' },
};

/**
 * Inventory · events/index.ts
 * Events this module emits. Catalog listens to keep its denormalised
 * inventoryQuantity current without reaching into these tables.
 * Layer: events.
 */

export const INVENTORY_EVENTS = {
  adjusted: 'inventory.level.adjusted',
  purchaseOrderReceived: 'inventory.purchase-order.received',
  transferReceived: 'inventory.transfer.received',
} as const;

export type InventoryEventType = (typeof INVENTORY_EVENTS)[keyof typeof INVENTORY_EVENTS];

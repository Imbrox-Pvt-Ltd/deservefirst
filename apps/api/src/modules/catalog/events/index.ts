/**
 * Catalog · events/index.ts
 * The typed, versioned events this module emits. A breaking change means a new
 * version plus an upcaster, so existing consumers keep working (§14.4).
 * Layer: events.
 */

export const CATALOG_EVENTS = {
  productCreated: 'catalog.product.created',
  productUpdated: 'catalog.product.updated',
  productPublished: 'catalog.product.published',
  productArchived: 'catalog.product.archived',
} as const;

export type CatalogEventType = (typeof CATALOG_EVENTS)[keyof typeof CATALOG_EVENTS];

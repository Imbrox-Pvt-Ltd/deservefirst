/**
 * Catalog · contracts/index.ts
 * The ONLY surface other modules may import (§14.1). Publishing a type here is a
 * commitment; everything else in this module is unreachable by design, and the
 * fitness suite fails the build on any other coupling.
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

/** Published shape of a product, as other modules see it. */
export interface ProductSummary {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly status: 'draft' | 'active' | 'archived';
  readonly vendor: string | null;
  readonly priceAmountMinor: string;
  readonly currency: string;
}

/** Payloads for this module's published events (§14.4). */
export interface ProductCreatedPayload {
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
}

export interface ProductPublishedPayload {
  readonly productId: string;
  readonly channels: readonly string[];
}

/**
 * The resource definition (§13.2): declared once, and from it the platform
 * derives the GraphQL type, the REST endpoints, the list and search engine, and
 * the admin screens — so the surfaces cannot drift.
 */
export const productResource: ResourceDefinition = {
  name: 'Product',
  entity: 'Product',
  pluralName: 'Products',
  urlSegment: 'products',
  aggregateRoot: 'Product',
  fields: [
    { name: 'id', type: 'id', visibility: 'public' },
    {
      name: 'title',
      type: 'string',
      required: true,
      filterable: true,
      sortable: true,
      searchable: true,
      translatable: true,
    },
    { name: 'handle', type: 'handle', unique: true, indexed: true, filterable: true, translatable: true },
    { name: 'description', type: 'richtext', translatable: true },
    {
      name: 'status',
      type: 'enum',
      values: ['draft', 'active', 'archived'],
      filterable: true,
      sortable: true,
      indexed: true,
    },
    { name: 'vendor', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'productType', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'sku', type: 'string', filterable: true, searchable: true, indexed: true },
    { name: 'price', type: 'money', filterable: true, sortable: true },
    { name: 'compareAtPrice', type: 'money' },
    { name: 'costPerItem', type: 'money', visibility: 'private' },
    { name: 'inventoryQuantity', type: 'integer', filterable: true, sortable: true },
    { name: 'categoryId', type: 'reference', references: 'TaxonomyCategory', filterable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
    // Internal fields never leak into the public schema or the reference docs.
    { name: 'internalNotes', type: 'text', visibility: 'internal' },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'title', label: 'Product', defaultVisible: true, position: 0 },
    { field: 'status', label: 'Status', defaultVisible: true, position: 1 },
    { field: 'inventoryQuantity', label: 'Inventory', defaultVisible: true, position: 2 },
    { field: 'productType', label: 'Product type', defaultVisible: true, position: 3 },
    { field: 'vendor', label: 'Vendor', defaultVisible: true, position: 4 },
    { field: 'sku', label: 'SKU', defaultVisible: false, position: 5 },
    { field: 'price', label: 'Price', defaultVisible: false, position: 6 },
  ],
  permissions: {
    read: 'catalog.read',
    write: 'catalog.write',
    delete: 'catalog.write',
  },
};

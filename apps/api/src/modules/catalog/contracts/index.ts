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
    // Declared because the detail screen reads it. A field the UI uses but the
    // resource does not declare simply arrives undefined at runtime.
    { name: 'publishedChannels', type: 'json' },
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

/**
 * Variants are a child of the Product aggregate: loaded, saved and authorised
 * through the root (§14.3). They get their own table and drawer route, but never
 * their own top-level list — reaching a variant without its product would break
 * the aggregate boundary.
 */
export const productVariantResource: ResourceDefinition = {
  name: 'ProductVariant',
  entity: 'ProductVariant',
  pluralName: 'ProductVariants',
  urlSegment: 'variants',
  aggregateRoot: 'Product',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'productId', type: 'reference', references: 'Product', indexed: true, filterable: true },
    { name: 'sku', type: 'string', filterable: true, searchable: true, indexed: true },
    { name: 'optionValues', type: 'json' },
    { name: 'price', type: 'money', filterable: true, sortable: true },
    { name: 'compareAtPrice', type: 'money' },
    { name: 'inventoryQuantity', type: 'integer', filterable: true, sortable: true },
    { name: 'position', type: 'integer', sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  // No list screen: a variant is only ever reached through its product.
  screens: ['detail'],
  permissions: { read: 'catalog.read', write: 'catalog.write' },
};

/**
 * Collections. Note how little is here: fields, visibility and permissions.
 * Everything a merchant sees on the screen — filters, saved views, bulk actions,
 * metafields, timeline, SEO — comes from declaring the entity, not from this file.
 */
export const collectionResource: ResourceDefinition = {
  name: 'Collection',
  entity: 'Collection',
  pluralName: 'Collections',
  urlSegment: 'collections',
  aggregateRoot: 'Collection',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'title', type: 'string', required: true, filterable: true, sortable: true, searchable: true, translatable: true },
    { name: 'handle', type: 'handle', unique: true, indexed: true, filterable: true, translatable: true },
    { name: 'description', type: 'richtext', translatable: true },
    { name: 'type', type: 'enum', values: ['manual', 'automated'], filterable: true, sortable: true },
    { name: 'match', type: 'enum', values: ['all', 'any'] },
    { name: 'conditions', type: 'json' },
    // Exclusions are a first-class rule set, not a flag on a condition — without
    // them "everything tagged sale except clearance" cannot be expressed.
    { name: 'exclusions', type: 'json' },
    { name: 'productIds', type: 'json' },
    { name: 'sortOrder', type: 'enum', values: ['manual', 'best-selling', 'title-asc', 'title-desc', 'price-asc', 'price-desc', 'created-desc'] },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'title', label: 'Title', defaultVisible: true, position: 0 },
    { field: 'type', label: 'Type', defaultVisible: true, position: 1 },
    { field: 'sortOrder', label: 'Product sorting', defaultVisible: false, position: 2 },
  ],
  permissions: { read: 'catalog.read', write: 'catalog.write', delete: 'catalog.write' },
};

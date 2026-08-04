/**
 * Core · entity-toolkit/index.ts
 * The Entity Toolkit (§12.1). Define the base resource capability set once and
 * EVERY entity — product, claim, page, customer, metaobject — inherits it
 * automatically. This is how screens stay consistent by construction and how a
 * module author gets a full admin surface without writing one.
 * Layer: core.
 */

export * from './base-entity';
export * from './metafields';
export * from './timeline';
export * from './translations';
export * from './seo';
export * from './saved-views';
export * from './bulk-operations';
export * from './toolkit';
export * from './toolkit-ports';

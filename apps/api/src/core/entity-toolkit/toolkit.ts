/**
 * Core · entity-toolkit/toolkit.ts
 * Composes the toolkit for one entity from its declaration. A module author
 * writes an EntityDeclaration; this resolves what that entity gets, which
 * columns it needs, and which capabilities its screens should render. Nothing is
 * per-entity code.
 * Layer: core.
 */

import type { EntityDeclaration, ResourceDefinition } from '@deservefirst/contracts';

import { BASE_ENTITY_COLUMNS } from './base-entity';

/** Toolkit features, all on unless a declaration opts out. */
export interface ResolvedToolkit {
  readonly metafields: boolean;
  readonly metaobjects: boolean;
  readonly tags: boolean;
  readonly timeline: boolean;
  readonly audit: boolean;
  readonly savedViews: boolean;
  readonly bulkActions: boolean;
  readonly importExport: boolean;
  readonly softDelete: boolean;
  readonly seo: boolean;
}

const ALL_ON: ResolvedToolkit = {
  metafields: true,
  metaobjects: true,
  tags: true,
  timeline: true,
  audit: true,
  savedViews: true,
  bulkActions: true,
  importExport: true,
  softDelete: true,
  seo: false, // opt-in: only content with a public surface needs it
};

export function resolveToolkit(entity: EntityDeclaration): ResolvedToolkit {
  return { ...ALL_ON, ...(entity.toolkit ?? {}) };
}

export interface ToolkitTable {
  readonly name: string;
  readonly purpose: string;
}

/**
 * The satellite tables an entity needs, derived from what it opted into. The
 * migration generator reads this, so enabling a toolkit feature creates its
 * storage without the author writing DDL.
 */
export function toolkitTablesFor(entity: EntityDeclaration): ToolkitTable[] {
  const toolkit = resolveToolkit(entity);
  const tables: ToolkitTable[] = [];
  const base = entity.tableName;

  if (toolkit.metafields) {
    tables.push({ name: `${base}_metafields`, purpose: 'typed custom field values' });
  }
  if (toolkit.tags) {
    tables.push({ name: `${base}_tags`, purpose: 'free-form tag assignments' });
  }
  if (toolkit.timeline) {
    tables.push({ name: `${base}_timeline`, purpose: 'comments and change history' });
  }
  if (toolkit.savedViews) {
    tables.push({ name: `${base}_saved_views`, purpose: 'named filter/sort/column sets' });
  }
  if ((entity.translatableFields ?? []).length > 0) {
    tables.push({ name: `${base}_translations`, purpose: 'per-locale field values' });
  }
  if (toolkit.seo) {
    tables.push({ name: `${base}_seo`, purpose: 'meta title, description, canonical, OG' });
  }

  return tables;
}

/**
 * Indexes every store-scoped table needs regardless of its own fields (§30.3).
 * Declaring them here rather than per entity is what stops one module shipping a
 * table without a tenant index and degrading everyone on the shard.
 */
export function requiredIndexesFor(entity: EntityDeclaration): string[] {
  const toolkit = resolveToolkit(entity);
  const indexes = [
    `${entity.tableName}(store_id)`,
    `${entity.tableName}(store_id, created_at DESC, id DESC)`,
  ];
  if (toolkit.softDelete) {
    indexes.push(`${entity.tableName}(store_id, deleted_at)`);
  }
  indexes.push(`${entity.tableName}(store_id, handle) UNIQUE`);
  return indexes;
}

/**
 * Every column a row carries: the base set, plus the entity's declared fields.
 * Metafields deliberately do not appear — they are rows in a satellite table,
 * not columns, which is what lets a merchant add one without a migration (§17.4).
 */
export function columnsFor(entity: EntityDeclaration, resource: ResourceDefinition): string[] {
  const toolkit = resolveToolkit(entity);
  const base = BASE_ENTITY_COLUMNS.filter((column) => toolkit.softDelete || column !== 'deleted_at');
  const declared = resource.fields
    .map((field) => field.name)
    .filter((name) => name !== 'id' && name !== 'handle');
  return [...base, ...declared];
}

/**
 * Which capability panels a detail screen should render for this entity, in the
 * order the reference product shows them.
 */
export function detailPanelsFor(entity: EntityDeclaration): string[] {
  const toolkit = resolveToolkit(entity);
  const panels: string[] = [];
  if (toolkit.tags) panels.push('tags');
  if (toolkit.metafields) panels.push('metafields');
  if (toolkit.seo) panels.push('seo');
  if ((entity.translatableFields ?? []).length > 0) panels.push('translations');
  if (toolkit.timeline) panels.push('timeline');
  return panels;
}

/** Bulk actions a list screen offers, derived rather than hand-listed per screen. */
export function bulkActionsFor(entity: EntityDeclaration): string[] {
  const toolkit = resolveToolkit(entity);
  const actions: string[] = [];
  if (toolkit.bulkActions) {
    actions.push('edit');
    if (toolkit.tags) actions.push('add-tags', 'remove-tags');
    if (toolkit.softDelete) actions.push('archive', 'delete');
  }
  if (toolkit.importExport) actions.push('export');
  return actions;
}

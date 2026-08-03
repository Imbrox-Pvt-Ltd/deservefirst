/**
 * Core · entity-toolkit/base-entity.ts
 * The columns and behaviour EVERY resource inherits (§12.1). Defining this once
 * is what makes screens consistent by construction and keeps modules
 * agent-buildable without per-entity rework.
 * Layer: core.
 */

import { buildGlobalId, type StoreId } from '@deservefirst/contracts';

import { branding } from '@deservefirst/config';

/** Every store-owned row carries these. `store_id` is the isolation boundary. */
export interface BaseEntityColumns {
  readonly id: string;
  readonly store_id: StoreId;
  readonly handle: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  /** Soft delete: rows are hidden, not destroyed, so restore is possible (§12.1). */
  readonly deleted_at: Date | null;
  /** Optimistic concurrency — a stale write loses rather than silently clobbering. */
  readonly version: number;
}

export const BASE_ENTITY_COLUMNS: readonly (keyof BaseEntityColumns)[] = [
  'id',
  'store_id',
  'handle',
  'created_at',
  'updated_at',
  'deleted_at',
  'version',
];

export type PublicationStatus = 'draft' | 'active' | 'archived';

export function globalIdFor(entity: string, id: string): string {
  return buildGlobalId(branding.slug, entity, id);
}

/**
 * Latin letters that do NOT decompose under NFKD because they are atomic
 * codepoints rather than a base plus a combining mark. Without this map, "Bløde"
 * slugs to "bl-de" — which is wrong in every Nordic, Polish and German market we
 * intend to sell in.
 */
const NON_DECOMPOSING_LATIN: Readonly<Record<string, string>> = {
  ø: 'o', Ø: 'o',
  đ: 'd', Đ: 'd', ð: 'd', Ð: 'd',
  ł: 'l', Ł: 'l',
  æ: 'ae', Æ: 'ae',
  œ: 'oe', Œ: 'oe',
  ß: 'ss', ẞ: 'ss',
  þ: 'th', Þ: 'th',
  ı: 'i', İ: 'i',
};

/**
 * Slugifies a title into a URL-safe handle. Lives in Core precisely because
 * every module would otherwise write a subtly different version — the fitness
 * suite fails any module that tries.
 */
export function slugifyHandle(input: string): string {
  return input
    .replace(/[øØđĐðÐłŁæÆœŒßẞþÞıİ]/g, (char) => NON_DECOMPOSING_LATIN[char] ?? char)
    .normalize('NFKD')
    // Strip combining marks so "Crème" becomes "creme" rather than "crme".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}

/**
 * Handles are unique per store per entity. On collision we suffix rather than
 * fail, because a merchant naming two products "Blue Shirt" is normal, not an
 * error they should have to resolve.
 */
export function disambiguateHandle(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free handle for "${base}" after 999 attempts`);
}

export class StaleWriteError extends Error {
  readonly status = 409;
  constructor(
    readonly entity: string,
    readonly id: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `${entity} ${id} was modified by someone else (expected version ${expected}, found ${actual}). ` +
        'Reload and reapply your change.',
    );
    this.name = 'StaleWriteError';
  }
}

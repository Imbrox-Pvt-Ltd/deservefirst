/**
 * Storefront · engine/compat.ts
 * Loading the compatibility map, and the aliases it produces.
 *
 * The map lives in `config/theme-compat.json` because it is data — a list of
 * names other platforms use, not part of our vocabulary. Loading it here keeps
 * the filters themselves ignorant of it: an alias is built from the filter it
 * points at, so it cannot drift, and nothing in `filters/` mentions a foreign
 * name.
 *
 * Compatibility mode is OFF by default, deliberately. Our names are the real
 * ones and `theme:port` is the recommended path — a ported theme is a theme the
 * developer owns, in our vocabulary, with a reviewable diff. Runtime aliasing is
 * for the cases where porting is not an option: a theme still under upstream
 * development, or one a merchant cannot edit.
 * Layer: engine (infrastructure).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { branding } from '@deservefirst/config';

import { resolveCompatMap, type CompatMap } from '../domain/theme-compat';
import type { FilterDefinition } from './types';

let cached: CompatMap | null = null;

/**
 * The compatibility map, resolved against the current brand.
 *
 * Read from disk once. A missing or unreadable file yields an empty map rather
 * than throwing: compatibility is an optional convenience, and a storefront
 * that will not boot because a compatibility table is absent would be a poor
 * trade.
 */
export function compatMap(): CompatMap {
  if (cached) return cached;

  try {
    // Resolved relative to this file so it works from `src` and `dist` alike;
    // the JSON is copied beside the compiled output by the build.
    const path = join(__dirname, '..', 'config', 'theme-compat.json');
    cached = resolveCompatMap(JSON.parse(readFileSync(path, 'utf8')), branding.slug);
  } catch {
    cached = resolveCompatMap({}, branding.slug);
  }

  return cached;
}

/**
 * Alias definitions for every foreign filter name, derived from ours.
 *
 * Delegation rather than duplication: an alias that reimplemented its target
 * would drift from it, and the drift would show as two filters formatting the
 * same URL differently.
 *
 * A mapping whose target does not exist is skipped rather than thrown, because
 * the map is data that can name a filter a future version will add — and
 * refusing to boot over it would make the table dangerous to edit.
 */
export function aliasFilters(
  filters: readonly FilterDefinition[],
): readonly FilterDefinition[] {
  const byName = new Map(filters.map((filter) => [filter.name, filter]));
  const aliases: FilterDefinition[] = [];

  for (const [foreign, target] of Object.entries(compatMap().filters)) {
    const filter = byName.get(target);
    if (!filter || byName.has(foreign)) continue;
    aliases.push({ ...filter, name: foreign });
  }

  return aliases;
}

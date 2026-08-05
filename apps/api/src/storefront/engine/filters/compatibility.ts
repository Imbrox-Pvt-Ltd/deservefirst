/**
 * Storefront · engine/filters/compatibility.ts
 * Filter names themes already use, mapped to ours.
 *
 * A theme is written against a vocabulary its author already knows, and that
 * vocabulary contains names we would never choose. `shopify_asset_url` appears
 * four times in the reference theme; with `strictFilters` on, not registering it
 * means those four pages do not render at all.
 *
 * So this file exists, and it is the ONLY place such a name may be written —
 * exactly as `packages/config/src/branding.ts` is the only place a competitor
 * name may be defined, and exempted by the same rule for the same reason. This
 * is a compatibility contract with third-party files, not branding: nothing here
 * reaches a merchant's screen, and every alias points at a filter whose real
 * name is ours.
 *
 * Adding to this table should feel like a decision. Each entry is a name we are
 * agreeing to answer to for as long as themes use it.
 * Layer: engine.
 */

import type { FilterDefinition } from '../types';

/**
 * `alias -> the filter it delegates to`.
 *
 * Delegation rather than duplication: an alias that reimplemented its target
 * would drift from it, and the drift would show up as two filters that format
 * the same URL differently.
 */
export const FILTER_ALIASES: Readonly<Record<string, string>> = {
  // Platform-hosted scripts and stylesheets. Ours is `platform_asset_url`.
  shopify_asset_url: 'platform_asset_url',
};

/**
 * Builds the alias definitions from the filters they point at.
 *
 * Throws on an alias whose target does not exist, because the alternative is a
 * name that registers successfully and fails at render time in a theme.
 */
export function aliasFilters(
  filters: readonly FilterDefinition[],
): readonly FilterDefinition[] {
  const byName = new Map(filters.map((filter) => [filter.name, filter]));

  return Object.entries(FILTER_ALIASES).map(([alias, target]) => {
    const filter = byName.get(target);
    if (!filter) {
      throw new Error(`Filter alias "${alias}" points at "${target}", which does not exist`);
    }
    if (byName.has(alias)) {
      throw new Error(`Filter alias "${alias}" collides with a filter of the same name`);
    }
    return { ...filter, name: alias };
  });
}

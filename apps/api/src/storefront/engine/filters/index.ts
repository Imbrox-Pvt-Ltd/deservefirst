/**
 * Storefront · engine/filters/index.ts
 * Every filter the platform adds, in one list.
 *
 * The engine registers from here and nowhere else, so "what filters exist" has
 * a single answer that can be read, tested and diffed. `assertNoDuplicates` runs
 * at startup rather than in a test, because two groups defining the same name is
 * a real possibility as this grows and the loser would vanish silently.
 * Layer: engine.
 */

import type { FilterDefinition, FilterGroup } from '../types';
import { arrayFilters } from './array';
import { colorFilters } from './color';
import { commerceFilters } from './commerce';
import { fontFilters } from './font';
import { htmlFilters } from './html';
import { localizationFilters } from './localization';
import { moneyFilters } from './money';
import { stringFilters } from './string';
import { urlFilters } from './url';

export const FILTER_GROUPS: readonly FilterGroup[] = [
  moneyFilters,
  stringFilters,
  arrayFilters,
  colorFilters,
  fontFilters,
  urlFilters,
  htmlFilters,
  localizationFilters,
  commerceFilters,
];

export function allFilters(): readonly FilterDefinition[] {
  const filters = FILTER_GROUPS.flatMap((group) => group.filters);
  assertNoDuplicates(filters);
  return filters;
}

function assertNoDuplicates(filters: readonly FilterDefinition[]): void {
  const seen = new Map<string, string>();
  for (const group of FILTER_GROUPS) {
    for (const filter of group.filters) {
      const existing = seen.get(filter.name);
      if (existing) {
        throw new Error(
          `Filter "${filter.name}" is defined in both the ${existing} and ${group.name} groups`,
        );
      }
      seen.set(filter.name, group.name);
    }
  }
  if (seen.size !== filters.length) {
    throw new Error('Filter registry is inconsistent');
  }
}

export { handleize } from './string';

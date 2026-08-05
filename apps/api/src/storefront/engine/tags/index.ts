/**
 * Storefront · engine/tags/index.ts
 * Every tag the platform adds, in one list.
 *
 * Same reasoning as the filter registry: "what tags exist" should have a single
 * answer that can be read and diffed, and two definitions of one name should be
 * a startup error rather than a silent race decided by import order.
 * Layer: engine.
 */

import { structureTags } from './structure';
import { themeTags } from './theme';
import type { TagDefinition } from './types';

export function allTags(): readonly TagDefinition[] {
  const tags = [...themeTags, ...structureTags];

  const seen = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag.name)) {
      throw new Error(`Two tags are defined with the name "${tag.name}"`);
    }
    seen.add(tag.name);
  }

  return tags;
}

export { parseTagArgs, asLiteral } from './types';
export type { BlockOpening, BlockTag, InlineTag, RawTag, TagContext, TagDefinition } from './types';

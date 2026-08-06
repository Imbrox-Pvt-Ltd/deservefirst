/**
 * Storefront · domain/drops/theme.ts
 * The theme's own objects: section, block, settings, form, search.
 *
 * These differ from the others in where their data comes from. A product drop
 * projects a row the merchant's staff created; a section drop projects what the
 * merchant chose in the editor, validated against the schema the theme itself
 * declared. So the settings here are already constrained — `settings-schema.ts`
 * decided what types exist and `section-schema.ts` decided what a section may
 * contain — and this file's job is to present them, defaults filled in.
 *
 * Filling defaults is the part that matters. A merchant who never opened a
 * section still gets every setting the schema declared, because a theme reading
 * `section.settings.heading_size` and getting nothing renders a broken layout
 * rather than a default one.
 * Layer: domain (pure).
 */

import { defaultValueFor, type SettingDefinition } from '../settings-schema';
import { defineDrop, dropList, pending } from './define';
import { sortOptionDrop } from './faceting';
import { DEFAULT_SORT, sortOptionsFor } from '../facets';

export interface BlockState {
  readonly id: string;
  readonly type: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** The schema this block's settings were declared by, for defaults. */
  readonly schema?: readonly SettingDefinition[];
  readonly index?: number;
}

export interface SectionState {
  readonly id: string;
  readonly type: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly schema?: readonly SettingDefinition[];
  readonly blocks?: readonly BlockState[];
  readonly index?: number;
  readonly location?: string;
}

export interface FormState {
  readonly type: string;
  readonly id?: string | null;
  readonly action?: string | null;
  readonly errors?: {
    readonly messages?: Readonly<Record<string, string>>;
    readonly translatedFields?: Readonly<Record<string, string>>;
  } | null;
  readonly postedSuccessfully?: boolean;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface SearchState {
  readonly terms: string;
  /** How the shopper asked for the results to be ordered. */
  readonly currentSort?: string | null;
  readonly performed: boolean;
  readonly resultsCount: number;
  readonly types?: readonly string[];
  readonly results?: readonly unknown[];
}

/**
 * A merchant's chosen values, with every declared default filled in.
 *
 * The schema is the authority on what exists. A stored value for a setting the
 * schema no longer declares is dropped rather than passed through — otherwise a
 * theme update that removed a setting would leave the old value readable, and
 * whichever template still referenced it would keep working until it did not.
 */
export function settingsWithDefaults(
  stored: Readonly<Record<string, unknown>>,
  schema: readonly SettingDefinition[] | undefined,
): Readonly<Record<string, unknown>> {
  if (!schema) return { ...stored };

  const resolved: Record<string, unknown> = {};
  for (const setting of schema) {
    if (!setting.id) continue;
    const value = stored[setting.id];
    resolved[setting.id] = value === undefined || value === null ? defaultValueFor(setting) : value;
  }
  return resolved;
}

export const blockDrop = defineDrop<BlockState>('block', {
  id: (block) => block.id,
  type: (block) => block.type,
  settings: (block) => settingsWithDefaults(block.settings, block.schema),
  index: (block) => block.index ?? 0,
  index0: (block) => block.index ?? 0,
  /**
   * The attributes the editor needs to make this block selectable.
   *
   * Rendered by a theme onto the block wrapper. Without it the editor cannot
   * map a click in the preview to a block in the sidebar. Other platforms name
   * this differently; `theme:port` is where that is reconciled.
   */
  editor_attributes: (block) => `data-block-id="${block.id}" data-block-type="${block.type}"`,
});

export const sectionDrop = defineDrop<SectionState>('section', {
  id: (section) => section.id,
  type: (section) => section.type,
  settings: (section) => settingsWithDefaults(section.settings, section.schema),
  index: (section) => section.index ?? 0,
  index0: (section) => section.index ?? 0,
  location: (section) => section.location ?? 'template',

  blocks: (section, context) => dropList(blockDrop, section.blocks ?? [], context),
  /**
   * A map from block id to block, so a theme can find one without looping.
   *
   * Built from the same list, so the two cannot disagree about what exists.
   */
  blocks_by_id: (section, context) =>
    Object.fromEntries(
      (section.blocks ?? []).map((block) => [block.id, blockDrop(block, context)]),
    ),

  editor_attributes: (section) =>
    `data-section-id="${section.id}" data-section-type="${section.type}"`,
});

export const formDrop = defineDrop<FormState>('form', {
  id: (form) => form.id ?? null,
  /**
   * `errors` is the object `default_errors` renders, or nothing.
   *
   * Nothing rather than an empty object, because themes write
   * `{% if form.errors %}` and an empty object is truthy in Liquid — every page
   * would show an empty error box.
   */
  errors: (form) =>
    form.errors && Object.keys(form.errors.messages ?? {}).length > 0
      ? {
          messages: form.errors.messages ?? {},
          translated_fields: form.errors.translatedFields ?? {},
        }
      : null,
  posted_successfully: (form) => form.postedSuccessfully ?? false,
  /**
   * Values the customer already typed, so a failed submit does not clear the
   * form. This is the difference between correcting one field and retyping an
   * address.
   */
  email: (form) => (form.fields?.email as string | undefined) ?? '',
  first_name: (form) => (form.fields?.first_name as string | undefined) ?? '',
  last_name: (form) => (form.fields?.last_name as string | undefined) ?? '',
  body: (form) => (form.fields?.body as string | undefined) ?? '',
  author: (form) => (form.fields?.author as string | undefined) ?? '',

  /**
   * Address fields, kept for the same reason as the ones above: a failed
   * submit that clears them turns correcting one field into retyping an
   * address.
   */
  company: (form) => (form.fields?.company as string | undefined) ?? '',
  address1: (form) => (form.fields?.address1 as string | undefined) ?? '',
  address2: (form) => (form.fields?.address2 as string | undefined) ?? '',
  city: (form) => (form.fields?.city as string | undefined) ?? '',
  province: (form) => (form.fields?.province as string | undefined) ?? '',
  zip: (form) => (form.fields?.zip as string | undefined) ?? '',
  country: (form) => (form.fields?.country as string | undefined) ?? '',
  phone: (form) => (form.fields?.phone as string | undefined) ?? '',
});

export const searchDrop = defineDrop<SearchState>('search', {
  terms: (search) => search.terms,
  /** Whether a search actually ran, as opposed to an empty search page. */
  performed: (search) => search.performed,
  results_count: (search) => search.resultsCount,
  results: (search) => search.results ?? [],
  types: (search) => search.types ?? ['product', 'page', 'article'],

  /**
   * The same ordering controls a collection has.
   *
   * A shopper who has just searched wants "cheapest first" as much as one
   * browsing a collection, and the theme renders the same snippet for both —
   * so the object has to answer the same names.
   */
  sort_by: (search) => search.currentSort ?? '',
  default_sort_by: () => DEFAULT_SORT,
  sort_options: (search, context) =>
    dropList(sortOptionDrop, sortOptionsFor(search.currentSort ?? DEFAULT_SORT), context),

  /**
   * Faceted search is not built, and this says so rather than pretending.
   *
   * An empty list is what the theme tests before drawing a filter sidebar, so
   * it draws none — which is correct. Filters over a search result need the
   * facet counts computed across three kinds of record at once, which the
   * collection facets do not do.
   */
  filters: pending(
    'Faceting a search result needs counts across products, pages and articles '
    + 'at once, which the collection facets do not compute.',
    [] as readonly unknown[],
  ),
});

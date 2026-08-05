/**
 * Storefront · domain/section-schema.ts
 * The `{% schema %}` block: what a section is, and what it may contain.
 *
 * A section is the unit a merchant adds, reorders and removes; a block is the
 * unit they add inside one. That two-level structure is the whole of the theme
 * editor's model, and the rules here are what stop a schema producing an editor
 * a merchant cannot use — a section that allows unlimited blocks of a type that
 * renders one at a time, a preset naming a block the section does not define.
 *
 * These are validated when a theme is uploaded rather than when a page renders.
 * A schema error found at render time is a broken storefront; the same error
 * found at upload is a message to the person who can fix it.
 * Layer: domain (pure).
 */

import {
  ThemeSchemaError,
  assertNoDuplicateIds,
  assertSettingValid,
  type SettingDefinition,
} from './settings-schema';

export interface BlockDefinition {
  readonly type: string;
  readonly name?: string;
  readonly limit?: number;
  readonly settings?: readonly SettingDefinition[];
}

export interface PresetBlock {
  readonly type: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface SectionPreset {
  readonly name: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly blocks?: readonly PresetBlock[];
}

export interface SectionSchema {
  readonly name: string;
  /**
   * The element this is wrapped in, or `null` for no wrapper at all.
   *
   * `null` is not "unset" — it is a deliberate instruction, and every theme
   * block in the reference theme uses it. A block that wraps itself in a `div`
   * it did not ask for breaks the grid it was dropped into, so the ability to
   * render bare is load-bearing rather than cosmetic.
   */
  readonly tag?: string | null;
  readonly class?: string;
  readonly limit?: number;
  readonly settings?: readonly SettingDefinition[];
  readonly blocks?: readonly BlockDefinition[];
  readonly max_blocks?: number;
  readonly presets?: readonly SectionPreset[];
  readonly default?: { settings?: Readonly<Record<string, unknown>>; blocks?: readonly PresetBlock[] };
  readonly enabled_on?: { templates?: readonly string[]; groups?: readonly string[] };
  readonly disabled_on?: { templates?: readonly string[]; groups?: readonly string[] };
  readonly locales?: Readonly<Record<string, Record<string, string>>>;
}

/**
 * The reference product's ceiling on blocks in one section.
 *
 * A limit rather than a guideline: the editor renders every block's settings in
 * a panel, and a section with two hundred blocks is a panel nobody can scroll.
 */
export const MAX_BLOCKS_PER_SECTION = 50;

/** Wrapper tags a section may use. Not arbitrary HTML — see `assertSchemaValid`. */
const ALLOWED_TAGS = ['div', 'section', 'article', 'aside', 'header', 'footer'];

/**
 * `@app` and `@theme` are block types with meanings rather than names.
 *
 * `@app` lets an installed app place a block in the merchant's section; `@theme`
 * accepts any block the theme defines. Both are the reference product's, and a
 * theme using them expects them to work.
 */
export const SPECIAL_BLOCK_TYPES = ['@app', '@theme'];

/**
 * A block type belonging to a `blocks/*.liquid` file rather than defined inline.
 *
 * Online Store 2.0 theme blocks: a section can reference a block the theme
 * defines in its own file, and the name lives in that file's schema rather than
 * being repeated at every reference. A leading underscore marks it private —
 * usable by the theme, not offered in the merchant's block picker — which is
 * why those carry no name either.
 *
 * Learned from a real theme rather than assumed. Of its 241 block definitions,
 * 238 are named and defined inline; the 3 unnamed ones are every one of them a
 * reference to a file in `blocks/`, and there were no unnamed blocks that were
 * not. The first version of this rule refused those three.
 */
export interface ThemeInventory {
  /** Block types the theme defines as files, without the `_` prefix stripped. */
  readonly blockFiles: ReadonlySet<string>;
}

const NO_BLOCK_FILES: ThemeInventory = { blockFiles: new Set() };

export function assertSchemaValid(
  sectionName: string,
  schema: SectionSchema,
  inventory: ThemeInventory = NO_BLOCK_FILES,
): void {
  const where = `section "${sectionName}"`;

  if (typeof schema.name !== 'string' || schema.name.trim().length === 0) {
    // The name is what a merchant sees in "Add section". Without it the editor
    // offers something unlabelled.
    throw new ThemeSchemaError(where, 'a section schema needs a name');
  }

  // `null` means no wrapper, which is a choice rather than an omission.
  if (schema.tag !== undefined && schema.tag !== null && !ALLOWED_TAGS.includes(schema.tag)) {
    // Arbitrary tags would let a section wrap itself in <script> — the section
    // wrapper is emitted by us, so it is ours to constrain.
    throw new ThemeSchemaError(
      where,
      `"${schema.tag}" is not a wrapper tag a section may use (${ALLOWED_TAGS.join(', ')})`,
    );
  }

  for (const setting of schema.settings ?? []) {
    assertSettingValid(`${where} settings`, setting);
  }
  assertNoDuplicateIds(`${where} settings`, schema.settings ?? []);

  assertBlocksValid(where, schema, inventory);
  assertPresetsValid(where, schema, inventory);
}

function assertBlocksValid(
  where: string,
  schema: SectionSchema,
  inventory: ThemeInventory,
): void {
  const blocks = schema.blocks ?? [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (typeof block.type !== 'string' || block.type.length === 0) {
      throw new ThemeSchemaError(where, 'every block needs a type');
    }
    if (seen.has(block.type)) {
      // Two definitions for one type means a block in a template cannot be
      // resolved to a definition, and the editor shows whichever it found first.
      throw new ThemeSchemaError(where, `two blocks share the type "${block.type}"`);
    }
    seen.add(block.type);

    const isThemeBlockFile = inventory.blockFiles.has(block.type);

    if (!SPECIAL_BLOCK_TYPES.includes(block.type) && !isThemeBlockFile) {
      if (!block.name) {
        throw new ThemeSchemaError(
          where,
          `block "${block.type}" needs a name, or a blocks/${block.type}.liquid file to take it from`,
        );
      }
      for (const setting of block.settings ?? []) {
        assertSettingValid(`${where} block "${block.type}"`, setting);
      }
      assertNoDuplicateIds(`${where} block "${block.type}"`, block.settings ?? []);
    }

    if (block.limit !== undefined && (!Number.isInteger(block.limit) || block.limit < 1)) {
      throw new ThemeSchemaError(where, `block "${block.type}" has a limit that is not a count`);
    }
  }

  if (schema.max_blocks !== undefined) {
    if (!Number.isInteger(schema.max_blocks) || schema.max_blocks < 1) {
      throw new ThemeSchemaError(where, 'max_blocks must be a positive whole number');
    }
    if (schema.max_blocks > MAX_BLOCKS_PER_SECTION) {
      throw new ThemeSchemaError(
        where,
        `max_blocks is ${schema.max_blocks}; the editor allows ${MAX_BLOCKS_PER_SECTION}`,
      );
    }
  }

  if (blocks.length === 0 && schema.max_blocks !== undefined) {
    // A limit on something that cannot exist. Almost always a section that lost
    // its blocks in an edit and kept the limit.
    throw new ThemeSchemaError(where, 'max_blocks is set but the section defines no blocks');
  }
}

function assertPresetsValid(
  where: string,
  schema: SectionSchema,
  inventory: ThemeInventory,
): void {
  const definedTypes = new Set([
    ...(schema.blocks ?? []).map((block) => block.type),
    ...inventory.blockFiles,
  ]);
  const acceptsAnything = definedTypes.has('@theme');

  for (const preset of schema.presets ?? []) {
    if (typeof preset.name !== 'string' || preset.name.trim().length === 0) {
      throw new ThemeSchemaError(where, 'every preset needs a name');
    }

    for (const block of preset.blocks ?? []) {
      if (!acceptsAnything && !definedTypes.has(block.type)) {
        /**
         * A preset naming a block the section does not define.
         *
         * The failure this prevents is quiet and annoying: a merchant adds the
         * section from "Add section", the preset tries to create a block with
         * no definition, and they get a section that is missing part of itself
         * with nothing saying why.
         */
        throw new ThemeSchemaError(
          where,
          `preset "${preset.name}" adds a "${block.type}" block, which this section does not define`,
        );
      }
    }

    const count = preset.blocks?.length ?? 0;
    if (schema.max_blocks !== undefined && count > schema.max_blocks) {
      throw new ThemeSchemaError(
        where,
        `preset "${preset.name}" adds ${count} blocks but max_blocks is ${schema.max_blocks}`,
      );
    }
  }
}

/**
 * Whether a section may be added to a given template.
 *
 * `enabled_on` and `disabled_on` are mutually exclusive in the reference
 * product — a schema with both is ambiguous about which wins, so it is refused
 * rather than resolved by a rule nobody could guess.
 */
export function assertPlacementCoherent(sectionName: string, schema: SectionSchema): void {
  if (schema.enabled_on && schema.disabled_on) {
    throw new ThemeSchemaError(
      `section "${sectionName}"`,
      'a section may declare enabled_on or disabled_on, not both',
    );
  }
}

export function allowedOnTemplate(schema: SectionSchema, template: string): boolean {
  if (schema.enabled_on?.templates) {
    return schema.enabled_on.templates.includes(template) || schema.enabled_on.templates.includes('*');
  }
  if (schema.disabled_on?.templates) {
    return !schema.disabled_on.templates.includes(template);
  }
  return true;
}

/** How many of one block type a section still accepts. */
export function blockCapacity(
  schema: SectionSchema,
  blockType: string,
  existing: readonly { type: string }[],
): number {
  const definition = (schema.blocks ?? []).find((block) => block.type === blockType);
  const perType = definition?.limit ?? Number.POSITIVE_INFINITY;
  const used = existing.filter((block) => block.type === blockType).length;

  const overall = schema.max_blocks ?? MAX_BLOCKS_PER_SECTION;
  const remainingOverall = overall - existing.length;

  return Math.max(0, Math.min(perType - used, remainingOverall));
}

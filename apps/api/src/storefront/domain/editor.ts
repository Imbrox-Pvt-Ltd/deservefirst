/**
 * Storefront · domain/editor.ts
 * What a merchant's edit does to a template.
 *
 * The theme editor is a document editor: a JSON template is an ordered list of
 * sections with settings, and every action a merchant takes — drag a section,
 * tick a checkbox, add a block — is a transformation of that document. Doing it
 * here, purely, means the hard parts are testable without a browser.
 *
 * The hard parts are not the obvious ones. Reordering is trivial. What is not:
 *
 *   **Two editors.** A merchant and their designer both have the editor open.
 *   Last-write-wins silently discards one of them, and neither is told. Every
 *   change carries the version it was made against.
 *
 *   **Settings are typed.** A `range` has a min, max and step; a `select` has
 *   options. Storing whatever arrives means the editor accepts a value the
 *   theme cannot render, and the failure appears on the storefront rather than
 *   in the editor where somebody could fix it.
 *
 *   **Limits are the theme's.** `max_blocks`, a block's `limit`, and
 *   `enabled_on`/`disabled_on` are declared by the theme author, and the editor
 *   is where they are enforced — a section added past its limit renders wrongly
 *   for every visitor.
 * Layer: domain (pure).
 */

import {
  assertSettingValid,
  defaultValueFor,
  isInputSetting,
  type SettingDefinition,
} from './settings-schema';
import { allowedOnTemplate, blockCapacity, type SectionSchema } from './section-schema';
import type { TemplateSection } from './template-resolution';

export class EditorError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'conflict'
      | 'invalid'
      | 'limit_reached'
      | 'not_allowed_here',
    message: string,
  ) {
    super(message);
    this.name = 'EditorError';
  }
}

/**
 * The document being edited.
 *
 * `version` is what makes concurrent editing safe: an edit states the version it
 * was made against, and a mismatch is refused rather than merged. Two people
 * dragging sections at once produce a conflict somebody is told about, instead
 * of one of them losing their afternoon silently.
 */
export interface TemplateDocument {
  readonly templatePath: string;
  readonly sections: readonly TemplateSection[];
  readonly version: number;
}

/** The theme's declarations, needed to validate anything. */
export interface SchemaLookup {
  /** The `{% schema %}` of a section type, or undefined if the theme lacks it. */
  schemaFor(sectionType: string): SectionSchema | undefined;
}

export type EditorAction =
  | { readonly kind: 'move_section'; readonly sectionId: string; readonly toIndex: number }
  | { readonly kind: 'add_section'; readonly sectionType: string; readonly atIndex?: number; readonly presetName?: string }
  | { readonly kind: 'remove_section'; readonly sectionId: string }
  | { readonly kind: 'toggle_section'; readonly sectionId: string; readonly disabled: boolean }
  | { readonly kind: 'update_settings'; readonly sectionId: string; readonly settings: Readonly<Record<string, unknown>> }
  | { readonly kind: 'add_block'; readonly sectionId: string; readonly blockType: string; readonly atIndex?: number }
  | { readonly kind: 'remove_block'; readonly sectionId: string; readonly blockId: string }
  | { readonly kind: 'move_block'; readonly sectionId: string; readonly blockId: string; readonly toIndex: number }
  | { readonly kind: 'update_block_settings'; readonly sectionId: string; readonly blockId: string; readonly settings: Readonly<Record<string, unknown>> };

export interface EditRequest {
  readonly action: EditorAction;
  /** The version the merchant's editor was showing. */
  readonly expectedVersion: number;
}

/**
 * Applies one action, returning a new document.
 *
 * Never mutates: the caller holds the previous version, which is what lets the
 * editor undo without re-fetching and what makes a rejected edit leave the
 * document exactly as it was.
 */
export function applyEdit(
  document: TemplateDocument,
  request: EditRequest,
  schemas: SchemaLookup,
  newId: () => string,
): TemplateDocument {
  if (request.expectedVersion !== document.version) {
    throw new EditorError(
      'conflict',
      'This template changed since you opened it — someone else may be editing. ' +
        'Reload to see their changes before saving yours.',
    );
  }

  const sections = applyToSections(document, request.action, schemas, newId);
  return { ...document, sections, version: document.version + 1 };
}

function applyToSections(
  document: TemplateDocument,
  action: EditorAction,
  schemas: SchemaLookup,
  newId: () => string,
): readonly TemplateSection[] {
  const sections = [...document.sections];
  const indexOf = (id: string): number => {
    const at = sections.findIndex((section) => section.id === id);
    if (at === -1) throw new EditorError('not_found', `No section "${id}" in this template`);
    return at;
  };

  switch (action.kind) {
    case 'move_section': {
      const from = indexOf(action.sectionId);
      const [moved] = sections.splice(from, 1);
      // Clamped rather than refused: a drag past the end is a gesture meaning
      // "put it last", not an error to report back to somebody's mouse.
      const to = Math.max(0, Math.min(action.toIndex, sections.length));
      sections.splice(to, 0, moved as TemplateSection);
      return sections;
    }

    case 'add_section': {
      const schema = schemas.schemaFor(action.sectionType);
      if (!schema) {
        throw new EditorError('not_found', `This theme has no "${action.sectionType}" section`);
      }

      /**
       * The theme decides where its sections may go.
       *
       * A section declaring `enabled_on: { templates: ['product'] }` reads
       * `product` and renders nothing anywhere else; letting a merchant add it
       * to the homepage produces an empty band they cannot diagnose.
       */
      const templateName = templateNameOf(document.templatePath);
      if (!allowedOnTemplate(schema, templateName)) {
        throw new EditorError(
          'not_allowed_here',
          `"${schema.name}" cannot be used on the ${templateName} template`,
        );
      }

      if (schema.limit !== undefined) {
        const existing = sections.filter((section) => section.type === action.sectionType).length;
        if (existing >= schema.limit) {
          throw new EditorError(
            'limit_reached',
            `This template already has the most "${schema.name}" sections it allows (${schema.limit})`,
          );
        }
      }

      const preset = action.presetName
        ? schema.presets?.find((entry) => entry.name === action.presetName)
        : (schema.presets?.[0] ?? schema.default);

      const section: TemplateSection = {
        id: uniqueSectionId(action.sectionType, sections, newId),
        type: action.sectionType,
        settings: withDefaults(preset?.settings ?? {}, schema.settings),
        blocks: (preset?.blocks ?? []).map((block) => ({
          id: newId(),
          type: block.type,
          settings: withDefaults(
            block.settings ?? {},
            schema.blocks?.find((entry) => entry.type === block.type)?.settings,
          ),
        })),
        disabled: false,
      };

      const at = action.atIndex === undefined
        ? sections.length
        : Math.max(0, Math.min(action.atIndex, sections.length));
      sections.splice(at, 0, section);
      return sections;
    }

    case 'remove_section': {
      const at = indexOf(action.sectionId);
      sections.splice(at, 1);
      return sections;
    }

    case 'toggle_section': {
      const at = indexOf(action.sectionId);
      /**
       * Disabled, not deleted.
       *
       * The settings stay in the file so switching it back on restores what the
       * merchant had configured. Removing and re-adding would give them the
       * preset instead, silently discarding their work.
       */
      sections[at] = { ...(sections[at] as TemplateSection), disabled: action.disabled };
      return sections;
    }

    case 'update_settings': {
      const at = indexOf(action.sectionId);
      const section = sections[at] as TemplateSection;
      const schema = schemas.schemaFor(section.type);
      sections[at] = {
        ...section,
        settings: mergeValidated(section.settings, action.settings, schema?.settings, section.type),
      };
      return sections;
    }

    case 'add_block': {
      const at = indexOf(action.sectionId);
      const section = sections[at] as TemplateSection;
      const schema = schemas.schemaFor(section.type);
      if (!schema) throw new EditorError('not_found', `No schema for "${section.type}"`);

      const capacity = blockCapacity(schema, action.blockType, section.blocks);
      if (capacity <= 0) {
        throw new EditorError(
          'limit_reached',
          `"${schema.name}" cannot take another "${action.blockType}" block`,
        );
      }

      const definition = schema.blocks?.find((entry) => entry.type === action.blockType);
      const blocks = [...section.blocks];
      const index = action.atIndex === undefined
        ? blocks.length
        : Math.max(0, Math.min(action.atIndex, blocks.length));

      blocks.splice(index, 0, {
        id: newId(),
        type: action.blockType,
        settings: withDefaults({}, definition?.settings),
      });

      sections[at] = { ...section, blocks };
      return sections;
    }

    case 'remove_block': {
      const at = indexOf(action.sectionId);
      const section = sections[at] as TemplateSection;
      const blocks = section.blocks.filter((block) => block.id !== action.blockId);
      if (blocks.length === section.blocks.length) {
        throw new EditorError('not_found', `No block "${action.blockId}" in that section`);
      }
      sections[at] = { ...section, blocks };
      return sections;
    }

    case 'move_block': {
      const at = indexOf(action.sectionId);
      const section = sections[at] as TemplateSection;
      const blocks = [...section.blocks];
      const from = blocks.findIndex((block) => block.id === action.blockId);
      if (from === -1) throw new EditorError('not_found', `No block "${action.blockId}"`);

      const [moved] = blocks.splice(from, 1);
      blocks.splice(Math.max(0, Math.min(action.toIndex, blocks.length)), 0, moved as never);
      sections[at] = { ...section, blocks };
      return sections;
    }

    case 'update_block_settings': {
      const at = indexOf(action.sectionId);
      const section = sections[at] as TemplateSection;
      const schema = schemas.schemaFor(section.type);
      const blocks = section.blocks.map((block) => {
        if (block.id !== action.blockId) return block;
        const definition = schema?.blocks?.find((entry) => entry.type === block.type);
        return {
          ...block,
          settings: mergeValidated(block.settings, action.settings, definition?.settings, block.type),
        };
      });
      sections[at] = { ...section, blocks };
      return sections;
    }

    default: {
      // Exhaustive: a new action kind is a compile error rather than a silent
      // no-op that looks like the editor ignoring a click.
      const unreachable: never = action;
      throw new EditorError('invalid', `Unknown action ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Merges a merchant's changes, refusing anything the schema does not declare.
 *
 * Unknown ids are dropped rather than stored: a setting the theme does not
 * declare cannot be rendered, so keeping it would grow the file with values
 * nothing reads. Wrong values are refused loudly — this is the editor, the one
 * place where a person is present to be told.
 */
function mergeValidated(
  current: Readonly<Record<string, unknown>>,
  incoming: Readonly<Record<string, unknown>>,
  schema: readonly SettingDefinition[] | undefined,
  where: string,
): Readonly<Record<string, unknown>> {
  if (!schema) return { ...current, ...incoming };

  const declared = new Map(
    schema.filter(isInputSetting).map((setting) => [setting.id as string, setting]),
  );

  const merged: Record<string, unknown> = { ...current };
  for (const [id, value] of Object.entries(incoming)) {
    const setting = declared.get(id);
    if (!setting) continue;
    assertValueAllowed(setting, value, where);
    merged[id] = value;
  }
  return merged;
}

/**
 * Whether a value is one the theme can actually render.
 *
 * The schema already says what a setting is; this holds the merchant's value to
 * it. Without this the editor happily stores `"large"` in a `range` and the
 * storefront renders a broken layout with nothing to explain why.
 */
function assertValueAllowed(setting: SettingDefinition, value: unknown, where: string): void {
  // The declaration itself is checked at upload; this is only about the value.
  assertSettingValid(`${where}.${setting.id}`, setting);

  switch (setting.type) {
    case 'checkbox':
      if (typeof value !== 'boolean') {
        throw new EditorError('invalid', `"${setting.id}" is a checkbox and takes true or false`);
      }
      return;

    case 'range':
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        throw new EditorError('invalid', `"${setting.id}" takes a number`);
      }
      if (setting.type === 'range') {
        const { min = 0, max = 100, step = 1 } = setting;
        if (numeric < min || numeric > max) {
          throw new EditorError('invalid', `"${setting.id}" must be between ${min} and ${max}`);
        }
        /**
         * On a step, not merely within range.
         *
         * A slider can only produce values on its steps, so one that is not is
         * either an API caller bypassing the editor or a bug — and the theme's
         * CSS may well assume the increments.
         */
        const offset = (numeric - min) / step;
        if (Math.abs(offset - Math.round(offset)) > 1e-9) {
          throw new EditorError('invalid', `"${setting.id}" moves in steps of ${step}`);
        }
      }
      return;
    }

    case 'select':
    case 'radio': {
      const allowed = (setting.options ?? []).map((option) => option.value);
      if (!allowed.includes(String(value))) {
        throw new EditorError(
          'invalid',
          `"${setting.id}" must be one of: ${allowed.join(', ')}`,
        );
      }
      return;
    }

    case 'product_list':
    case 'collection_list':
    case 'metaobject_list':
      if (!Array.isArray(value)) {
        throw new EditorError('invalid', `"${setting.id}" takes a list`);
      }
      if (setting.limit !== undefined && value.length > setting.limit) {
        throw new EditorError('invalid', `"${setting.id}" takes at most ${setting.limit}`);
      }
      return;

    default:
      // Text-like and reference types: the schema constrains what the editor
      // OFFERS, and the value is whatever was chosen from it.
      return;
  }
}

/** A section's settings with every declared default present. */
function withDefaults(
  chosen: Readonly<Record<string, unknown>>,
  schema: readonly SettingDefinition[] | undefined,
): Readonly<Record<string, unknown>> {
  if (!schema) return { ...chosen };
  const settings: Record<string, unknown> = {};
  for (const setting of schema) {
    if (!setting.id || !isInputSetting(setting)) continue;
    settings[setting.id] =
      chosen[setting.id] !== undefined ? chosen[setting.id] : defaultValueFor(setting);
  }
  return settings;
}

/**
 * A readable, unique id for a new section.
 *
 * Readable because it ends up in the JSON file a developer reads and in the
 * editor's own URLs — `image-banner-2` says what it is where `s_a91f3` does
 * not. Uniqueness is checked against the document rather than assumed from the
 * generator, since a merchant may have removed and re-added the same type.
 */
function uniqueSectionId(
  type: string,
  sections: readonly TemplateSection[],
  newId: () => string,
): string {
  const taken = new Set(sections.map((section) => section.id));
  if (!taken.has(type)) return type;

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${type}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${type}-${newId()}`;
}

/** `templates/product.wholesale.json` → `product`. */
export function templateNameOf(path: string): string {
  const file = path.split('/').pop() ?? '';
  return file.replace(/\.(json|liquid)$/, '').split('.')[0] ?? '';
}

/** The document as the JSON a theme file holds. */
export function serialiseTemplate(document: TemplateDocument): string {
  const sections: Record<string, unknown> = {};
  for (const section of document.sections) {
    const entry: Record<string, unknown> = { type: section.type, settings: section.settings };
    if (section.blocks.length > 0) {
      entry.blocks = Object.fromEntries(
        section.blocks.map((block) => [block.id, { type: block.type, settings: block.settings }]),
      );
      entry.block_order = section.blocks.map((block) => block.id);
    }
    if (section.disabled) entry.disabled = true;
    sections[section.id] = entry;
  }

  /**
   * `order` is written explicitly, always.
   *
   * JSON object key order is not guaranteed by the spec, and every tool that
   * rewrites the file may change it. A template whose sections silently
   * reordered on save would be a bug nobody could reproduce.
   */
  return `${JSON.stringify(
    { sections, order: document.sections.map((section) => section.id) },
    null,
    2,
  )}\n`;
}

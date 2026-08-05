/**
 * Storefront · domain/settings-schema.ts
 * The setting input types a theme may declare.
 *
 * Matched to the reference product's set deliberately and completely, because
 * this is the surface a theme author has already learned. A schema that
 * supports eighteen of their twenty-two input types does not mean "mostly
 * compatible" — it means every theme using the other four fails to load, and
 * the author cannot tell which four without reading our source.
 *
 * The split below is the important part. INPUT settings hold a value a merchant
 * chose; SIDEBAR settings are labels and explanations that hold nothing. They
 * are in one list in the JSON because that is how a schema is authored — in
 * document order — and separating them at parse time is what stops a `header`
 * ending up in `settings_data.json` as though somebody had set it.
 * Layer: domain (pure).
 */

/**
 * Settings that hold a merchant's answer.
 *
 * Every one of these appears in `settings_data.json` and is readable from a
 * theme as `settings.<id>` or `section.settings.<id>`.
 */
export const INPUT_SETTING_TYPES = [
  // Basic
  'checkbox',
  'number',
  'radio',
  'range',
  'select',
  'text',
  'textarea',
  // Specialised
  'article',
  'blog',
  'collection',
  'collection_list',
  'color',
  'color_background',
  'color_scheme',
  'color_scheme_group',
  'font_picker',
  'html',
  'image_picker',
  'inline_richtext',
  'link_list',
  'liquid',
  'page',
  'product',
  'product_list',
  'richtext',
  'text_alignment',
  'url',
  'video',
  'video_url',
  'metaobject',
  'metaobject_list',
  'style.layout_panel',
  'style.size_panel',
  'style.spacing_panel',
] as const;

/**
 * Settings that display something and hold nothing.
 *
 * A `header` in `settings_data.json` would be a value nobody set, and the next
 * reader would reasonably wonder what it meant.
 */
export const SIDEBAR_SETTING_TYPES = ['header', 'paragraph'] as const;

export type InputSettingType = (typeof INPUT_SETTING_TYPES)[number];
export type SidebarSettingType = (typeof SIDEBAR_SETTING_TYPES)[number];
export type SettingType = InputSettingType | SidebarSettingType;

export class ThemeSchemaError extends Error {
  constructor(
    readonly where: string,
    detail: string,
  ) {
    super(`${where}: ${detail}`);
    this.name = 'ThemeSchemaError';
  }
}

export interface SettingOption {
  readonly value: string;
  readonly label: string;
  readonly group?: string;
}

export interface SettingDefinition {
  readonly type: SettingType;
  /** Absent on header and paragraph — they hold nothing to address. */
  readonly id?: string;
  readonly label?: string;
  readonly info?: string;
  readonly default?: unknown;
  readonly placeholder?: string;
  readonly options?: readonly SettingOption[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly limit?: number;
  readonly content?: string;
  readonly accept?: readonly string[];
  readonly visible_if?: string;
}

/** Whether this definition carries a merchant's value. */
export function isInputSetting(setting: SettingDefinition): boolean {
  return (INPUT_SETTING_TYPES as readonly string[]).includes(setting.type);
}

/** `range` is the one type whose own numbers can be nonsense. */
function assertRangeCoherent(where: string, setting: SettingDefinition): void {
  const { min, max, step } = setting;
  if (typeof min !== 'number' || typeof max !== 'number') {
    throw new ThemeSchemaError(where, 'a range needs a numeric min and max');
  }
  if (max <= min) {
    throw new ThemeSchemaError(where, `max (${max}) must be greater than min (${min})`);
  }
  if (step !== undefined && (typeof step !== 'number' || step <= 0)) {
    throw new ThemeSchemaError(where, 'step must be a positive number');
  }

  /**
   * The reference product caps a range at 101 positions.
   *
   * Not arbitrary: the editor renders a slider, and a range of 0–10000 by 1 is
   * a control nobody can hit a value on. An author hitting this has almost
   * certainly meant `number`.
   */
  const positions = Math.floor((max - min) / (step ?? 1)) + 1;
  if (positions > 101) {
    throw new ThemeSchemaError(
      where,
      `this range has ${positions} positions; the editor allows 101. Use "number" instead.`,
    );
  }
}

export function assertSettingValid(where: string, setting: SettingDefinition): void {
  const known = [...INPUT_SETTING_TYPES, ...SIDEBAR_SETTING_TYPES] as readonly string[];
  if (!known.includes(setting.type)) {
    // Named, because an author who typed `colour` should be told rather than
    // watch the setting silently not appear in the editor.
    throw new ThemeSchemaError(where, `"${setting.type}" is not a setting type`);
  }

  if (isInputSetting(setting)) {
    if (!setting.id) {
      throw new ThemeSchemaError(where, `a ${setting.type} setting needs an id`);
    }
    if (!/^[A-Za-z_][\w-]*$/.test(setting.id)) {
      // The id becomes `settings.<id>` in Liquid, so it has to be addressable
      // there — one with a dot or a space is unreachable from the theme that
      // declared it.
      throw new ThemeSchemaError(where, `"${setting.id}" is not usable as settings.<id>`);
    }
  } else if (setting.id) {
    throw new ThemeSchemaError(
      where,
      `a ${setting.type} holds no value, so it should not have an id`,
    );
  }

  if (setting.type === 'range') assertRangeCoherent(where, setting);

  if (setting.type === 'select' || setting.type === 'radio') {
    if (!setting.options || setting.options.length === 0) {
      throw new ThemeSchemaError(where, `a ${setting.type} needs options`);
    }
    const seen = new Set<string>();
    for (const option of setting.options) {
      if (typeof option.value !== 'string' || typeof option.label !== 'string') {
        throw new ThemeSchemaError(where, 'every option needs a value and a label');
      }
      if (seen.has(option.value)) {
        // Two options with one value means the editor cannot show which is
        // selected, and the merchant's choice is decided by iteration order.
        throw new ThemeSchemaError(where, `two options share the value "${option.value}"`);
      }
      seen.add(option.value);
    }

    if (setting.default !== undefined) {
      const values = setting.options.map((option) => option.value);
      if (!values.includes(String(setting.default))) {
        throw new ThemeSchemaError(
          where,
          `the default "${String(setting.default)}" is not one of the options`,
        );
      }
    }
  }
}

/** Every id a group of settings declares, for duplicate detection. */
export function settingIds(settings: readonly SettingDefinition[]): readonly string[] {
  return settings.filter(isInputSetting).map((setting) => setting.id as string);
}

export function assertNoDuplicateIds(where: string, settings: readonly SettingDefinition[]): void {
  const seen = new Set<string>();
  for (const id of settingIds(settings)) {
    if (seen.has(id)) {
      // The later one silently wins otherwise, and which is "later" is document
      // order — so the bug moves when somebody reorders the file.
      throw new ThemeSchemaError(where, `two settings share the id "${id}"`);
    }
    seen.add(id);
  }
}

/**
 * The value a setting starts at when a merchant has not chosen.
 *
 * Explicit rather than `undefined`, because a theme reads `settings.foo` and
 * renders it. `undefined` becomes the string "undefined" in a template, whereas
 * the type-appropriate empty value renders as nothing.
 */
export function defaultValueFor(setting: SettingDefinition): unknown {
  if (setting.default !== undefined) return setting.default;

  switch (setting.type) {
    case 'checkbox':
      return false;
    case 'number':
    case 'range':
      return setting.min ?? 0;
    case 'product_list':
    case 'collection_list':
    case 'metaobject_list':
      return [];
    case 'select':
    case 'radio':
      return setting.options?.[0]?.value ?? '';
    default:
      return '';
  }
}

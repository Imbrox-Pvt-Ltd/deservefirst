'use client';

/**
 * Web · components/theme-editor/SettingInput.tsx
 * One theme setting, drawn as the control its type deserves.
 *
 * This is the bulk of the editor's surface: a theme declares settings and the
 * editor draws them, so the mapping from thirty-five declared types to real
 * controls IS the editing experience. Getting it wrong is not cosmetic — a
 * `range` drawn as a text box lets a merchant type a value the theme cannot
 * render, and a `color` drawn as a text box means guessing hex codes.
 *
 * Three rules run through it:
 *
 *   **The schema's constraints reach the control.** A range's min, max and step
 *   become the slider's; a select's options become the dropdown's. The editor
 *   should make an invalid value unreachable rather than merely refuse it after
 *   the fact — the server still validates, but a control that lets you do the
 *   wrong thing has already wasted somebody's time.
 *
 *   **`info` is help text, not a tooltip.** Theme authors write it to explain
 *   what a setting does, and hiding it behind a hover is hiding the answer.
 *
 *   **Unknown types degrade to text.** A theme built for a newer version may
 *   declare a type we do not draw yet; a text box is wrong but usable, whereas
 *   a blank space is a setting the merchant cannot find.
 * Layer: web.
 */

import {
  Badge,
  BlockStack,
  Box,
  Checkbox,
  InlineStack,
  RangeSlider,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { isPickableListType, ResourceListPicker } from './ResourceListPicker';
import { isPickableType, ResourcePicker } from './ResourcePicker';

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingDefinition {
  readonly type: string;
  readonly id?: string;
  readonly label?: string;
  readonly info?: string;
  readonly placeholder?: string;
  readonly options?: readonly SettingOption[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly content?: string;
  readonly default?: unknown;
  /** A list setting's cap, when the theme's schema declares one. */
  readonly limit?: number;
}

export interface SettingInputProps {
  readonly setting: SettingDefinition;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly disabled?: boolean;
}

/** Types that display something and hold no value. */
const SIDEBAR_TYPES = new Set(['header', 'paragraph']);

/** Types drawn as a plain single-line text field. */
const TEXT_TYPES = new Set(['text', 'url', 'video_url', 'inline_richtext']);

/** Types drawn as a multi-line field. */
const AREA_TYPES = new Set(['textarea', 'richtext', 'html', 'liquid']);

/**
 * Types that take a value with nothing to search for it.
 *
 * Products, collections, pages, blogs, posts and menus have moved to
 * `ResourcePicker` — they are records this store owns and the editor can list
 * them. What remains are values that live outside the catalogue: an image URL,
 * a video URL, a font family. They keep a labelled field with the expected
 * value named beside it, which is honest about there being nothing to browse.
 */
const PICKER_TYPES: Readonly<Record<string, string>> = {
  image_picker: 'Image URL',
  video: 'Video URL',
  font_picker: 'Font family',
  metaobject: 'Entry handle',
};

const LIST_TYPES = new Set(['product_list', 'collection_list', 'metaobject_list']);

export function SettingInput({ setting, value, onChange, disabled }: SettingInputProps) {
  const label = setting.label ?? setting.id ?? '';
  const help = setting.info;

  // Headers and paragraphs are the theme author explaining the panel.
  if (SIDEBAR_TYPES.has(setting.type)) {
    return setting.type === 'header' ? (
      <Box paddingBlockStart="300">
        <Text as="h3" variant="headingSm">
          {setting.content ?? label}
        </Text>
      </Box>
    ) : (
      <Text as="p" tone="subdued" variant="bodySm">
        {setting.content ?? ''}
      </Text>
    );
  }

  if (setting.type === 'checkbox') {
    return (
      <Checkbox
        label={label}
        helpText={help}
        checked={value === true}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (setting.type === 'range') {
    /**
     * A real slider, with the schema's own bounds.
     *
     * The step matters as much as the range: the server refuses a value off the
     * step, so a control that could produce one would be an error a merchant
     * hits without understanding why.
     */
    const min = setting.min ?? 0;
    const max = setting.max ?? 100;
    const current = typeof value === 'number' ? value : min;

    return (
      <BlockStack gap="100">
        <RangeSlider
          label={label}
          helpText={help}
          min={min}
          max={max}
          step={setting.step ?? 1}
          value={current}
          onChange={(next) => onChange(typeof next === 'number' ? next : Number(next))}
          disabled={disabled}
          output
          suffix={
            <Text as="span" tone="subdued" variant="bodySm">
              {current}
              {setting.unit ?? ''}
            </Text>
          }
        />
      </BlockStack>
    );
  }

  if (setting.type === 'number') {
    return (
      <TextField
        label={label}
        helpText={help}
        type="number"
        value={value === null || value === undefined ? '' : String(value)}
        // Empty means "unset" rather than zero — a merchant clearing a field has
        // not asked for nothing, they have asked for the default.
        onChange={(next) => onChange(next === '' ? null : Number(next))}
        disabled={disabled}
        autoComplete="off"
      />
    );
  }

  if (setting.type === 'select' || setting.type === 'radio') {
    return (
      <Select
        label={label}
        helpText={help}
        options={(setting.options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (setting.type === 'text_alignment') {
    return (
      <Select
        label={label}
        helpText={help}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ]}
        value={String(value ?? 'left')}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (setting.type === 'color' || setting.type === 'color_background') {
    /**
     * A native colour input beside the hex value.
     *
     * Both, deliberately: the swatch is how a person picks, and the text is how
     * a brand guideline gets entered exactly. Either alone makes one of those
     * two jobs unnecessarily hard.
     */
    const current = typeof value === 'string' ? value : '';
    return (
      <BlockStack gap="100">
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : '#000000'}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            aria-label={`${label} colour`}
            style={{ width: 40, height: 34, padding: 0, border: '1px solid #c9cccf', borderRadius: 6 }}
          />
          <Box width="100%">
            <TextField
              label={label}
              labelHidden
              value={current}
              onChange={onChange}
              placeholder="#000000"
              disabled={disabled}
              autoComplete="off"
            />
          </Box>
        </InlineStack>
        {help ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {help}
          </Text>
        ) : null}
      </BlockStack>
    );
  }

  if (AREA_TYPES.has(setting.type)) {
    return (
      <TextField
        label={label}
        helpText={help}
        value={String(value ?? '')}
        onChange={onChange}
        multiline={setting.type === 'liquid' || setting.type === 'html' ? 6 : 4}
        disabled={disabled}
        autoComplete="off"
        placeholder={setting.placeholder}
        // A monospace field for code, because HTML and Liquid are read by
        // structure and a proportional font hides it.
        monospaced={setting.type === 'liquid' || setting.type === 'html'}
      />
    );
  }

  /**
   * A list of records the editor can search gets a real picker.
   *
   * `metaobject_list` stays a textarea below: there is nothing to search for
   * it yet, and a picker that could not find anything would be worse than the
   * field it replaced.
   */
  if (isPickableListType(setting.type)) {
    return (
      <ResourceListPicker
        type={setting.type}
        label={label}
        helpText={help}
        value={(Array.isArray(value) ? value : []).map(String)}
        onChange={onChange}
        disabled={disabled}
        limit={typeof setting.limit === 'number' ? setting.limit : undefined}
      />
    );
  }

  if (LIST_TYPES.has(setting.type)) {
    const entries = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <TextField
        label={label}
        helpText={help ?? 'One handle per line.'}
        value={entries.map(String).join('\n')}
        onChange={(next) =>
          onChange(
            next
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== ''),
          )
        }
        multiline={3}
        disabled={disabled}
        autoComplete="off"
      />
    );
  }

  /**
   * The types the editor can actually search get a real picker.
   *
   * The rest — an image, a video, a font — still take a value typed or pasted
   * in, because there is nothing to search yet. They keep the labelled field
   * and the badge that says what belongs there, which is honest about which
   * half of this is finished.
   */
  if (isPickableType(setting.type)) {
    return (
      <ResourcePicker
        type={setting.type}
        label={label}
        helpText={help}
        value={String(value ?? '')}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  const pickerLabel = PICKER_TYPES[setting.type];
  if (pickerLabel) {
    return (
      <BlockStack gap="100">
        <TextField
          label={label}
          helpText={help}
          value={String(value ?? '')}
          onChange={onChange}
          placeholder={pickerLabel}
          disabled={disabled}
          autoComplete="off"
        />
        <InlineStack gap="150">
          {/* Named honestly: nothing to search for these yet, so it stays a
              field with the expected value spelled out beside it. */}
          <Badge tone="info">{pickerLabel}</Badge>
        </InlineStack>
      </BlockStack>
    );
  }

  if (TEXT_TYPES.has(setting.type)) {
    return (
      <TextField
        label={label}
        helpText={help}
        value={String(value ?? '')}
        onChange={onChange}
        placeholder={setting.placeholder}
        disabled={disabled}
        autoComplete="off"
      />
    );
  }

  /**
   * A type we do not draw yet.
   *
   * A text box is wrong but usable; a blank space is a setting the merchant
   * cannot find at all. The type is shown so a support conversation has
   * something to name.
   */
  return (
    <BlockStack gap="100">
      <TextField
        label={label}
        helpText={help}
        value={typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}
        onChange={onChange}
        disabled={disabled}
        autoComplete="off"
      />
      <Text as="p" tone="subdued" variant="bodySm">
        This theme uses a <code>{setting.type}</code> setting, which this editor shows as plain
        text for now.
      </Text>
    </BlockStack>
  );
}

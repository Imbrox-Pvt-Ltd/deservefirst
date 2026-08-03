/**
 * Core · entity-toolkit/metafields.ts
 * Typed, namespaced custom fields with definitions and validation (§12.1, §12.4).
 * The critical property (§17.4): a merchant adding a metafield NEVER triggers a
 * schema migration — custom structure is *data*, which is what lets millions of
 * tenants define their own fields without touching DDL.
 * Layer: core.
 */

import type { Money, StoreId } from '@deservefirst/contracts';

export type MetafieldType =
  | 'single_line_text'
  | 'multi_line_text'
  | 'rich_text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'date_time'
  | 'money'
  | 'dimension'
  | 'volume'
  | 'weight'
  | 'rating'
  | 'url'
  | 'json'
  | 'file_reference'
  | 'metaobject_reference'
  | 'list.single_line_text'
  | 'list.metaobject_reference';

export interface MetafieldValidation {
  readonly min?: number;
  readonly max?: number;
  readonly regex?: string;
  readonly choices?: readonly string[];
  readonly maxLength?: number;
}

export interface MetafieldDefinition {
  readonly id: string;
  readonly storeId: StoreId;
  /** Which entity this attaches to — Product, Customer, Order, Page… */
  readonly ownerEntity: string;
  readonly namespace: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: MetafieldType;
  readonly validation: MetafieldValidation;
  /**
   * Category metafields are attached automatically by taxonomy category rather
   * than declared by the merchant — the reference product does this for
   * Color, Fabric, Sleeve length and so on.
   */
  readonly source: 'merchant' | 'category' | 'app';
  readonly categoryId: string | null;
  readonly translatable: boolean;
  readonly pinned: boolean;
}

export interface MetafieldValue {
  readonly definitionId: string;
  readonly ownerEntity: string;
  readonly ownerId: string;
  readonly storeId: StoreId;
  readonly namespace: string;
  readonly key: string;
  readonly type: MetafieldType;
  readonly value: unknown;
}

export class MetafieldValidationError extends Error {
  readonly status = 422;
  constructor(
    readonly namespace: string,
    readonly key: string,
    detail: string,
  ) {
    super(`Metafield ${namespace}.${key}: ${detail}`);
    this.name = 'MetafieldValidationError';
  }
}

/** `namespace.key` is the addressable name; both must be stable identifiers. */
export function metafieldKey(namespace: string, key: string): string {
  return `${namespace}.${key}`;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export function assertValidIdentifier(namespace: string, key: string): void {
  if (!IDENTIFIER.test(namespace)) {
    throw new MetafieldValidationError(namespace, key, 'namespace must be lower_snake_case');
  }
  if (!IDENTIFIER.test(key)) {
    throw new MetafieldValidationError(namespace, key, 'key must be lower_snake_case');
  }
}

/**
 * Validates a value against its definition. Runs on write for every metafield —
 * typed custom data is only worth having if the types are actually enforced.
 */
export function validateMetafieldValue(definition: MetafieldDefinition, value: unknown): void {
  const { namespace, key, type, validation } = definition;
  const fail = (detail: string) => {
    throw new MetafieldValidationError(namespace, key, detail);
  };

  if (value === null || value === undefined) return;

  switch (type) {
    case 'single_line_text':
    case 'multi_line_text':
    case 'rich_text':
    case 'url': {
      if (typeof value !== 'string') fail(`expected a string, got ${typeof value}`);
      const text = value as string;
      if (type === 'single_line_text' && text.includes('\n')) {
        fail('single-line text may not contain a newline');
      }
      if (validation.maxLength !== undefined && text.length > validation.maxLength) {
        fail(`is longer than the ${validation.maxLength}-character limit`);
      }
      if (validation.regex && !new RegExp(validation.regex).test(text)) {
        fail(`does not match the required pattern`);
      }
      if (validation.choices && !validation.choices.includes(text)) {
        fail(`must be one of: ${validation.choices.join(', ')}`);
      }
      if (type === 'url') {
        try {
          new URL(text);
        } catch {
          fail('is not a valid URL');
        }
      }
      break;
    }

    case 'integer':
    case 'decimal':
    case 'rating': {
      if (typeof value !== 'number' || Number.isNaN(value)) fail('expected a number');
      const numeric = value as number;
      if (type === 'integer' && !Number.isInteger(numeric)) fail('expected a whole number');
      if (validation.min !== undefined && numeric < validation.min) fail(`must be at least ${validation.min}`);
      if (validation.max !== undefined && numeric > validation.max) fail(`must be at most ${validation.max}`);
      break;
    }

    case 'boolean':
      if (typeof value !== 'boolean') fail('expected true or false');
      break;

    case 'date':
    case 'date_time': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) fail('is not a valid date');
      break;
    }

    case 'money': {
      const candidate = value as Partial<Money>;
      if (typeof candidate?.amountMinor !== 'bigint' || typeof candidate?.currency !== 'string') {
        fail('expected a Money value object of { amountMinor, currency }');
      }
      break;
    }

    case 'dimension':
    case 'volume':
    case 'weight': {
      const measured = value as { value?: unknown; unit?: unknown };
      if (typeof measured?.value !== 'number' || typeof measured?.unit !== 'string') {
        fail('expected { value, unit }');
      }
      break;
    }

    case 'file_reference':
    case 'metaobject_reference':
      if (typeof value !== 'string') fail('expected a reference id');
      break;

    case 'list.single_line_text':
    case 'list.metaobject_reference':
      if (!Array.isArray(value)) fail('expected a list');
      break;

    case 'json':
      // Anything JSON-serialisable is acceptable by definition.
      break;

    default:
      fail(`unknown metafield type "${type}"`);
  }
}

/**
 * Groups values by their owning record, which is how the detail screen renders
 * them and how the list engine attaches them to a page of rows.
 */
export function groupByOwner(values: readonly MetafieldValue[]): Map<string, MetafieldValue[]> {
  const grouped = new Map<string, MetafieldValue[]>();
  for (const value of values) {
    const list = grouped.get(value.ownerId) ?? [];
    list.push(value);
    grouped.set(value.ownerId, list);
  }
  return grouped;
}

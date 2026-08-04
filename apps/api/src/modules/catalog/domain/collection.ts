/**
 * Catalog · domain/collection.ts
 * The Collection aggregate. Membership is either manual or rule-driven, and the
 * rule engine supports exclusions — a captured detail that is easy to miss and
 * changes the semantics entirely: without it, "everything tagged sale except
 * clearance" is not expressible.
 * Layer: domain (pure).
 */

import type { Money } from '@deservefirst/contracts';

export type CollectionType = 'manual' | 'automated';

export type ConditionField =
  | 'title'
  | 'type'
  | 'vendor'
  | 'tag'
  | 'price'
  | 'compareAtPrice'
  | 'inventoryQuantity'
  | 'handle';

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan';

export interface Condition {
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  readonly value: string;
}

/** Whether a product must match every condition or any one of them. */
export type ConditionMatch = 'all' | 'any';

export interface Collection {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly type: CollectionType;
  readonly match: ConditionMatch;
  readonly conditions: readonly Condition[];
  /**
   * Conditions that REMOVE a product that would otherwise match. Ordering
   * matters: exclusions are applied after inclusion, so an excluded product
   * never appears however many inclusion rules it satisfies.
   */
  readonly exclusions: readonly Condition[];
  /** Explicit members, for manual collections. */
  readonly productIds: readonly string[];
  readonly sortOrder: 'manual' | 'best-selling' | 'title-asc' | 'title-desc' | 'price-asc' | 'price-desc' | 'created-desc';
  readonly version: number;
}

export class CollectionInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`Collection ${field}: ${detail}`);
    this.name = 'CollectionInvariantError';
  }
}

export const MAX_CONDITIONS = 60;

export function assertCollectionValid(collection: Collection): void {
  if (collection.title.trim().length === 0) {
    throw new CollectionInvariantError('title', 'is required');
  }

  if (collection.type === 'automated') {
    if (collection.conditions.length === 0) {
      throw new CollectionInvariantError('conditions', 'an automated collection needs at least one condition');
    }
    if (collection.productIds.length > 0) {
      throw new CollectionInvariantError(
        'productIds',
        'an automated collection cannot also have manual members — membership would have two sources of truth',
      );
    }
  }

  if (collection.type === 'manual' && collection.conditions.length > 0) {
    throw new CollectionInvariantError('conditions', 'a manual collection cannot have conditions');
  }

  const total = collection.conditions.length + collection.exclusions.length;
  if (total > MAX_CONDITIONS) {
    throw new CollectionInvariantError('conditions', `at most ${MAX_CONDITIONS} rules in total`);
  }

  for (const condition of [...collection.conditions, ...collection.exclusions]) {
    assertConditionValid(condition);
  }
}

const NUMERIC_FIELDS = new Set<ConditionField>(['price', 'compareAtPrice', 'inventoryQuantity']);
const NUMERIC_ONLY_OPERATORS = new Set<ConditionOperator>(['greaterThan', 'lessThan']);

function assertConditionValid(condition: Condition): void {
  if (condition.value.trim().length === 0) {
    throw new CollectionInvariantError('conditions', `"${condition.field}" needs a value`);
  }

  if (NUMERIC_ONLY_OPERATORS.has(condition.operator) && !NUMERIC_FIELDS.has(condition.field)) {
    throw new CollectionInvariantError(
      'conditions',
      `"${condition.operator}" only applies to numeric fields, not "${condition.field}"`,
    );
  }

  if (NUMERIC_FIELDS.has(condition.field) && Number.isNaN(Number(condition.value))) {
    throw new CollectionInvariantError('conditions', `"${condition.field}" needs a number`);
  }
}

/** The product shape the rule engine evaluates against. */
export interface EvaluableProduct {
  readonly title: string;
  readonly handle: string;
  readonly productType: string | null;
  readonly vendor: string | null;
  readonly tags: readonly string[];
  readonly price: Money;
  readonly compareAtPrice: Money | null;
  readonly inventoryQuantity: number;
}

function valueFor(product: EvaluableProduct, field: ConditionField): string | number | readonly string[] {
  switch (field) {
    case 'title': return product.title;
    case 'handle': return product.handle;
    case 'type': return product.productType ?? '';
    case 'vendor': return product.vendor ?? '';
    case 'tag': return product.tags;
    // Money compares on its exact minor units, never on a formatted string.
    case 'price': return Number(product.price.amountMinor);
    case 'compareAtPrice': return product.compareAtPrice ? Number(product.compareAtPrice.amountMinor) : 0;
    case 'inventoryQuantity': return product.inventoryQuantity;
  }
}

/**
 * `Array.isArray` does not narrow `readonly T[]` out of a union, so the check
 * needs an explicit predicate for the compiler to follow.
 */
function isTagList(value: string | number | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

export function matchesCondition(product: EvaluableProduct, condition: Condition): boolean {
  const actual = valueFor(product, condition.field);

  // Tags are a set: "contains" means the set holds it, not that some
  // concatenation of tags contains the substring.
  if (isTagList(actual)) {
    const tags = actual.map((tag) => tag.toLowerCase());
    const needle = condition.value.toLowerCase();
    switch (condition.operator) {
      case 'equals':
      case 'contains':
        return tags.includes(needle);
      case 'notEquals':
      case 'notContains':
        return !tags.includes(needle);
      default:
        return false;
    }
  }

  if (typeof actual === 'number') {
    const expected = Number(condition.value);
    switch (condition.operator) {
      case 'equals': return actual === expected;
      case 'notEquals': return actual !== expected;
      case 'greaterThan': return actual > expected;
      case 'lessThan': return actual < expected;
      default: return false;
    }
  }

  const haystack = actual.toLowerCase();
  const needle = condition.value.toLowerCase();
  switch (condition.operator) {
    case 'equals': return haystack === needle;
    case 'notEquals': return haystack !== needle;
    case 'contains': return haystack.includes(needle);
    case 'notContains': return !haystack.includes(needle);
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    default: return false;
  }
}

/**
 * Whether a product belongs to a collection. Exclusions are checked last and
 * always win — a product matching both an inclusion and an exclusion is out.
 */
export function isMember(collection: Collection, product: EvaluableProduct, productId: string): boolean {
  if (collection.type === 'manual') {
    return collection.productIds.includes(productId);
  }

  const matches = collection.conditions.map((condition) => matchesCondition(product, condition));
  const included = collection.match === 'all' ? matches.every(Boolean) : matches.some(Boolean);
  if (!included) return false;

  // Any single exclusion removes the product, regardless of the match mode —
  // "any" applies to inclusion, not to whether an exclusion counts.
  return !collection.exclusions.some((condition) => matchesCondition(product, condition));
}

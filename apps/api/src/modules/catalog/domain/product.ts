/**
 * Catalog · domain/product.ts
 * The Product aggregate root and its invariants. Pure business rules — no I/O,
 * no framework, no transport. Variants, media and options are loaded, saved and
 * authorised through this root; nothing reaches into them directly (§14.3).
 * Layer: domain (pure).
 */

import type { Money } from '@deservefirst/contracts';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface ProductVariant {
  readonly id: string;
  readonly sku: string | null;
  readonly optionValues: Readonly<Record<string, string>>;
  readonly price: Money;
  readonly inventoryQuantity: number;
}

export interface Product {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly status: ProductStatus;
  readonly vendor: string | null;
  readonly productType: string | null;
  readonly price: Money;
  readonly compareAtPrice: Money | null;
  readonly costPerItem: Money | null;
  readonly variants: readonly ProductVariant[];
  readonly optionNames: readonly string[];
  readonly publishedChannels: readonly string[];
  readonly version: number;
}

export class ProductInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`Product ${field}: ${detail}`);
    this.name = 'ProductInvariantError';
  }
}

export const TITLE_MAX_LENGTH = 255;
export const MAX_OPTIONS = 3;

/**
 * Rules that must hold for any product, at any point. Checked on every write
 * rather than only on create — an update can break an invariant just as easily.
 */
export function assertProductValid(product: Product): void {
  if (product.title.trim().length === 0) {
    throw new ProductInvariantError('title', 'is required');
  }
  if (product.title.length > TITLE_MAX_LENGTH) {
    throw new ProductInvariantError('title', `must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  if (product.handle.trim().length === 0) {
    throw new ProductInvariantError('handle', 'is required');
  }
  if (product.price.amountMinor < 0n) {
    throw new ProductInvariantError('price', 'cannot be negative');
  }
  if (product.compareAtPrice && product.compareAtPrice.currency !== product.price.currency) {
    throw new ProductInvariantError('compareAtPrice', 'must use the same currency as price');
  }
  if (product.optionNames.length > MAX_OPTIONS) {
    throw new ProductInvariantError('options', `a product may have at most ${MAX_OPTIONS} options`);
  }

  assertVariantsConsistent(product);
}

/**
 * Every variant must supply exactly the declared options, and no two variants
 * may share the same combination — otherwise a buyer's selection is ambiguous
 * and inventory silently splits across duplicates.
 */
function assertVariantsConsistent(product: Product): void {
  const declared = new Set(product.optionNames);
  const seen = new Set<string>();

  for (const variant of product.variants) {
    const supplied = Object.keys(variant.optionValues);

    if (supplied.length !== declared.size || supplied.some((name) => !declared.has(name))) {
      throw new ProductInvariantError(
        'variants',
        `variant ${variant.id} must supply exactly the declared options (${[...declared].join(', ') || 'none'})`,
      );
    }

    const signature = product.optionNames.map((name) => variant.optionValues[name]).join(' / ');
    if (seen.has(signature)) {
      throw new ProductInvariantError('variants', `duplicate option combination "${signature}"`);
    }
    seen.add(signature);

    if (variant.price.currency !== product.price.currency) {
      throw new ProductInvariantError('variants', `variant ${variant.id} uses a different currency`);
    }
  }
}

/**
 * Publishing is a state transition with rules, not an enum write (§36.2). A
 * draft with no price or an archived product cannot go live by accident.
 */
export function canPublish(product: Product): { ok: true } | { ok: false; reason: string } {
  if (product.status === 'archived') {
    return { ok: false, reason: 'Archived products must be unarchived before publishing.' };
  }
  if (product.title.trim().length === 0) {
    return { ok: false, reason: 'A product needs a title before it can be published.' };
  }
  if (product.price.amountMinor === 0n && product.variants.length === 0) {
    return { ok: false, reason: 'Set a price, or add variants with prices, before publishing.' };
  }
  return { ok: true };
}

const ALLOWED_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  draft: ['active', 'archived'],
  active: ['draft', 'archived'],
  archived: ['draft'],
};

export function assertTransitionAllowed(from: ProductStatus, to: ProductStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ProductInvariantError('status', `cannot move from ${from} to ${to}`);
  }
}

/** Total inventory across variants, or the product's own count when simple. */
export function totalInventory(product: Product): number {
  if (product.variants.length === 0) return 0;
  return product.variants.reduce((sum, variant) => sum + variant.inventoryQuantity, 0);
}

/**
 * Margin from cost and price, in basis points to avoid floating-point drift.
 * Returns null when cost is unknown — an unknown margin is not a zero margin.
 */
export function marginBasisPoints(product: Product): number | null {
  if (!product.costPerItem || product.price.amountMinor === 0n) return null;
  const profit = product.price.amountMinor - product.costPerItem.amountMinor;
  return Number((profit * 10_000n) / product.price.amountMinor);
}

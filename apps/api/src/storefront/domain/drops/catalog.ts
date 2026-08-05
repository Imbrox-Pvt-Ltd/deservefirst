/**
 * Storefront · domain/drops/catalog.ts
 * What a theme may see of a product, a variant, an image and a collection.
 *
 * Read the omissions as carefully as the inclusions. `costPerItem` is what the
 * merchant paid, `internalNotes` is what staff wrote about the product, and
 * neither appears below — a theme that could read them would put a margin, or a
 * note about a customer dispute, one `{{ }}` away from a public page. Both are
 * marked non-public in the catalog resource, and the audit checks this file
 * against that rather than trusting the comment.
 *
 * Prices are exposed as integer minor units, matching §15.2 and the `money`
 * filter's input. A drop that pre-formatted them would put currency rendering
 * in two places and let a theme bypass the merchant's chosen format.
 * Layer: domain (pure).
 */

import { defineDrop, dropList, type DropContext } from './define';

/**
 * The rows these drops read from.
 *
 * Structural rather than imported from the catalog module: `domain` may not
 * depend on another module's contracts (§14.1), and a drop is a projection of a
 * shape rather than of a class. The composition root passes the real rows.
 */
export interface ProductRow {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description?: string | null;
  readonly status?: string;
  readonly vendor?: string | null;
  readonly productType?: string | null;
  readonly sku?: string | null;
  readonly priceAmountMinor?: string | number | null;
  readonly compareAtPriceAmountMinor?: string | number | null;
  readonly inventoryQuantity?: number | null;
  readonly optionNames?: readonly string[] | null;
  readonly tags?: readonly string[] | null;
  readonly createdAt?: string | Date | null;
  readonly updatedAt?: string | Date | null;
  readonly publishedAt?: string | Date | null;
}

export interface VariantRow {
  readonly id: string;
  readonly productId: string;
  readonly title?: string | null;
  readonly sku?: string | null;
  readonly priceAmountMinor?: string | number | null;
  readonly compareAtPriceAmountMinor?: string | number | null;
  readonly optionValues?: readonly string[] | null;
  readonly inventoryQuantity?: number | null;
  readonly weightGrams?: number | null;
  readonly barcode?: string | null;
  readonly imageId?: string | null;
}

export interface ImageRow {
  readonly id: string;
  readonly src: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly alt?: string | null;
  readonly position?: number | null;
}

export interface CollectionRow {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description?: string | null;
  readonly imageId?: string | null;
  readonly updatedAt?: string | Date | null;
}

/**
 * Awaits a loader result that may already be an array.
 *
 * Loaders are synchronous by signature because a drop is read while a template
 * renders — but a SQL-backed one returns a promise, and a drop that called
 * `.find()` on it crashed with "variants.find is not a function". Rendering a
 * VALUE through a promise works, because the engine awaits it; computing over
 * one does not.
 *
 * So every property that reduces a relation is async, and the engine awaits the
 * property instead. Laziness is unaffected — nothing loads until the property is
 * read. The drop unit tests used synchronous loaders throughout, which is
 * exactly why none of them caught this.
 */
async function resolved<T>(
  value: readonly T[] | Promise<readonly T[]> | undefined,
): Promise<readonly T[]> {
  return (await value) ?? [];
}

/** Minor units as a number, which is what the money filters take. */
function minorUnits(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** A date a theme can pipe through `date`, in a form that filter accepts. */
function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const imageDrop = defineDrop<ImageRow>('image', {
  id: (image) => image.id,
  src: (image) => image.src,
  width: (image) => image.width ?? null,
  height: (image) => image.height ?? null,
  /**
   * `alt` defaults to empty rather than the filename.
   *
   * An empty alt tells a screen reader to skip a decorative image; a filename
   * makes it read "IMG 4471 dot jpg" aloud, which is worse than silence.
   */
  alt: (image) => image.alt ?? '',
  position: (image) => image.position ?? 1,
  /** Themes divide by this to reserve space before the image loads. */
  aspect_ratio: (image) =>
    image.width && image.height ? Number((image.width / image.height).toFixed(4)) : null,
});

export const variantDrop = defineDrop<VariantRow>('variant', {
  id: (variant) => variant.id,
  product_id: (variant) => variant.productId,
  title: (variant) => variant.title ?? '',
  sku: (variant) => variant.sku ?? '',
  barcode: (variant) => variant.barcode ?? '',
  price: (variant) => minorUnits(variant.priceAmountMinor),
  compare_at_price: (variant) => minorUnits(variant.compareAtPriceAmountMinor),
  /** The chosen values in the product's option order — `["S", "Red"]`. */
  options: (variant) => variant.optionValues ?? [],
  option1: (variant) => variant.optionValues?.[0] ?? null,
  option2: (variant) => variant.optionValues?.[1] ?? null,
  option3: (variant) => variant.optionValues?.[2] ?? null,
  /**
   * Availability is derived rather than stored.
   *
   * A theme asking "can I buy this" should not have to know the stock policy,
   * and putting the rule here means one answer instead of one per theme.
   */
  available: (variant) => (variant.inventoryQuantity ?? 0) > 0,
  inventory_quantity: (variant) => variant.inventoryQuantity ?? 0,
  weight: (variant) => variant.weightGrams ?? 0,
  weight_unit: () => 'g',
  featured_image: async (variant, context) => {
    if (!variant.imageId) return null;
    const load = context.load.image as ((id: string) => ImageRow | null) | undefined;
    const image = await load?.(variant.imageId);
    return image ? imageDrop(image, context) : null;
  },
  url: (variant) => `/variants/${variant.id}`,
});

export const productDrop = defineDrop<ProductRow>('product', {
  id: (product) => product.id,
  handle: (product) => product.handle,
  title: (product) => product.title,
  description: (product) => product.description ?? '',
  /** The reference product exposes the same text under both names. */
  content: (product) => product.description ?? '',
  vendor: (product) => product.vendor ?? '',
  type: (product) => product.productType ?? '',
  tags: (product) => product.tags ?? [],

  price: (product) => minorUnits(product.priceAmountMinor),
  compare_at_price: (product) => minorUnits(product.compareAtPriceAmountMinor),
  /**
   * `price_min` and `price_max` come from the variants, so reading either loads
   * them — which is exactly the laziness the getter design is for. A collection
   * page that only renders `product.price` never touches variant rows.
   */
  price_min: async (product, context) => {
    const prices = await variantPrices(product, context);
    return prices.length ? Math.min(...prices) : minorUnits(product.priceAmountMinor);
  },
  price_max: async (product, context) => {
    const prices = await variantPrices(product, context);
    return prices.length ? Math.max(...prices) : minorUnits(product.priceAmountMinor);
  },
  price_varies: async (product, context) => {
    const prices = await variantPrices(product, context);
    return prices.length > 1 && Math.min(...prices) !== Math.max(...prices);
  },

  available: (product) => (product.inventoryQuantity ?? 0) > 0,
  options: (product) => product.optionNames ?? [],
  options_with_values: async (product, context) => optionsWithValues(product, context),

  variants: async (product, context) => {
    return dropList(variantDrop, await variantsOf(product, context), context);
  },
  first_available_variant: async (product, context) => {
    const first = (await variantsOf(product, context)).find(
      (variant) => (variant.inventoryQuantity ?? 0) > 0,
    );
    return first ? variantDrop(first, context) : null;
  },
  selected_or_first_available_variant: async (product, context) => {
    const variants = await variantsOf(product, context);
    const chosen = variants.find((variant) => (variant.inventoryQuantity ?? 0) > 0) ?? variants[0];
    return chosen ? variantDrop(chosen, context) : null;
  },

  images: async (product, context) => {
    const load = context.load.imagesOfProduct as ((id: string) => readonly ImageRow[]) | undefined;
    return dropList(imageDrop, await resolved(load?.(product.id)), context);
  },
  featured_image: async (product, context) => {
    const load = context.load.imagesOfProduct as ((id: string) => readonly ImageRow[]) | undefined;
    const first = (await resolved(load?.(product.id)))[0];
    return first ? imageDrop(first, context) : null;
  },

  url: (product) => `/products/${product.handle}`,
  created_at: (product) => isoOrNull(product.createdAt),
  updated_at: (product) => isoOrNull(product.updatedAt),
  published_at: (product) => isoOrNull(product.publishedAt),
});

export const collectionDrop = defineDrop<CollectionRow>('collection', {
  id: (collection) => collection.id,
  handle: (collection) => collection.handle,
  title: (collection) => collection.title,
  description: (collection) => collection.description ?? '',
  url: (collection) => `/collections/${collection.handle}`,
  updated_at: (collection) => isoOrNull(collection.updatedAt),

  image: async (collection, context) => {
    if (!collection.imageId) return null;
    const load = context.load.image as ((id: string) => ImageRow | null) | undefined;
    const image = await load?.(collection.imageId);
    return image ? imageDrop(image, context) : null;
  },

  products: async (collection, context) => {
    const load = context.load.productsOfCollection as
      | ((id: string) => readonly ProductRow[])
      | undefined;
    return dropList(productDrop, await resolved(load?.(collection.id)), context);
  },
  /**
   * The full count, not the page's length.
   *
   * Themes render "24 products" beside a paginated grid of twelve, so this has
   * to come from a count rather than from the array a page happens to hold.
   */
  products_count: (collection, context) => {
    const count = context.load.productCountOfCollection as
      | ((id: string) => number)
      | undefined;
    return count?.(collection.id) ?? 0;
  },
  all_types: (collection, context) =>
    (context.load.productTypesOfCollection as ((id: string) => readonly string[]) | undefined)?.(
      collection.id,
    ) ?? [],
  all_vendors: (collection, context) =>
    (context.load.productVendorsOfCollection as ((id: string) => readonly string[]) | undefined)?.(
      collection.id,
    ) ?? [],
});

async function variantPrices(product: ProductRow, context: DropContext): Promise<number[]> {
  const load = context.load.variantsOfProduct as ((id: string) => readonly VariantRow[]) | undefined;
  return (await resolved(load?.(product.id)))
    .map((variant) => minorUnits(variant.priceAmountMinor))
    .filter((price): price is number => price !== null);
}

/**
 * Option names paired with the values the variants actually use.
 *
 * Built from the variants rather than stored, so an option value that no
 * variant has cannot appear as a selectable choice — which is the difference
 * between a size picker that works and one with a dead button on it.
 */
async function optionsWithValues(product: ProductRow, context: DropContext): Promise<unknown[]> {
  const load = context.load.variantsOfProduct as ((id: string) => readonly VariantRow[]) | undefined;
  const variants = await resolved(load?.(product.id));
  const names = product.optionNames ?? [];

  return names.map((name, position) => {
    const values = new Set<string>();
    for (const variant of variants) {
      const value = variant.optionValues?.[position];
      if (value) values.add(value);
    }
    return { name, position: position + 1, values: [...values] };
  });
}

/**
 * A product's variants, with a default one when it has none.
 *
 * Every product in the reference product HAS a variant — a single unnamed one
 * for a product nobody has given options to — and themes are written knowing
 * that. The reference theme prints its price through
 * `product.selected_or_first_available_variant.price`, so a product with no
 * variant rows rendered a page with no price at all: not an error, not a zero,
 * just nothing where the price belongs. It took comparing the page against the
 * database to see it.
 *
 * Our catalogue lets a product exist without variant rows, and that is a
 * reasonable model — a shirt with no options does not need a row to say so. So
 * the shape a theme expects is supplied here rather than by requiring every
 * product to carry a row it does not need. The synthetic variant is the
 * product: same price, same stock, same id, which is what makes it behave
 * correctly when a theme puts it in a form or compares it to `product.id`.
 */
async function variantsOf(
  product: ProductRow,
  context: DropContext,
): Promise<readonly VariantRow[]> {
  const load = context.load.variantsOfProduct as ((id: string) => readonly VariantRow[]) | undefined;
  const rows = await resolved(load?.(product.id));
  if (rows.length > 0) return rows;

  return [
    {
      id: product.id,
      productId: product.id,
      // Named as the reference product names it, because themes compare against
      // exactly this string to decide whether to show a variant picker.
      title: 'Default Title',
      sku: product.sku ?? null,
      priceAmountMinor: product.priceAmountMinor ?? null,
      compareAtPriceAmountMinor: product.compareAtPriceAmountMinor ?? null,
      optionValues: ['Default Title'],
      inventoryQuantity: product.inventoryQuantity ?? null,
      barcode: null,
      imageId: null,
    },
  ];
}

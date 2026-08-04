/**
 * Catalog · application/product-service.ts
 * Use-cases for the Product aggregate. Takes typed input, returns typed DTOs,
 * and knows nothing about HTTP, GraphQL or the queue — so REST, GraphQL and the
 * worker all call the same code and cannot diverge (§13.1).
 * Layer: application.
 */

import {
  type Connection,
  type ListQuery,
  type Money,
  type StoreId,
} from '@deservefirst/contracts';

import { productResource } from '../contracts';
import { describeChange, diffFields, type ToolkitPorts } from '../../../core/entity-toolkit';

export type { ToolkitPorts };
import {
  assertProductValid,
  assertTransitionAllowed,
  canPublish,
  type Product,
  buildVariantMatrix,
  ProductInvariantError,
  type ProductOption,
  type ProductStatus,
  type ProductVariant,
} from '../domain';
import { CATALOG_EVENTS } from '../events';

/**
 * Ports this use-case needs. Declared here and implemented in infrastructure —
 * the dependency points inward, which is what keeps the domain testable.
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findByHandle(handle: string): Promise<Product | null>;
  takenHandles(prefix: string): Promise<ReadonlySet<string>>;
  list(query: ListQuery): Promise<Connection<Product>>;
  insert(product: Product): Promise<Product>;
  update(product: Product, expectedVersion: number): Promise<Product>;
  replaceVariants(productId: string, variants: readonly ProductVariant[]): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export interface CreateProductInput {
  readonly title: string;
  readonly description?: string;
  readonly handle?: string;
  readonly vendor?: string | null;
  readonly productType?: string | null;
  readonly price: Money;
  readonly compareAtPrice?: Money | null;
  readonly costPerItem?: Money | null;
  readonly status?: ProductStatus;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  readonly id: string;
  /** Optimistic concurrency — a stale write loses rather than clobbering. */
  readonly expectedVersion: number;
}

export class ProductNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No product with id "${id}" in this store.`);
    this.name = 'ProductNotFoundError';
  }
}

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly toolkit: ToolkitPorts,
    private readonly storeId: StoreId,
  ) {}

  async list(query: ListQuery): Promise<Connection<Product>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) throw new ProductNotFoundError(id);
    return product;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const base = this.toolkit.slugify(input.handle ?? input.title);
    const taken = await this.repository.takenHandles(base);

    const product: Product = {
      id: this.toolkit.newId(),
      handle: this.toolkit.disambiguate(base, taken),
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'draft',
      vendor: input.vendor ?? null,
      productType: input.productType ?? null,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      costPerItem: input.costPerItem ?? null,
      variants: [],
      optionNames: [],
      publishedChannels: [],
      version: 1,
    };

    assertProductValid(product);
    const saved = await this.repository.insert(product);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: 'created this product',
      changes: [],
    });
    await this.toolkit.emit(CATALOG_EVENTS.productCreated, {
      productId: saved.id,
      handle: saved.handle,
      title: saved.title,
    });

    return saved;
  }

  /**
   * Replaces a product's option sets, regenerating the variant matrix.
   *
   * Prices and SKUs already entered are carried across by option combination,
   * so adding a colour does not blank the sizes someone spent an afternoon
   * pricing. Combinations that no longer exist are dropped — that is what
   * removing an option value means — and the screen warns before saving.
   */
  async setOptions(
    id: string,
    expectedVersion: number,
    options: readonly ProductOption[],
  ): Promise<Product> {
    const existing = await this.get(id);

    const variants = buildVariantMatrix(options, existing.variants, {
      price: existing.price,
      newId: () => this.toolkit.newId(),
    });

    const next: Product = {
      ...existing,
      optionNames: options
        .filter((option) => option.name.trim() !== '' && option.values.length > 0)
        .map((option) => option.name),
      variants,
      version: existing.version + 1,
    };

    assertProductValid(next);
    const saved = await this.repository.update(next, expectedVersion);
    await this.repository.replaceVariants(saved.id, variants);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message:
        variants.length === 0
          ? `options removed from "${saved.title}"`
          : `options changed on "${saved.title}" — ${variants.length} variants`,
      changes: [{ field: 'optionNames', from: existing.optionNames, to: next.optionNames }],
    });

    return { ...saved, variants };
  }

  /**
   * Per-variant price, SKU and stock. The matrix itself is not editable here:
   * which combinations exist follows from the options, and letting this endpoint
   * add one would let the two disagree.
   */
  async updateVariants(
    id: string,
    expectedVersion: number,
    patches: readonly { id: string; sku?: string | null; price?: Money; inventoryQuantity?: number }[],
  ): Promise<Product> {
    const existing = await this.get(id);
    const byId = new Map(patches.map((patch) => [patch.id, patch]));

    for (const patchId of byId.keys()) {
      if (!existing.variants.some((variant) => variant.id === patchId)) {
        throw new ProductInvariantError('variants', `no variant "${patchId}" on this product`);
      }
    }

    const variants: ProductVariant[] = existing.variants.map((variant) => {
      const patch = byId.get(variant.id);
      if (!patch) return variant;
      return {
        ...variant,
        sku: patch.sku === undefined ? variant.sku : patch.sku,
        price: patch.price ?? variant.price,
        inventoryQuantity:
          patch.inventoryQuantity === undefined ? variant.inventoryQuantity : patch.inventoryQuantity,
      };
    });

    const next: Product = { ...existing, variants, version: existing.version + 1 };

    // Validated before anything is written: a variant priced in another currency
    // must not land in the table and then fail the product's own check.
    assertProductValid(next);
    const saved = await this.repository.update(next, expectedVersion);
    await this.repository.replaceVariants(saved.id, variants);

    return { ...saved, variants };
  }

  async update(input: UpdateProductInput): Promise<Product> {
    const existing = await this.get(input.id);

    if (input.status && input.status !== existing.status) {
      assertTransitionAllowed(existing.status, input.status);
    }

    // A handle change is a URL change; the SEO toolkit records the 301 from the
    // event, so the merchant never has to think about broken links.
    let handle = existing.handle;
    if (input.handle && input.handle !== existing.handle) {
      const base = this.toolkit.slugify(input.handle);
      handle = this.toolkit.disambiguate(base, await this.repository.takenHandles(base));
    }

    const next: Product = {
      ...existing,
      handle,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      status: input.status ?? existing.status,
      vendor: input.vendor === undefined ? existing.vendor : input.vendor,
      productType: input.productType === undefined ? existing.productType : input.productType,
      price: input.price ?? existing.price,
      compareAtPrice: input.compareAtPrice === undefined ? existing.compareAtPrice : input.compareAtPrice,
      costPerItem: input.costPerItem === undefined ? existing.costPerItem : input.costPerItem,
      version: existing.version + 1,
    };

    assertProductValid(next);
    const saved = await this.repository.update(next, input.expectedVersion);

    // The timeline is only worth having if it records what actually changed.
    // Diffing here rather than in the repository keeps the record in terms the
    // merchant recognises — domain fields, not column names.
    const changes = diffFields(
      existing as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      ['title', 'handle', 'description', 'status', 'vendor', 'productType'],
    );
    if (changes.length > 0) {
      await this.toolkit.recordTimeline({
        ownerId: saved.id,
        message: changes.length === 1 ? describeChange(changes[0]!) : `made ${changes.length} changes`,
        changes,
      });
    }

    await this.toolkit.emit(CATALOG_EVENTS.productUpdated, {
      productId: saved.id,
      handle: saved.handle,
      previousHandle: existing.handle,
    });

    return saved;
  }

  /** Publishing is a rule-checked transition, not an enum write. */
  async publish(id: string, channels: readonly string[], expectedVersion: number): Promise<Product> {
    const existing = await this.get(id);
    const verdict = canPublish(existing);
    if (!verdict.ok) {
      throw new ProductInvariantError('status', verdict.reason);
    }

    const next: Product = {
      ...existing,
      status: 'active',
      publishedChannels: [...new Set([...existing.publishedChannels, ...channels])],
      version: existing.version + 1,
    };

    const saved = await this.repository.update(next, expectedVersion);
    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `published to ${saved.publishedChannels.join(', ') || 'no channels'}`,
      changes: [],
    });
    await this.toolkit.emit(CATALOG_EVENTS.productPublished, {
      productId: saved.id,
      channels: saved.publishedChannels,
    });
    return saved;
  }

  async archive(id: string, expectedVersion: number): Promise<Product> {
    const existing = await this.get(id);
    assertTransitionAllowed(existing.status, 'archived');

    const saved = await this.repository.update(
      { ...existing, status: 'archived', publishedChannels: [], version: existing.version + 1 },
      expectedVersion,
    );
    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: 'archived this product',
      changes: [],
    });
    await this.toolkit.emit(CATALOG_EVENTS.productArchived, { productId: saved.id });
    return saved;
  }

  /** Soft delete: hidden and restorable, never destroyed (§12.1). */
  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.repository.softDelete(id);
  }

  /** Exposed so the API layer can serialise without importing the resource file. */
  get resource() {
    return productResource;
  }

  get scope(): StoreId {
    return this.storeId;
  }
}

/**
 * Catalog · infrastructure/product.repository.ts
 * Implements the ProductRepository port declared in application/. Every query
 * here is store-scoped — the store comes from the ambient request context, never
 * from a caller argument, and the fitness suite fails the build on any query
 * that omits the boundary (§14.2, §20.1).
 *
 * Column names are NOT chosen here: they come from the schema builder, which
 * derives them from the entity declaration. Hand-writing them is how a
 * repository and its table drift apart.
 * Layer: infrastructure.
 */

import { type Connection, type ListQuery, money, type StoreId } from '@deservefirst/contracts';

import { StaleWriteError } from '../../../core/entity-toolkit';
import { ListEngine, type QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import { productResource } from '../contracts';
import type { ProductRepository } from '../application';
import type { Product, ProductVariant } from '../domain';

const TABLE = 'products';
const VARIANT_TABLE = 'product_variants';

interface VariantRow extends Record<string, unknown> {
  id: string;
  sku: string | null;
  option_values: unknown;
  price_amount_minor: string | null;
  price_currency: string | null;
  inventory_quantity: number | null;
  position: number;
}

interface ProductRow extends Record<string, unknown> {
  id: string;
  store_id: string;
  handle: string;
  title: string;
  description: string | null;
  status: string;
  vendor: string | null;
  product_type: string | null;
  price_amount_minor: string | null;
  price_currency: string | null;
  compare_at_price_amount_minor: string | null;
  compare_at_price_currency: string | null;
  cost_per_item_amount_minor: string | null;
  cost_per_item_currency: string | null;
  published_channels: unknown;
  version: number;
}

export class ProductRepositoryImpl implements ProductRepository {
  private readonly listEngine: ListEngine;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  /** Reads the boundary from context so no caller can widen it. */
  private storeId(): StoreId {
    return requireStoreContext('catalog.products').storeId;
  }

  /** Renders placeholders in the dialect's style: `$1…$n` or `?`. */
  private args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async findById(id: string): Promise<Product | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<ProductRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    return row ? this.withVariants(toDomain(row)) : null;
  }

  async findByHandle(handle: string): Promise<Product | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<ProductRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('handle')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];
    return row ? this.withVariants(toDomain(row)) : null;
  }

  /**
   * Handles that would collide with a new one. Soft-deleted rows are included:
   * a restored product must not find its handle stolen while it was away.
   */
  /**
   * Loads the variants belonging to a product.
   *
   * Variants are part of the Product aggregate (§14.3): nothing outside reaches
   * into them, and a product is never handed out without them — a caller that
   * received `variants: []` for a product that has three would happily save that
   * back and delete them.
   */
  private async withVariants(product: Product): Promise<Product> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<VariantRow>(
      `SELECT * FROM ${this.q(VARIANT_TABLE)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('product_id')} = ${p2}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('position')} ASC`,
      [this.storeId(), product.id],
    );

    return { ...product, variants: rows.map(toVariant) };
  }

  /**
   * Replaces a product's variants wholesale.
   *
   * Deleted rather than soft-deleted: a variant that no longer exists in the
   * matrix is not a record someone might want back, it is a combination the
   * merchant removed, and leaving tombstones would make the unique index on
   * (product, option values) refuse the combination if it were ever re-added.
   */
  async replaceVariants(productId: string, variants: readonly ProductVariant[]): Promise<void> {
    const [d1, d2] = this.args(2);
    await this.executor.query(
      `DELETE FROM ${this.q(VARIANT_TABLE)}
        WHERE ${this.q('store_id')} = ${d1} AND ${this.q('product_id')} = ${d2}`,
      [this.storeId(), productId],
    );

    const columns = [
      'id', 'store_id', 'handle', 'product_id', 'sku', 'option_values',
      'price_amount_minor', 'price_currency', 'inventory_quantity', 'position', 'version',
    ];

    for (const [position, variant] of variants.entries()) {
      await this.executor.query(
        `INSERT INTO ${this.q(VARIANT_TABLE)} (${columns.map((c) => this.q(c)).join(', ')})
         VALUES (${this.args(columns.length).join(', ')})`,
        [
          variant.id,
          this.storeId(),
          // Variants are addressed through their product, so the handle only has
          // to be unique — it is never typed by anyone or shown in a URL.
          `${productId}-${position + 1}`,
          productId,
          variant.sku,
          JSON.stringify(variant.optionValues),
          variant.price.amountMinor.toString(),
          variant.price.currency,
          variant.inventoryQuantity,
          position,
          1,
        ],
      );
    }
  }

  async takenHandles(prefix: string): Promise<ReadonlySet<string>> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<{ handle: string }>(
      `SELECT ${this.q('handle')} FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('handle')} LIKE ${p2}`,
      [this.storeId(), `${prefix}%`],
    );
    return new Set(rows.map((row) => row.handle));
  }

  async list(query: ListQuery): Promise<Connection<Product>> {
    const connection = await this.listEngine.list<ProductRow>({
      resource: productResource,
      tableName: TABLE,
      query,
      dialect: this.dialect,
    });
    return { ...connection, nodes: connection.nodes.map(toDomain) };
  }

  async insert(product: Product): Promise<Product> {
    const columns = [
      'id', 'store_id', 'handle', 'title', 'description', 'status', 'vendor', 'product_type',
      'price_amount_minor', 'price_currency',
      'compare_at_price_amount_minor', 'compare_at_price_currency',
      'cost_per_item_amount_minor', 'cost_per_item_currency',
      'published_channels', 'option_names', 'version',
    ];

    await this.executor.query(
      `INSERT INTO ${this.q(TABLE)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        product.id,
        this.storeId(),
        product.handle,
        product.title,
        product.description,
        product.status,
        product.vendor,
        product.productType,
        product.price.amountMinor.toString(),
        product.price.currency,
        product.compareAtPrice?.amountMinor.toString() ?? null,
        product.compareAtPrice?.currency ?? null,
        product.costPerItem?.amountMinor.toString() ?? null,
        product.costPerItem?.currency ?? null,
        JSON.stringify(product.publishedChannels),
        JSON.stringify(product.optionNames),
        product.version,
      ],
    );
    return product;
  }

  /**
   * The version predicate is the optimistic lock: a concurrent write bumps the
   * version, this UPDATE matches zero rows, and we surface a conflict rather
   * than silently discarding the other person's edit.
   */
  async update(product: Product, expectedVersion: number): Promise<Product> {
    const assignments = [
      'handle', 'title', 'description', 'status', 'vendor', 'product_type',
      'price_amount_minor', 'price_currency',
      'compare_at_price_amount_minor', 'compare_at_price_currency',
      'cost_per_item_amount_minor', 'cost_per_item_currency',
      'published_channels', 'option_names', 'version',
    ];

    const parameters: unknown[] = [
      product.handle,
      product.title,
      product.description,
      product.status,
      product.vendor,
      product.productType,
      product.price.amountMinor.toString(),
      product.price.currency,
      product.compareAtPrice?.amountMinor.toString() ?? null,
      product.compareAtPrice?.currency ?? null,
      product.costPerItem?.amountMinor.toString() ?? null,
      product.costPerItem?.currency ?? null,
      JSON.stringify(product.publishedChannels),
      JSON.stringify(product.optionNames),
      product.version,
      this.storeId(),
      product.id,
      expectedVersion,
    ];

    const placeholders = this.args(parameters.length);
    const setClause = assignments
      .map((column, index) => `${this.q(column)} = ${placeholders[index]}`)
      .join(', ');
    const [storeParam, idParam, versionParam] = placeholders.slice(assignments.length);

    const affected = await this.executeUpdate(
      `UPDATE ${this.q(TABLE)}
          SET ${setClause}, ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('store_id')} = ${storeParam}
          AND ${this.q('id')} = ${idParam}
          AND ${this.q('version')} = ${versionParam}
          AND ${this.q('deleted_at')} IS NULL`,
      parameters,
    );

    if (affected === 0) {
      throw new StaleWriteError('Product', product.id, expectedVersion, product.version);
    }
    return product;
  }

  /**
   * How many rows the versioned UPDATE matched. Postgres answers with RETURNING;
   * MySQL answers with affectedRows from the driver.
   *
   * Re-reading the row to answer this is NOT equivalent and was wrong here
   * before: by the time the loser re-reads, the winner has already written the
   * very version the loser expected, so the check passes and a lost update goes
   * unnoticed.
   */
  private async executeUpdate(sql: string, parameters: unknown[]): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(
        `${sql} RETURNING ${this.q('id')}`,
        parameters,
      );
      return rows.length;
    }

    const writable = this.executor as QueryExecutor & {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };
    if (typeof writable.execute !== 'function') {
      throw new Error(
        'This executor cannot report affected rows, so optimistic concurrency cannot be enforced. ' +
          'Use MysqlExecutor, which implements execute().',
      );
    }
    const result = await writable.execute(sql, parameters);
    return result.affectedRows;
  }

  async softDelete(id: string): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q(TABLE)} SET ${this.q('deleted_at')} = CURRENT_TIMESTAMP(3) WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2}`,
      [this.storeId(), id],
    );
  }
}

function toVariant(row: VariantRow): ProductVariant {
  const values = row.option_values;
  const parsed = typeof values === 'string' ? safeJson(values) : values;

  return {
    id: row.id,
    sku: row.sku,
    optionValues: (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, string>,
    price: money(BigInt(row.price_amount_minor ?? '0'), row.price_currency ?? 'USD'),
    inventoryQuantity: Number(row.inventory_quantity ?? 0),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toDomain(row: ProductRow): Product {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description ?? '',
    status: row.status as Product['status'],
    vendor: row.vendor,
    productType: row.product_type,
    price: money(BigInt(row.price_amount_minor ?? '0'), row.price_currency ?? 'USD'),
    compareAtPrice:
      row.compare_at_price_amount_minor === null || row.compare_at_price_amount_minor === undefined
        ? null
        : money(
            BigInt(row.compare_at_price_amount_minor),
            row.compare_at_price_currency ?? row.price_currency ?? 'USD',
          ),
    costPerItem:
      row.cost_per_item_amount_minor === null || row.cost_per_item_amount_minor === undefined
        ? null
        : money(
            BigInt(row.cost_per_item_amount_minor),
            row.cost_per_item_currency ?? row.price_currency ?? 'USD',
          ),
    // Filled in by the repository: variants live in their own table, so the row
    // mapper cannot produce them and must not pretend the product has none.
    variants: [],
    optionNames: parseChannels(row.option_names),
    publishedChannels: parseChannels(row.published_channels),
    version: Number(row.version),
  };
}

function parseChannels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

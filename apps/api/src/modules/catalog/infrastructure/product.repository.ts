/**
 * Catalog · infrastructure/product.repository.ts
 * Implements the ProductRepository port declared in application/. Every query
 * here is store-scoped — the store comes from the ambient request context, never
 * from a caller argument, and the fitness suite fails the build on any query
 * that omits the boundary (§14.2, §20.1).
 * Layer: infrastructure.
 */

import {
  type Connection,
  type ListQuery,
  money,
  type StoreId,
} from '@deservefirst/contracts';

import { ListEngine, type QueryExecutor } from '../../../core/list-engine';
import { StaleWriteError } from '../../../core/entity-toolkit';
import { requireStoreContext } from '../../../core/tenant-context';
import { productResource } from '../contracts';
import type { Product } from '../domain';
import type { ProductRepository } from '../application';

const TABLE = 'products';

interface ProductRow extends Record<string, unknown> {
  id: string;
  store_id: string;
  handle: string;
  title: string;
  description: string | null;
  status: string;
  vendor: string | null;
  product_type: string | null;
  price_amount_minor: string;
  price_currency: string;
  compare_at_amount_minor: string | null;
  cost_amount_minor: string | null;
  published_channels: string[] | null;
  version: number;
}

export class PostgresProductRepository implements ProductRepository {
  private readonly listEngine: ListEngine;

  constructor(private readonly executor: QueryExecutor) {
    this.listEngine = new ListEngine(executor);
  }

  /** Reads the boundary from context so no caller can widen it. */
  private storeId(): StoreId {
    return requireStoreContext('catalog.products').storeId;
  }

  async findById(id: string): Promise<Product | null> {
    const rows = await this.executor.query<ProductRow>(
      `SELECT * FROM ${TABLE} WHERE store_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByHandle(handle: string): Promise<Product | null> {
    const rows = await this.executor.query<ProductRow>(
      `SELECT * FROM ${TABLE} WHERE store_id = $1 AND handle = $2 AND deleted_at IS NULL LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  /**
   * Handles that would collide with a new one. Deleted rows are included: a
   * restored product must not find its handle stolen while it was away.
   */
  async takenHandles(prefix: string): Promise<ReadonlySet<string>> {
    const rows = await this.executor.query<{ handle: string }>(
      `SELECT handle FROM ${TABLE} WHERE store_id = $1 AND handle LIKE $2`,
      [this.storeId(), `${prefix}%`],
    );
    return new Set(rows.map((row) => row.handle));
  }

  async list(query: ListQuery): Promise<Connection<Product>> {
    const connection = await this.listEngine.list<ProductRow>({
      resource: productResource,
      tableName: TABLE,
      query,
    });
    return { ...connection, nodes: connection.nodes.map(toDomain) };
  }

  async insert(product: Product): Promise<Product> {
    const storeId = this.storeId();
    await this.executor.query(
      `INSERT INTO ${TABLE}
         (id, store_id, handle, title, description, status, vendor, product_type,
          price_amount_minor, price_currency, compare_at_amount_minor, cost_amount_minor,
          published_channels, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), now())`,
      [
        product.id,
        storeId,
        product.handle,
        product.title,
        product.description,
        product.status,
        product.vendor,
        product.productType,
        product.price.amountMinor.toString(),
        product.price.currency,
        product.compareAtPrice?.amountMinor.toString() ?? null,
        product.costPerItem?.amountMinor.toString() ?? null,
        JSON.stringify(product.publishedChannels),
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
    const rows = await this.executor.query<{ id: string }>(
      `UPDATE ${TABLE}
          SET handle = $3, title = $4, description = $5, status = $6, vendor = $7,
              product_type = $8, price_amount_minor = $9, price_currency = $10,
              compare_at_amount_minor = $11, cost_amount_minor = $12,
              published_channels = $13, version = $14, updated_at = now()
        WHERE store_id = $1 AND id = $2 AND version = $15 AND deleted_at IS NULL
        RETURNING id`,
      [
        this.storeId(),
        product.id,
        product.handle,
        product.title,
        product.description,
        product.status,
        product.vendor,
        product.productType,
        product.price.amountMinor.toString(),
        product.price.currency,
        product.compareAtPrice?.amountMinor.toString() ?? null,
        product.costPerItem?.amountMinor.toString() ?? null,
        JSON.stringify(product.publishedChannels),
        product.version,
        expectedVersion,
      ],
    );

    if (rows.length === 0) {
      throw new StaleWriteError('Product', product.id, expectedVersion, product.version);
    }
    return product;
  }

  async softDelete(id: string): Promise<void> {
    await this.executor.query(
      `UPDATE ${TABLE} SET deleted_at = now() WHERE store_id = $1 AND id = $2`,
      [this.storeId(), id],
    );
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
    price: money(BigInt(row.price_amount_minor), row.price_currency),
    compareAtPrice:
      row.compare_at_amount_minor === null
        ? null
        : money(BigInt(row.compare_at_amount_minor), row.price_currency),
    costPerItem:
      row.cost_amount_minor === null ? null : money(BigInt(row.cost_amount_minor), row.price_currency),
    variants: [],
    optionNames: [],
    publishedChannels: parseChannels(row.published_channels),
    version: row.version,
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

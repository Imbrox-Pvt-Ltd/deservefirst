/**
 * Inventory · infrastructure/index.ts
 * Repositories for locations, levels, adjustments, purchase orders and transfers.
 * Every query here is store-scoped — the fitness suite fails the build on any
 * that is not (§14.2).
 *
 * Levels are a materialised projection, not the truth. The truth is the
 * append-only adjustment log; the projection exists because "show me every SKU
 * at this location" must not replay a year of adjustments per row.
 * Layer: infrastructure.
 */

import { randomUUID } from 'node:crypto';

import { type ResourceDefinition } from '@deservefirst/contracts';

import { SqlAggregateRepository, parseJsonArray } from '../../../core/database';
import { type QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import {
  inventoryLevelResource,
  locationResource,
  purchaseOrderResource,
  transferResource,
} from '../contracts';
import type {
  InventoryAdjustment,
  PurchaseOrder,
  PurchaseOrderLine,
  Transfer,
  TransferLine,
} from '../domain';
import type {
  AdjustmentRepository,
  LevelRepository,
  LocationRepository,
  PurchaseOrderRepository,
  StoredLevel,
  StoredLocation,
  TransferRepository,
} from '../application';

// --- locations ---------------------------------------------------------------

interface LocationRow extends Record<string, unknown> {
  id: string;
  name: string;
  address: string | null;
  country_code: string;
  fulfils_orders: number | boolean;
  archived_at: Date | string | null;
  version: number;
}

export class SqlLocationRepository
  extends SqlAggregateRepository<StoredLocation, LocationRow>
  implements LocationRepository
{
  protected readonly tableName = 'locations';
  protected readonly resource: ResourceDefinition = locationResource;
  protected readonly operation = 'inventory.locations';

  protected toDomain(row: LocationRow): StoredLocation {
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      countryCode: row.country_code,
      fulfilsOrders: Boolean(Number(row.fulfils_orders)),
      archivedAt: row.archived_at ? new Date(row.archived_at as string) : null,
      version: Number(row.version),
    };
  }

  protected toColumns(entity: StoredLocation): Record<string, unknown> {
    return {
      name: entity.name,
      address: entity.address,
      country_code: entity.countryCode,
      fulfils_orders: entity.fulfilsOrders ? 1 : 0,
      archived_at: entity.archivedAt,
    };
  }

  async active(): Promise<readonly StoredLocation[]> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<LocationRow>(
      `SELECT * FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('archived_at')} IS NULL
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('name')} ASC`,
      [this.storeId()],
    );
    return rows.map((row) => this.toDomain(row));
  }
}

// --- levels ------------------------------------------------------------------

interface LevelRow extends Record<string, unknown> {
  id: string;
  location_id: string;
  product_id: string;
  variant_id: string | null;
  title: string;
  sku: string | null;
  on_hand: number;
  committed: number;
  incoming: number;
  version: number;
}

export class SqlLevelRepository
  extends SqlAggregateRepository<StoredLevel, LevelRow>
  implements LevelRepository
{
  protected readonly tableName = 'inventory_levels';
  protected readonly resource: ResourceDefinition = inventoryLevelResource;
  protected readonly operation = 'inventory.levels';

  protected toDomain(row: LevelRow): StoredLevel {
    return {
      id: row.id,
      locationId: row.location_id,
      productId: row.product_id,
      variantId: row.variant_id,
      title: row.title,
      sku: row.sku,
      onHand: Number(row.on_hand),
      committed: Number(row.committed),
      incoming: Number(row.incoming),
      version: Number(row.version),
    };
  }

  protected toColumns(entity: StoredLevel): Record<string, unknown> {
    return {
      location_id: entity.locationId,
      product_id: entity.productId,
      variant_id: entity.variantId,
      title: entity.title,
      sku: entity.sku,
      on_hand: entity.onHand,
      committed: entity.committed,
      incoming: entity.incoming,
    };
  }

  /**
   * The level for one stock-keeping position. `variantId` is part of that key,
   * and a null must be matched with IS NULL — `= NULL` is never true, so a
   * product without variants would get a fresh level row on every adjustment.
   */
  async find(
    locationId: string,
    productId: string,
    variantId: string | null,
  ): Promise<StoredLevel | null> {
    const parameters: unknown[] = [this.storeId(), locationId, productId];
    if (variantId !== null) parameters.push(variantId);
    const p = this.args(parameters.length);

    const rows = await this.executor.query<LevelRow>(
      `SELECT * FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p[0]}
          AND ${this.q('location_id')} = ${p[1]}
          AND ${this.q('product_id')} = ${p[2]}
          AND ${this.q('variant_id')} ${variantId === null ? 'IS NULL' : `= ${p[3]}`}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      parameters,
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }
}

// --- adjustments -------------------------------------------------------------

interface AdjustmentRow extends Record<string, unknown> {
  id: string;
  location_id: string;
  product_id: string;
  variant_id: string | null;
  delta: number;
  reason: string;
  reference: string | null;
  occurred_at: Date | string;
}

/**
 * Append-only. There is deliberately no update and no delete: an adjustment IS
 * the audit trail, and a correction is another adjustment carrying its own
 * reason. Editing history to make a count look right is the failure mode this
 * whole design exists to prevent.
 */
export class SqlAdjustmentRepository implements AdjustmentRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async append(adjustment: Omit<InventoryAdjustment, 'id'>): Promise<InventoryAdjustment> {
    const stored: InventoryAdjustment = { ...adjustment, id: randomUUID() };
    const values: Record<string, unknown> = {
      id: stored.id,
      store_id: requireStoreContext('inventory.adjustments').storeId,
      location_id: stored.locationId,
      product_id: stored.productId,
      variant_id: stored.variantId,
      delta: stored.delta,
      reason: stored.reason,
      reference: stored.reference,
      occurred_at: stored.occurredAt,
      version: 1,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('inventory_adjustments')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, i) => this.dialect.placeholder(i + 1)).join(', ')})`,
      Object.values(values),
    );
    return stored;
  }

  async history(
    locationId: string,
    productId: string,
    limit = 50,
  ): Promise<readonly InventoryAdjustment[]> {
    const p = (n: number) => this.dialect.placeholder(n);
    const rows = await this.executor.query<AdjustmentRow>(
      `SELECT * FROM ${this.q('inventory_adjustments')}
        WHERE ${this.q('store_id')} = ${p(1)}
          AND ${this.q('location_id')} = ${p(2)}
          AND ${this.q('product_id')} = ${p(3)}
        ORDER BY ${this.q('occurred_at')} DESC
        LIMIT ${p(4)}`,
      [requireStoreContext('inventory.adjustments').storeId, locationId, productId, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      locationId: row.location_id,
      productId: row.product_id,
      variantId: row.variant_id,
      delta: Number(row.delta),
      reason: row.reason as InventoryAdjustment['reason'],
      reference: row.reference,
      occurredAt: new Date(row.occurred_at as string),
    }));
  }
}

// --- purchase orders ---------------------------------------------------------

interface PurchaseOrderRow extends Record<string, unknown> {
  id: string;
  reference: string;
  supplier_name: string;
  destination_location_id: string;
  status: string;
  expected_at: Date | string | null;
  lines: unknown;
  version: number;
}

export class SqlPurchaseOrderRepository
  extends SqlAggregateRepository<PurchaseOrder, PurchaseOrderRow>
  implements PurchaseOrderRepository
{
  protected readonly tableName = 'purchase_orders';
  protected readonly resource: ResourceDefinition = purchaseOrderResource;
  protected readonly operation = 'inventory.purchase-orders';

  protected toDomain(row: PurchaseOrderRow): PurchaseOrder {
    return {
      id: row.id,
      reference: row.reference,
      supplierName: row.supplier_name,
      destinationLocationId: row.destination_location_id,
      status: row.status as PurchaseOrder['status'],
      expectedAt: row.expected_at ? new Date(row.expected_at as string) : null,
      lines: parseJsonArray<PurchaseOrderLine>(row.lines),
      version: Number(row.version),
    };
  }

  protected toColumns(entity: PurchaseOrder): Record<string, unknown> {
    return {
      reference: entity.reference,
      supplier_name: entity.supplierName,
      destination_location_id: entity.destinationLocationId,
      status: entity.status,
      expected_at: entity.expectedAt,
      lines: JSON.stringify(entity.lines),
      // Denormalised so the list can sort and show it without parsing every row.
      line_count: entity.lines.length,
    };
  }

  async nextReference(): Promise<string> {
    return nextReference(this.executor, this.dialect, this.tableName, 'PO');
  }
}

// --- transfers ---------------------------------------------------------------

interface TransferRow extends Record<string, unknown> {
  id: string;
  reference: string;
  origin_location_id: string;
  destination_location_id: string;
  status: string;
  lines: unknown;
  version: number;
}

export class SqlTransferRepository
  extends SqlAggregateRepository<Transfer, TransferRow>
  implements TransferRepository
{
  protected readonly tableName = 'transfers';
  protected readonly resource: ResourceDefinition = transferResource;
  protected readonly operation = 'inventory.transfers';

  protected toDomain(row: TransferRow): Transfer {
    return {
      id: row.id,
      reference: row.reference,
      originLocationId: row.origin_location_id,
      destinationLocationId: row.destination_location_id,
      status: row.status as Transfer['status'],
      lines: parseJsonArray<TransferLine>(row.lines),
      version: Number(row.version),
    };
  }

  protected toColumns(entity: Transfer): Record<string, unknown> {
    return {
      reference: entity.reference,
      origin_location_id: entity.originLocationId,
      destination_location_id: entity.destinationLocationId,
      status: entity.status,
      lines: JSON.stringify(entity.lines),
      line_count: entity.lines.length,
    };
  }

  async nextReference(): Promise<string> {
    return nextReference(this.executor, this.dialect, this.tableName, 'TR');
  }
}

/**
 * A human-facing label like `PO-1004`, numbered per store.
 *
 * Derived from the row count, which is honest about what it is: a display label,
 * not an identity. Two concurrent creates can produce the same string, and that
 * is tolerable precisely because `id` is what anything else refers to. Making
 * the label the identity is how a store ends up unable to raise a purchase order
 * because a deleted one is holding the number.
 */
async function nextReference(
  executor: QueryExecutor,
  dialect: SqlDialect,
  tableName: string,
  prefix: string,
): Promise<string> {
  const rows = await executor.query<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM ${dialect.quoteIdentifier(tableName)}
      WHERE ${dialect.quoteIdentifier('store_id')} = ${dialect.placeholder(1)}`,
    [requireStoreContext(`inventory.${tableName}`).storeId],
  );
  return `${prefix}-${1001 + Number(rows[0]?.total ?? 0)}`;
}

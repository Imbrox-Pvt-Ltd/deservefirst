/**
 * Inventory · application/ports.ts
 * What the services need from persistence, stated as interfaces so the domain
 * and use-cases stay testable without a database.
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type {
  InventoryAdjustment,
  InventoryLevel,
  Location,
  PurchaseOrder,
  Transfer,
} from '../domain';

/** A level as stored: the domain quantities plus what the list screen shows. */
export type StoredLevel = InventoryLevel & {
  readonly id: string;
  readonly title: string;
  readonly sku: string | null;
  readonly version: number;
};

export type StoredLocation = Location & { readonly version: number };

export interface LocationRepository {
  findById(id: string): Promise<StoredLocation | null>;
  list(query: ListQuery): Promise<Connection<StoredLocation>>;
  insert(location: StoredLocation): Promise<StoredLocation>;
  update(location: StoredLocation, expectedVersion: number): Promise<StoredLocation>;
  softDelete(id: string): Promise<void>;
  /** Unarchived locations, for pickers. */
  active(): Promise<readonly StoredLocation[]>;
}

export interface LevelRepository {
  findById(id: string): Promise<StoredLevel | null>;
  find(locationId: string, productId: string, variantId: string | null): Promise<StoredLevel | null>;
  list(query: ListQuery): Promise<Connection<StoredLevel>>;
  insert(level: StoredLevel): Promise<StoredLevel>;
  update(level: StoredLevel, expectedVersion: number): Promise<StoredLevel>;
}

export interface AdjustmentRepository {
  append(adjustment: Omit<InventoryAdjustment, 'id'>): Promise<InventoryAdjustment>;
  history(locationId: string, productId: string, limit?: number): Promise<readonly InventoryAdjustment[]>;
}

export interface PurchaseOrderRepository {
  findById(id: string): Promise<PurchaseOrder | null>;
  list(query: ListQuery): Promise<Connection<PurchaseOrder>>;
  insert(order: PurchaseOrder): Promise<PurchaseOrder>;
  update(order: PurchaseOrder, expectedVersion: number): Promise<PurchaseOrder>;
  softDelete(id: string): Promise<void>;
  nextReference(): Promise<string>;
}

export interface TransferRepository {
  findById(id: string): Promise<Transfer | null>;
  list(query: ListQuery): Promise<Connection<Transfer>>;
  insert(transfer: Transfer): Promise<Transfer>;
  update(transfer: Transfer, expectedVersion: number): Promise<Transfer>;
  softDelete(id: string): Promise<void>;
  nextReference(): Promise<string>;
}

export class InventoryNotFoundError extends Error {
  readonly status = 404;
  constructor(what: string, id: string) {
    super(`No ${what} with id "${id}" in this store.`);
    this.name = 'InventoryNotFoundError';
  }
}

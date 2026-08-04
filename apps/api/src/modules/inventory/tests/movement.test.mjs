/**
 * Inventory · tests/movement.test.mjs
 * The use-cases that move stock, against in-memory repositories.
 *
 * These exist because the interesting failures are not in the arithmetic — the
 * domain tests cover that — but in the ORCHESTRATION: receiving twice, shipping
 * and then cancelling, a transfer where less arrives than left. Each of those
 * has a right answer that is easy to state and easy to get wrong.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  InventoryService,
  PurchaseOrderService,
  TransferService,
} from '../../../../dist/modules/inventory/application/index.js';

// --- in-memory doubles --------------------------------------------------------

const key = (locationId, productId, variantId) => `${locationId}:${productId}:${variantId ?? ''}`;

function makeToolkit() {
  let counter = 0;
  const emitted = [];
  const timeline = [];
  return {
    emitted,
    timeline,
    slugify: (value) => value,
    disambiguate: (base) => base,
    newId: () => `id-${++counter}`,
    now: () => new Date('2026-08-04T10:00:00.000Z'),
    recordTimeline: async (entry) => void timeline.push(entry),
    emit: async (type, payload) => void emitted.push({ type, payload }),
  };
}

function makeLevels() {
  const rows = new Map();
  return {
    rows,
    findById: async (id) => [...rows.values()].find((row) => row.id === id) ?? null,
    find: async (locationId, productId, variantId) =>
      rows.get(key(locationId, productId, variantId)) ?? null,
    list: async () => ({ nodes: [...rows.values()], pageInfo: {} }),
    insert: async (level) => {
      rows.set(key(level.locationId, level.productId, level.variantId), level);
      return level;
    },
    update: async (level) => {
      rows.set(key(level.locationId, level.productId, level.variantId), level);
      return level;
    },
  };
}

function makeAdjustments() {
  const log = [];
  return {
    log,
    append: async (adjustment) => {
      const stored = { ...adjustment, id: `adj-${log.length + 1}` };
      log.push(stored);
      return stored;
    },
    history: async () => [...log].reverse(),
  };
}

function makeLocations() {
  const rows = new Map([
    ['loc-a', { id: 'loc-a', name: 'Main', address: null, countryCode: 'US', fulfilsOrders: true, archivedAt: null, version: 1 }],
    ['loc-b', { id: 'loc-b', name: 'Depot', address: null, countryCode: 'US', fulfilsOrders: false, archivedAt: null, version: 1 }],
    ['loc-old', { id: 'loc-old', name: 'Closed', address: null, countryCode: 'US', fulfilsOrders: false, archivedAt: new Date('2026-01-01'), version: 1 }],
  ]);
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    list: async () => ({ nodes: [...rows.values()], pageInfo: {} }),
    insert: async (row) => row,
    update: async (row) => row,
    softDelete: async () => {},
    active: async () => [...rows.values()].filter((row) => !row.archivedAt),
  };
}

function makeAggregateStore(prefix) {
  const rows = new Map();
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    list: async () => ({ nodes: [...rows.values()], pageInfo: {} }),
    insert: async (row) => {
      rows.set(row.id, row);
      return row;
    },
    update: async (row) => {
      rows.set(row.id, row);
      return row;
    },
    softDelete: async (id) => void rows.delete(id),
    nextReference: async () => `${prefix}-${1001 + rows.size}`,
  };
}

let toolkit;
let levels;
let adjustments;
let locations;
let inventory;
let orders;
let transfers;

beforeEach(() => {
  toolkit = makeToolkit();
  levels = makeLevels();
  adjustments = makeAdjustments();
  locations = makeLocations();
  inventory = new InventoryService(levels, adjustments, locations, toolkit);
  orders = new PurchaseOrderService(makeAggregateStore('PO'), locations, inventory, toolkit);
  transfers = new TransferService(makeAggregateStore('TR'), locations, inventory, toolkit);
});

const onHandAt = (locationId, productId) =>
  levels.rows.get(key(locationId, productId, null))?.onHand ?? 0;

// --- adjustments ---------------------------------------------------------------

test('an adjustment creates the level it moves', async () => {
  const level = await inventory.adjust({
    locationId: 'loc-a', productId: 'p1', delta: 5, reason: 'received', title: 'Widget',
  });

  assert.equal(level.onHand, 5);
  assert.equal(adjustments.log.length, 1);
  assert.equal(toolkit.emitted[0].type, 'inventory.level.adjusted');
});

test('stock cannot be moved into an archived location', async () => {
  await assert.rejects(
    () => inventory.adjust({ locationId: 'loc-old', productId: 'p1', delta: 1, reason: 'received' }),
    /archived/,
  );
  // Nothing was logged: the refusal happens before anything is appended.
  assert.equal(adjustments.log.length, 0);
});

test('a recount records the difference, not the count', async () => {
  await inventory.adjust({ locationId: 'loc-a', productId: 'p1', delta: 10, reason: 'received' });
  const level = await inventory.recount({ locationId: 'loc-a', productId: 'p1', onHand: 7 });

  assert.equal(level.onHand, 7);
  const last = adjustments.log.at(-1);
  assert.equal(last.delta, -3);
  assert.equal(last.reason, 'recount');
});

test('a recount that changes nothing writes no adjustment', async () => {
  await inventory.adjust({ locationId: 'loc-a', productId: 'p1', delta: 4, reason: 'received' });
  const before = adjustments.log.length;

  const level = await inventory.recount({ locationId: 'loc-a', productId: 'p1', onHand: 4 });

  assert.equal(level.onHand, 4);
  assert.equal(adjustments.log.length, before);
});

test('negative on hand is preserved but nothing is available', async () => {
  const level = await inventory.adjust({
    locationId: 'loc-a', productId: 'p1', delta: -3, reason: 'sold',
  });

  assert.equal(level.onHand, -3);
  assert.equal(inventory.availableFor(level), 0);
});

// --- purchase orders ------------------------------------------------------------

async function orderedPo() {
  const created = await orders.create({
    supplierName: 'Acme Supply',
    destinationLocationId: 'loc-a',
    lines: [{ productId: 'p1', title: 'Widget', ordered: 10 }],
  });
  return orders.place(created.id, created.version);
}

test('receiving adds stock and derives the status from the lines', async () => {
  const placed = await orderedPo();
  const lineId = placed.lines[0].id;

  const partial = await orders.receive(placed.id, placed.version, [{ lineId, received: 4 }]);
  assert.equal(partial.status, 'partial');
  assert.equal(onHandAt('loc-a', 'p1'), 4);

  const full = await orders.receive(partial.id, partial.version, [{ lineId, received: 10 }]);
  assert.equal(full.status, 'received');
  // Cumulative totals, so the second receipt adds the REMAINING six.
  assert.equal(onHandAt('loc-a', 'p1'), 10);
});

test('receiving the same total twice does not double count', async () => {
  const placed = await orderedPo();
  const lineId = placed.lines[0].id;

  const once = await orders.receive(placed.id, placed.version, [{ lineId, received: 6 }]);
  const twice = await orders.receive(once.id, once.version, [{ lineId, received: 6 }]);

  assert.equal(twice.status, 'partial');
  assert.equal(onHandAt('loc-a', 'p1'), 6);
});

test('over-receiving is refused and moves no stock', async () => {
  const placed = await orderedPo();
  const lineId = placed.lines[0].id;

  await assert.rejects(
    () => orders.receive(placed.id, placed.version, [{ lineId, received: 12 }]),
    /received 12 of 10/,
  );
  assert.equal(onHandAt('loc-a', 'p1'), 0);
});

test('lines cannot be replaced once the order has been placed', async () => {
  const placed = await orderedPo();

  await assert.rejects(
    () => orders.update(placed.id, placed.version, { lines: [{ productId: 'p2', title: 'Other', ordered: 1 }] }),
    /cannot be changed once a purchase order is ordered/,
  );
});

test('a received purchase order cannot be cancelled', async () => {
  const placed = await orderedPo();
  const lineId = placed.lines[0].id;
  const received = await orders.receive(placed.id, placed.version, [{ lineId, received: 10 }]);

  await assert.rejects(() => orders.cancel(received.id, received.version), /return the stock/);
});

// --- transfers -------------------------------------------------------------------

async function shippedTransfer(quantity = 8) {
  const created = await transfers.create({
    originLocationId: 'loc-a',
    destinationLocationId: 'loc-b',
    lines: [{ productId: 'p1', title: 'Widget', quantity }],
  });
  await inventory.adjust({ locationId: 'loc-a', productId: 'p1', delta: quantity, reason: 'received' });
  return transfers.ship(created.id, created.version);
}

test('shipping removes stock from the origin immediately', async () => {
  await shippedTransfer(8);
  assert.equal(onHandAt('loc-a', 'p1'), 0);
  assert.equal(onHandAt('loc-b', 'p1'), 0);
});

test('receiving a transfer conserves stock across locations', async () => {
  const shipped = await shippedTransfer(8);
  const lineId = shipped.lines[0].id;

  await transfers.receive(shipped.id, shipped.version, [{ lineId, received: 8 }]);

  assert.equal(onHandAt('loc-a', 'p1'), 0);
  assert.equal(onHandAt('loc-b', 'p1'), 8);
});

test('a shortfall returns to the origin rather than vanishing', async () => {
  const shipped = await shippedTransfer(8);
  const lineId = shipped.lines[0].id;

  await transfers.receive(shipped.id, shipped.version, [{ lineId, received: 5 }]);

  // Five arrived; the three that did not are still the origin's problem.
  assert.equal(onHandAt('loc-b', 'p1'), 5);
  assert.equal(onHandAt('loc-a', 'p1'), 3);
});

test('cancelling a shipped transfer returns the stock it took', async () => {
  const shipped = await shippedTransfer(8);
  const cancelled = await transfers.cancel(shipped.id, shipped.version);

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(onHandAt('loc-a', 'p1'), 8);
  assert.equal(onHandAt('loc-b', 'p1'), 0);
});

test('a transfer cannot be edited once it is moving', async () => {
  const shipped = await shippedTransfer();

  await assert.rejects(
    () => transfers.update(shipped.id, shipped.version, { lines: [] }),
    /stock is already moving/,
  );
});

test('a received transfer cannot be received again', async () => {
  const shipped = await shippedTransfer(8);
  const lineId = shipped.lines[0].id;
  const received = await transfers.receive(shipped.id, shipped.version, [{ lineId, received: 8 }]);

  await assert.rejects(
    () => transfers.receive(received.id, received.version, [{ lineId, received: 8 }]),
    /already received/,
  );
});

test('a shipped transfer cannot be shipped again', async () => {
  const shipped = await shippedTransfer(8);

  await assert.rejects(() => transfers.ship(shipped.id, shipped.version), /already in-transit/);
  // The stock left once, not twice.
  assert.equal(onHandAt('loc-a', 'p1'), 0);
});

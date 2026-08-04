/**
 * Inventory · tests/manifest.test.mjs
 * Stock arithmetic, and the rules that stop a store overselling. The recurring
 * theme: on-hand is derived from adjustments with reasons, never set, so every
 * discrepancy has an explanation attached.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@deservefirst/contracts';

import { inventoryManifest } from '../../../../dist/modules/inventory/inventory.manifest.js';
import {
  adjustmentsForReceipt,
  applyAdjustment,
  assertLocationValid,
  assertPurchaseOrderValid,
  assertTransferTransition,
  assertTransferValid,
  available,
  deriveStatus,
  inTransit,
  InventoryInvariantError,
} from '../../../../dist/modules/inventory/domain/index.js';

test('the manifest satisfies every capability contract it declares', () => {
  assert.deepEqual(validateManifest(inventoryManifest).errors, []);
});

test('adjustments are append-only — no soft delete, nothing edits them', () => {
  const adjustments = inventoryManifest.entities.find((e) => e.name === 'InventoryAdjustment');
  assert.equal(adjustments.toolkit.softDelete, false);
  assert.equal(adjustments.toolkit.timeline, false);
});

// --- levels -----------------------------------------------------------------

const level = (overrides = {}) => ({
  locationId: 'l1',
  productId: 'p1',
  variantId: null,
  onHand: 10,
  committed: 3,
  incoming: 5,
  ...overrides,
});

const adjustment = (overrides = {}) => ({
  id: 'a1',
  locationId: 'l1',
  productId: 'p1',
  variantId: null,
  delta: 5,
  reason: 'received',
  reference: null,
  occurredAt: new Date(),
  ...overrides,
});

test('available excludes committed stock', () => {
  assert.equal(available(level()), 7);
  // Never negative, even when the underlying data is inconsistent — a negative
  // "available" would be meaningless to every caller.
  assert.equal(available(level({ onHand: 2, committed: 5 })), 0);
});

test('an adjustment moves on hand by its delta', () => {
  assert.equal(applyAdjustment(level(), adjustment({ delta: 5 })).onHand, 15);
  assert.equal(applyAdjustment(level(), adjustment({ delta: -4, reason: 'sold' })).onHand, 6);
});

test('negative on hand is preserved, not clamped', () => {
  // It is the evidence of an unrecorded movement; clamping to zero destroys the
  // very signal a recount needs.
  const result = applyAdjustment(level({ onHand: 2 }), adjustment({ delta: -5, reason: 'sold' }));
  assert.equal(result.onHand, -3);
});

test('a zero or fractional adjustment is refused', () => {
  assert.throws(() => applyAdjustment(level(), adjustment({ delta: 0 })), /records nothing/);
  assert.throws(() => applyAdjustment(level(), adjustment({ delta: 1.5 })), /whole number of units/);
});

test('a location needs a name and an ISO country', () => {
  const location = { id: 'l1', name: 'Warehouse', address: null, countryCode: 'US', fulfilsOrders: true, archivedAt: null };
  assert.doesNotThrow(() => assertLocationValid(location));
  assert.throws(() => assertLocationValid({ ...location, name: ' ' }), InventoryInvariantError);
  assert.throws(() => assertLocationValid({ ...location, countryCode: 'USA' }), /two-letter ISO/);
});

// --- purchase orders --------------------------------------------------------

const order = (lines, overrides = {}) => ({
  id: 'po1',
  reference: 'PO-1001',
  supplierName: 'Acme Supply',
  destinationLocationId: 'l1',
  status: 'ordered',
  expectedAt: null,
  lines,
  version: 1,
  ...overrides,
});

const poLine = (overrides = {}) => ({
  id: 'pl1', productId: 'p1', variantId: null, title: 'Snowboard',
  ordered: 10, received: 0, ...overrides,
});

test('purchase order status is derived from its lines, so they cannot disagree', () => {
  assert.equal(deriveStatus(order([poLine({ received: 0 })])), 'ordered');
  assert.equal(deriveStatus(order([poLine({ received: 4 })])), 'partial');
  assert.equal(deriveStatus(order([poLine({ received: 10 })])), 'received');
  assert.equal(
    deriveStatus(order([poLine({ id: 'a', received: 10 }), poLine({ id: 'b', productId: 'p2', received: 3 })])),
    'partial',
  );
});

test('a draft or cancelled order keeps its status regardless of lines', () => {
  assert.equal(deriveStatus(order([poLine({ received: 10 })], { status: 'draft' })), 'draft');
  assert.equal(deriveStatus(order([poLine({ received: 10 })], { status: 'cancelled' })), 'cancelled');
});

test('over-receiving is refused so it is recorded deliberately', () => {
  // Suppliers do ship extra; that is a separate adjustment with its own reason,
  // not an unnoticed off-by-N on the order.
  assert.throws(
    () => assertPurchaseOrderValid(order([poLine({ ordered: 10, received: 12 })])),
    /received 12 of 10 ordered/,
  );
});

test('an ordered purchase order needs lines and a supplier', () => {
  assert.throws(() => assertPurchaseOrderValid(order([])), /needs at least one line/);
  assert.throws(() => assertPurchaseOrderValid(order([poLine()], { supplierName: '' })), /is required/);
  // A draft may be empty.
  assert.doesNotThrow(() => assertPurchaseOrderValid(order([], { status: 'draft' })));
});

// --- transfers --------------------------------------------------------------

const transfer = (lines, overrides = {}) => ({
  id: 't1',
  reference: 'TR-1001',
  originLocationId: 'l1',
  destinationLocationId: 'l2',
  status: 'in-transit',
  lines,
  version: 1,
  ...overrides,
});

const tLine = (overrides = {}) => ({
  id: 'tl1', productId: 'p1', variantId: null, title: 'Snowboard',
  quantity: 10, receivedQuantity: 0, ...overrides,
});

test('a transfer needs two different locations', () => {
  assert.throws(
    () => assertTransferValid(transfer([tLine()], { destinationLocationId: 'l1' })),
    /two different locations/,
  );
});

test('stock in transit belongs to neither location', () => {
  // Counting it as arrived is how a store oversells a shipment still on a lorry.
  assert.equal(inTransit(transfer([tLine({ quantity: 10, receivedQuantity: 4 })])), 6);
  assert.equal(inTransit(transfer([tLine()], { status: 'draft' })), 0);
  assert.equal(inTransit(transfer([tLine()], { status: 'received' })), 0);
});

test('receiving more than was sent is refused', () => {
  assert.throws(
    () => assertTransferValid(transfer([tLine({ quantity: 5, receivedQuantity: 7 })])),
    /received more than was sent/,
  );
});

test('a transfer follows its declared path', () => {
  assert.doesNotThrow(() => assertTransferTransition('draft', 'in-transit'));
  assert.doesNotThrow(() => assertTransferTransition('in-transit', 'received'));
  assert.throws(() => assertTransferTransition('draft', 'received'), /cannot move from draft to received/);
  assert.throws(() => assertTransferTransition('received', 'in-transit'), InventoryInvariantError);
});

test('receiving a transfer produces a matched pair of adjustments', () => {
  const now = new Date();
  const adjustments = adjustmentsForReceipt(
    transfer([tLine({ quantity: 10, receivedQuantity: 10 })]),
    now,
  );

  assert.equal(adjustments.length, 2);
  const out = adjustments.find((a) => a.reason === 'transfer-out');
  const into = adjustments.find((a) => a.reason === 'transfer-in');

  assert.equal(out.locationId, 'l1');
  assert.equal(out.delta, -10);
  assert.equal(into.locationId, 'l2');
  assert.equal(into.delta, 10);
  // The pair nets to zero: a transfer moves stock, it does not create it.
  assert.equal(out.delta + into.delta, 0);
  assert.equal(out.reference, 'TR-1001');
});

test('a partial receipt only moves what actually arrived', () => {
  const adjustments = adjustmentsForReceipt(
    transfer([tLine({ quantity: 10, receivedQuantity: 6 })]),
    new Date(),
  );
  assert.equal(adjustments.find((a) => a.reason === 'transfer-in').delta, 6);
  assert.equal(adjustments.find((a) => a.reason === 'transfer-out').delta, -6);
});

/**
 * Orders · tests/manifest.test.mjs
 * The Request state machine and quote rules, plus the three-module composition.
 *
 * What these tests do NOT cover is the point of the module: there is nothing
 * about payment, tax or fulfilment, because ADR 0001 D10 defers all three.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@deservefirst/contracts';

import { ModuleRegistry, ModuleRegistryError } from '../../../../dist/core/module-registry/registry.js';
import { authManifest } from '../../../../dist/auth/auth.manifest.js';
import { catalogManifest } from '../../../../dist/modules/catalog/catalog.manifest.js';
import { customersManifest } from '../../../../dist/modules/customers/customers.manifest.js';
import { ordersManifest } from '../../../../dist/modules/orders/orders.manifest.js';
import { requestResource } from '../../../../dist/modules/orders/contracts/index.js';
import {
  assertRequestValid,
  assertTransitionAllowed,
  canAccept,
  canSendQuote,
  isFullyQuoted,
  isQuoteExpired,
  isTerminal,
  listSubtotal,
  RequestInvariantError,
  subtotal,
  totalQuantity,
} from '../../../../dist/modules/orders/domain/index.js';

const usd = (minor) => ({ amountMinor: BigInt(minor), currency: 'USD' });

const line = (overrides = {}) => ({
  id: 'l1',
  productId: 'p1',
  variantId: null,
  title: 'Snowboard',
  sku: 'SNB-1',
  quantity: 2,
  listPrice: usd(50000),
  quotedPrice: null,
  note: null,
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'r1',
  reference: 'RFQ-1001',
  customerId: 'c1',
  contactEmail: 'buyer@example.test',
  contactName: 'Buyer',
  status: 'submitted',
  currency: 'USD',
  lines: [line()],
  note: null,
  internalNote: null,
  quoteExpiresAt: null,
  submittedAt: new Date('2026-08-01'),
  respondedAt: null,
  version: 1,
  ...overrides,
});

// --- composition ------------------------------------------------------------

test('the manifest satisfies every capability contract it declares', () => {
  assert.deepEqual(validateManifest(ordersManifest).errors, []);
});

test('three product modules compose into one admin', () => {
  const registry = new ModuleRegistry();
  registry.register(authManifest);
  registry.register(catalogManifest);
  registry.register(customersManifest);
  registry.register(ordersManifest);
  registry.seal();

  const nav = registry.navigation().map((entry) => entry.item.label);
  // Sorted by declared position across three independent manifests.
  assert.deepEqual(nav, ['Requests', 'Products', 'Collections', 'Customers']);

  const permissions = new Set(registry.permissions().map((entry) => entry.item.key));
  for (const entry of registry.routes()) {
    assert.ok(permissions.has(entry.item.permission), `undeclared ${entry.item.permission}`);
  }

  const tables = registry.storeScopedTables();
  assert.equal(new Set(tables).size, tables.length, 'two modules claimed the same table');
  assert.ok(tables.includes('requests'));
  assert.ok(tables.includes('request_lines'));
});

test('a required dependency that is absent stops the boot', () => {
  // Orders needs catalog AND customers. Missing either is fatal, unlike the
  // optional dependency customers declares on catalog.
  const registry = new ModuleRegistry();
  registry.register(catalogManifest);
  registry.register(ordersManifest);
  assert.throws(() => registry.seal(), ModuleRegistryError);
});

test('the internal note never reaches the public surface', () => {
  const note = requestResource.fields.find((field) => field.name === 'internalNote');
  assert.equal(note.visibility, 'private');
});

test('the manifest declares nothing about payment, tax or fulfilment', () => {
  // The absence is the design (ADR 0001 D10). If this test starts failing,
  // someone has begun a half-built checkout.
  const declared = JSON.stringify(ordersManifest).toLowerCase();
  for (const forbidden of ['payment', 'refund', 'tax', 'fulfil', 'fulfill', 'shipping']) {
    assert.ok(!declared.includes(forbidden), `manifest mentions "${forbidden}"`);
  }
});

// --- totals -----------------------------------------------------------------

test('the subtotal prefers a quoted price line by line', () => {
  const partial = request({
    lines: [
      line({ id: 'a', productId: 'p1', quantity: 2, listPrice: usd(50000), quotedPrice: usd(45000) }),
      line({ id: 'b', productId: 'p2', quantity: 1, listPrice: usd(10000), quotedPrice: null }),
    ],
  });

  // 2 × 450.00 quoted + 1 × 100.00 list
  assert.equal(subtotal(partial).amountMinor, 100000n);
  assert.equal(listSubtotal(partial).amountMinor, 110000n);
  assert.equal(totalQuantity(partial), 3);
});

test('an empty request has a zero subtotal in its own currency', () => {
  const empty = request({ status: 'draft', lines: [] });
  assert.equal(subtotal(empty).amountMinor, 0n);
  assert.equal(subtotal(empty).currency, 'USD');
});

// --- invariants -------------------------------------------------------------

test('a request nobody can be reached about is refused', () => {
  assert.throws(
    () => assertRequestValid(request({ customerId: null, contactEmail: null })),
    /needs a customer or a contact email/,
  );
});

test('a submitted request needs at least one line, a draft does not', () => {
  assert.throws(() => assertRequestValid(request({ lines: [] })), /needs at least one line/);
  assert.doesNotThrow(() => assertRequestValid(request({ status: 'draft', lines: [] })));
});

test('the same product cannot appear twice', () => {
  assert.throws(
    () =>
      assertRequestValid(
        request({ lines: [line({ id: 'a' }), line({ id: 'b' })] }),
      ),
    /appears twice — merge the quantities/,
  );
  // The same product in a different variant is a different line, and allowed.
  assert.doesNotThrow(() =>
    assertRequestValid(request({ lines: [line({ id: 'a' }), line({ id: 'b', variantId: 'v2' })] })),
  );
});

test('quantities must be whole and positive', () => {
  assert.throws(() => assertRequestValid(request({ lines: [line({ quantity: 0 })] })), /at least 1/);
  assert.throws(() => assertRequestValid(request({ lines: [line({ quantity: 1.5 })] })), /whole number/);
  assert.throws(() => assertRequestValid(request({ lines: [line({ quantity: 2_000_000 })] })), /implausible/);
});

test('every line must be in the request currency', () => {
  assert.throws(
    () => assertRequestValid(request({ lines: [line({ listPrice: { amountMinor: 100n, currency: 'EUR' } })] })),
    /priced in EUR, not USD/,
  );
  assert.throws(
    () => assertRequestValid(request({ lines: [line({ quotedPrice: { amountMinor: 100n, currency: 'EUR' } })] })),
    /different currency/,
  );
});

test('a quote must have an expiry', () => {
  assert.throws(
    () => assertRequestValid(request({ status: 'quoted', quoteExpiresAt: null })),
    /open-ended quote is a price list/,
  );
});

// --- state machine ----------------------------------------------------------

test('the status path is declared, not implied', () => {
  assert.doesNotThrow(() => assertTransitionAllowed('draft', 'submitted'));
  assert.doesNotThrow(() => assertTransitionAllowed('submitted', 'quoted'));
  assert.doesNotThrow(() => assertTransitionAllowed('quoted', 'accepted'));

  // Cannot skip quoting.
  assert.throws(() => assertTransitionAllowed('submitted', 'accepted'), RequestInvariantError);
  // Cannot reopen after acceptance — that is how a quoted price silently changes.
  assert.throws(() => assertTransitionAllowed('accepted', 'quoted'), /cannot move from accepted/);
});

test('terminal states are terminal', () => {
  for (const status of ['accepted', 'declined', 'expired', 'cancelled']) {
    assert.equal(isTerminal(status), true, status);
  }
  for (const status of ['draft', 'submitted', 'quoted']) {
    assert.equal(isTerminal(status), false, status);
  }
});

// --- quoting ----------------------------------------------------------------

test('a quote cannot be sent until every line is priced', () => {
  const partial = request({
    lines: [line({ id: 'a', productId: 'p1', quotedPrice: usd(1) }), line({ id: 'b', productId: 'p2' })],
  });
  assert.equal(isFullyQuoted(partial), false);
  assert.equal(canSendQuote(partial).ok, false);

  const full = request({ lines: [line({ quotedPrice: usd(45000) })] });
  assert.equal(canSendQuote(full).ok, true);
});

test('only a submitted request can be quoted', () => {
  assert.equal(canSendQuote(request({ status: 'draft', lines: [line({ quotedPrice: usd(1) })] })).ok, false);
});

test('an expired quote cannot be accepted, whatever the stored status says', () => {
  const now = new Date('2026-09-01');
  const stale = request({
    status: 'quoted',
    quoteExpiresAt: new Date('2026-08-15'),
    lines: [line({ quotedPrice: usd(45000) })],
  });

  // The status still reads "quoted" because no job has touched the row — and a
  // buyer must not be able to accept a stale price because of that.
  assert.equal(isQuoteExpired(stale, now), true);
  assert.equal(canAccept(stale, now).ok, false);
  assert.match(canAccept(stale, now).reason, /expired/);

  const live = { ...stale, quoteExpiresAt: new Date('2026-09-15') };
  assert.equal(isQuoteExpired(live, now), false);
  assert.equal(canAccept(live, now).ok, true);
});

test('only a quoted request can be accepted', () => {
  const now = new Date('2026-08-10');
  assert.equal(canAccept(request({ status: 'submitted' }), now).ok, false);
  assert.equal(canAccept(request({ status: 'declined' }), now).ok, false);
});

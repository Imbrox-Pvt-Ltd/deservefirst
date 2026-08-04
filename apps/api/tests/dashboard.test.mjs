/**
 * Tests · dashboard.test.mjs
 * Dashboard composition.
 *
 * Three filters decide whether a card appears, and each removes a different
 * kind of "should not be here": the module must be available to this store, the
 * viewer must hold the permission, and the metric must resolve. Getting any of
 * them wrong shows a merchant a number they are not entitled to, or hides one
 * they are — and a dashboard is exactly where nobody checks.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DashboardService } from '../dist/core/dashboard/dashboard.service.js';

const WIDGETS = [
  { moduleId: 'catalog', item: { id: 'catalog.active', label: 'Active products', slot: 'home', permission: 'catalog.read', size: 'small', metric: 'active', position: 20 } },
  { moduleId: 'orders', item: { id: 'orders.queue', label: 'Awaiting a quote', slot: 'home', permission: 'orders.read', size: 'small', metric: 'queue', position: 10 } },
  { moduleId: 'catalog', item: { id: 'catalog.deep', label: 'Deep analysis', slot: 'analytics', permission: 'catalog.read', size: 'small', metric: 'active' } },
  { moduleId: 'orders', item: { id: 'orders.broken', label: 'Broken', slot: 'home', permission: 'orders.read', size: 'small', metric: 'explodes', position: 30 } },
  { moduleId: 'orders', item: { id: 'orders.nometric', label: 'No metric', slot: 'home', permission: 'orders.read', size: 'small', position: 40 } },
];

const registry = { dashboards: () => WIDGETS };

const providers = [
  { moduleId: 'catalog', metrics: { active: async () => 6 } },
  {
    moduleId: 'orders',
    metrics: {
      queue: async () => 1,
      explodes: async () => {
        throw new Error('stock counting fell over');
      },
    },
  },
];

const build = (available = async () => true) =>
  new DashboardService({ registry, providers, isModuleAvailable: available });

const labels = (widgets) => widgets.map((widget) => widget.label);
const ALL = new Set(['catalog.read', 'orders.read']);

test('widgets are composed from the modules that declared them', async () => {
  const widgets = await build().compose('home', 'store-1', ALL);

  // Sorted by declared position, so the queue a merchant works through is first.
  assert.deepEqual(labels(widgets), ['Awaiting a quote', 'Active products', 'Broken', 'No metric']);
  assert.equal(widgets[0].value, 1);
  assert.equal(widgets[1].value, 6);
});

test('only the requested slot is returned', async () => {
  const analytics = await build().compose('analytics', 'store-1', ALL);
  assert.deepEqual(labels(analytics), ['Deep analysis']);
});

test('an unknown slot is empty rather than an error', async () => {
  assert.deepEqual(await build().compose('nowhere', 'store-1', ALL), []);
});

test('a widget the viewer cannot read is not returned at all', async () => {
  const widgets = await build().compose('home', 'store-1', new Set(['catalog.read']));

  assert.deepEqual(labels(widgets), ['Active products']);
  // Not merely hidden in the UI: the value never leaves the server.
  assert.equal(JSON.stringify(widgets).includes('Awaiting'), false);
});

test('a module unavailable to this store contributes nothing', async () => {
  const widgets = await build(async (_store, moduleId) => moduleId !== 'orders').compose(
    'home',
    'store-1',
    ALL,
  );

  assert.deepEqual(labels(widgets), ['Active products']);
});

test('availability is asked per store, not once', async () => {
  const asked = [];
  const service = build(async (storeId, moduleId) => {
    asked.push(`${storeId}:${moduleId}`);
    return storeId === 'store-1';
  });

  assert.equal((await service.compose('home', 'store-1', ALL)).length, 4);
  assert.equal((await service.compose('home', 'store-2', ALL)).length, 0);
  assert.ok(asked.includes('store-2:catalog'));
});

test('one failing metric does not take the dashboard down', async () => {
  const widgets = await build().compose('home', 'store-1', ALL);
  const broken = widgets.find((widget) => widget.label === 'Broken');

  assert.equal(broken.value, null);
  assert.match(broken.unavailable, /stock counting fell over/);
  // The others still resolved.
  assert.equal(widgets.find((widget) => widget.label === 'Active products').value, 6);
});

test('a widget with no metric says so rather than showing zero', async () => {
  const widgets = await build().compose('home', 'store-1', ALL);
  const empty = widgets.find((widget) => widget.label === 'No metric');

  assert.equal(empty.value, null);
  assert.match(empty.unavailable, /declares no metric/);
});

test('a declared metric the module does not supply is named, not silently zero', async () => {
  const service = new DashboardService({
    registry,
    providers: [{ moduleId: 'orders', metrics: {} }],
    isModuleAvailable: async () => true,
  });

  const widgets = await service.compose('home', 'store-1', new Set(['orders.read']));
  const queue = widgets.find((widget) => widget.label === 'Awaiting a quote');

  assert.equal(queue.value, null);
  assert.match(queue.unavailable, /supplies no "queue" metric/);
});

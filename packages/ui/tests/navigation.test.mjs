/**
 * UI · tests/navigation.test.mjs
 * The navigation composer. These pin the two ways the menu went wrong in
 * practice — a module's entry appearing twice, and a module's entry losing the
 * reference icon — because both render as "the menu is broken" long before
 * anyone traces them to a merge rule.
 * Layer: ui/tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertNavigationParents,
  composeNavigation,
  coreNavigation,
} from '../dist/navigation.js';

const HANDLE = 'acme-us';

const GRANTS = new Set([
  'store.read', 'catalog.read', 'catalog.write', 'orders.read',
  'customers.read', 'inventory.read', 'content.read',
]);

const primary = (sections) => sections.find((section) => section.id === 'primary');
const itemOf = (sections, id) => primary(sections).items.find((item) => item.id === id);
const childOf = (sections, parentId, id) =>
  (itemOf(sections, parentId).children ?? []).find((child) => child.id === id);

test('a module nests its entry under the reference parent it names', () => {
  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 22,
        parentId: 'products',
        item: {
          id: 'inventory',
          label: 'Inventory',
          path: `/store/${HANDLE}/products/inventory`,
          permission: 'inventory.read',
        },
      },
    ],
    GRANTS,
  );

  assert.equal(childOf(sections, 'products', 'inventory').label, 'Inventory');
  // ...and does NOT also appear beside Products. Both showing was the bug.
  assert.equal(itemOf(sections, 'inventory'), undefined);
});

test('a contributed entry claims the reference slot rather than duplicating it', () => {
  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 10,
        item: {
          id: 'orders',
          label: 'Requests',
          path: `/store/${HANDLE}/requests`,
          permission: 'orders.read',
        },
      },
    ],
    GRANTS,
  );

  const matching = primary(sections).items.filter((item) => item.id === 'orders');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].label, 'Requests');
  assert.equal(matching[0].path, `/store/${HANDLE}/requests`);
});

test('claiming a slot clears its "not in this install" marker', () => {
  const before = itemOf(coreNavigation(HANDLE), 'markets');
  assert.equal(before.unavailable, true);

  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 50,
        item: {
          id: 'markets',
          label: 'Markets',
          path: `/store/${HANDLE}/markets`,
          permission: 'store.read',
        },
      },
    ],
    GRANTS,
  );

  assert.equal(itemOf(sections, 'markets').unavailable, false);
});

test('a contributed entry without an icon keeps the reference icon', () => {
  // A DTO round-trip turns "no icon" into an explicit `undefined`, and a plain
  // spread let that erase the glyph — every module-owned section lost its icon
  // and rendered at child indentation.
  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 30,
        item: {
          id: 'customers',
          label: 'Customers',
          path: `/store/${HANDLE}/customers`,
          permission: 'customers.read',
          icon: undefined,
        },
      },
    ],
    GRANTS,
  );

  assert.equal(itemOf(sections, 'customers').icon, 'customers');
});

test('a module may override the reference icon when it means to', () => {
  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 30,
        item: {
          id: 'customers',
          label: 'Customers',
          path: `/store/${HANDLE}/customers`,
          permission: 'customers.read',
          icon: 'agentic',
        },
      },
    ],
    GRANTS,
  );

  assert.equal(itemOf(sections, 'customers').icon, 'agentic');
});

test('claiming a parent keeps children contributed by other modules', () => {
  const sections = composeNavigation(
    HANDLE,
    [
      {
        section: 'primary',
        position: 20,
        item: {
          id: 'products',
          label: 'Products',
          path: `/store/${HANDLE}/products`,
          permission: 'catalog.read',
        },
      },
      {
        section: 'primary',
        position: 21,
        parentId: 'products',
        item: {
          id: 'collections',
          label: 'Collections',
          path: `/store/${HANDLE}/collections`,
          permission: 'catalog.read',
        },
      },
    ],
    GRANTS,
  );

  assert.equal(childOf(sections, 'products', 'collections').label, 'Collections');
  assert.equal(childOf(sections, 'products', 'gift-cards').unavailable, true);
});

test('an entry is hidden when its permission is not granted', () => {
  const sections = composeNavigation(HANDLE, [], new Set(['store.read']));
  assert.equal(itemOf(sections, 'products'), undefined);
  assert.ok(itemOf(sections, 'home'));
});

test('a child may be hidden while its parent stays visible', () => {
  const sections = composeNavigation(
    HANDLE,
    [],
    new Set(['store.read', 'catalog.read']),
  );

  assert.ok(itemOf(sections, 'products'));
  assert.ok(childOf(sections, 'products', 'collections'));
  // inventory.read was not granted.
  assert.equal(childOf(sections, 'products', 'inventory'), undefined);
});

test('nesting under an unknown parent fails the boot rather than moving the entry', () => {
  assert.throws(
    () =>
      assertNavigationParents(HANDLE, [
        {
          section: 'primary',
          position: 1,
          parentId: 'prodcuts',
          item: { id: 'inventory', label: 'Inventory', path: '/x', permission: 'inventory.read' },
        },
      ]),
    /parentId "prodcuts"/,
  );
});

test('one module may nest under another module\'s entry', () => {
  assert.doesNotThrow(() =>
    assertNavigationParents(HANDLE, [
      {
        section: 'primary',
        position: 1,
        item: { id: 'claims', label: 'Claims', path: '/a', permission: 'store.read' },
      },
      {
        section: 'primary',
        position: 2,
        parentId: 'claims',
        item: { id: 'appeals', label: 'Appeals', path: '/b', permission: 'store.read' },
      },
    ]),
  );
});

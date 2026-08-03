/**
 * Contracts · tests/list-query.test.mjs
 * Pins the list-state URL encoding captured from the reference product, so any
 * change to it is a deliberate decision rather than an accident (§12.6, §8.5).
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseFilterQuery,
  parseListQuery,
  serializeFilterQuery,
  serializeListQuery,
} from '../dist/index.js';

test('parses the filter-token syntax', () => {
  const { text, filters } = parseFilterQuery('status:active tag:sale vendor:"Hydrogen Vendor" branzino');
  assert.equal(text, 'branzino');
  assert.deepEqual(filters, [
    { field: 'status', operator: ':', value: 'active' },
    { field: 'tag', operator: ':', value: 'sale' },
    { field: 'vendor', operator: ':', value: 'Hydrogen Vendor' },
  ]);
});

test('supports comparison operators', () => {
  const { filters } = parseFilterQuery('created_at:>2026-01-01 price:<=100 status:!archived');
  assert.deepEqual(filters.map((f) => [f.field, f.operator, f.value]), [
    ['created_at', ':>', '2026-01-01'],
    ['price', ':<=', '100'],
    ['status', ':!', 'archived'],
  ]);
});

test('round-trips a filter query, quoting values that need it', () => {
  const original = 'vendor:"Hydrogen Vendor" status:active branzino';
  const { text, filters } = parseFilterQuery(original);
  const serialized = serializeFilterQuery(text, filters);
  assert.equal(serialized, 'vendor:"Hydrogen Vendor" status:active branzino');
});

test('reads the exact URL shape the reference product emits', () => {
  const params = new URLSearchParams(
    'savedViewId=2172477178142&query=vendor%3A%22Hydrogen+Vendor%22&order=created_at+desc&selectedColumns=IMAGE%2CTITLE%2CSTATUS',
  );
  const query = parseListQuery(params);

  assert.equal(query.savedViewId, '2172477178142');
  assert.deepEqual(query.sort, { field: 'created_at', direction: 'desc' });
  assert.deepEqual(query.columns, ['IMAGE', 'TITLE', 'STATUS']);
  assert.deepEqual(query.filters, [{ field: 'vendor', operator: ':', value: 'Hydrogen Vendor' }]);
  assert.equal(query.limit, DEFAULT_PAGE_SIZE);
});

test('a default view serializes to a clean URL', () => {
  const params = serializeListQuery(parseListQuery(new URLSearchParams()));
  assert.equal(params.toString(), '');
});

test('clamps page size to the documented ceiling', () => {
  assert.equal(parseListQuery(new URLSearchParams('limit=9999')).limit, MAX_PAGE_SIZE);
  assert.equal(parseListQuery(new URLSearchParams('limit=0')).limit, 1);
  assert.equal(parseListQuery(new URLSearchParams('limit=abc')).limit, DEFAULT_PAGE_SIZE);
});

test('carries transient dialog and row-peek state', () => {
  const query = parseListQuery(new URLSearchParams('selected=42&dialog=archive'));
  assert.equal(query.selectedId, '42');
  assert.equal(query.dialog, 'archive');
  assert.equal(serializeListQuery(query).toString(), 'selected=42&dialog=archive');
});

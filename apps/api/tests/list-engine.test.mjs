/**
 * Core · tests/list-engine.test.mjs
 * The list engine is inherited by every screen, so a bug here is a bug
 * everywhere. These pin the two properties that matter most: every statement is
 * tenant-scoped, and every value is a bound parameter.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseListQuery } from '@deservefirst/contracts';

import {
  compileCountQuery,
  compileListQuery,
  decodeCursor,
  encodeCursor,
  UnknownFilterFieldError,
  UnknownSortFieldError,
} from '../dist/core/list-engine/index.js';

const resource = {
  name: 'Product',
  entity: 'Product',
  pluralName: 'Products',
  urlSegment: 'products',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'title', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'vendor', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'status', type: 'enum', filterable: true, values: ['draft', 'active'] },
    { name: 'price', type: 'money', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'internalNote', type: 'string', visibility: 'internal' },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail'],
  permissions: { read: 'catalog.read', write: 'catalog.write' },
};

const compile = (search, extra = {}) =>
  compileListQuery({
    resource,
    tableName: 'products',
    storeId: 'store-1',
    query: parseListQuery(new URLSearchParams(search)),
    ...extra,
  });

test('every query is store-scoped as its first predicate', () => {
  const compiled = compile('');
  assert.match(compiled.sql, /WHERE "store_id" = \$1/);
  assert.equal(compiled.parameters[0], 'store-1');
});

test('soft-deleted rows are invisible unless explicitly requested', () => {
  assert.match(compile('').sql, /"deleted_at" IS NULL/);
  assert.doesNotMatch(compile('', { includeDeleted: true }).sql, /"deleted_at" IS NULL/);
});

test('filter values are bound parameters, never interpolated', () => {
  const compiled = compile('query=' + encodeURIComponent('vendor:"Acme Corp" status:active'));
  assert.ok(!compiled.sql.includes('Acme'), 'value must not appear in the SQL text');
  assert.ok(compiled.parameters.includes('Acme Corp'));
  assert.ok(compiled.parameters.includes('active'));
});

test('an injection attempt travels as data, not as SQL', () => {
  const compiled = compile('query=' + encodeURIComponent(`vendor:"'; DROP TABLE products; --"`));
  assert.ok(!compiled.sql.includes('DROP TABLE'));
  assert.ok(compiled.parameters.some((value) => String(value).includes('DROP TABLE')));
});

test('text equality is case-insensitive because users do not think in case', () => {
  assert.match(compile('query=vendor%3Aacme').sql, /lower\("vendor"\) = lower\(\$\d+\)/);
});

test('comparison operators map to SQL', () => {
  // Money compares on its integer amount column, never on the currency —
  // ordering by currency is meaningless and filtering it would match nothing.
  assert.match(compile('query=price%3A%3E100').sql, /"price_amount_minor" > \$/);
  assert.match(compile('query=price%3A%3C%3D50').sql, /"price_amount_minor" <= \$/);
  assert.match(compile('query=status%3A%21archived').sql, /"status" <> \$/);
});

test('free text searches only the declared searchable fields', () => {
  const compiled = compile('query=branzino');
  assert.match(compiled.sql, /"title" ILIKE \$\d+ OR "vendor" ILIKE \$\d+/);
  assert.ok(compiled.parameters.includes('%branzino%'));
  // status is filterable but not searchable, so it must not appear here.
  assert.doesNotMatch(compiled.sql, /"status" ILIKE/);
});

test('filtering or sorting on an undeclared field is refused', () => {
  assert.throws(() => compile('query=secret%3Ayes'), UnknownFilterFieldError);
  assert.throws(() => compile('order=internalNote+asc'), UnknownSortFieldError);
});

test('ordering is always total — the id breaks ties', () => {
  const compiled = compile('order=title asc');
  assert.match(compiled.sql, /ORDER BY "title" ASC, "id" ASC/);
});

test('sort defaults to newest first', () => {
  assert.match(compile('').sql, /ORDER BY "created_at" DESC, "id" DESC/);
});

test('camelCase field names map to snake_case columns', () => {
  assert.match(compile('order=createdAt asc').sql, /ORDER BY "created_at" ASC/);
});

test('one extra row is fetched so a next page can be detected', () => {
  assert.equal(compile('limit=25').limit, 26);
  assert.match(compile('limit=25').sql, /LIMIT 26/);
});

test('page size is clamped to the documented ceiling', () => {
  assert.equal(compile('limit=100000').limit, 251);
});

test('a cursor becomes a keyset predicate, not an offset', () => {
  const cursor = encodeCursor({ sortValue: '2026-01-01T00:00:00.000Z', id: 'p-42' });
  const compiled = compile(`after=${cursor}&order=createdAt desc`);
  assert.match(compiled.sql, /\("created_at", "id"\) < \(\$\d+, \$\d+\)/);
  assert.ok(!compiled.sql.includes('OFFSET'), 'offset pagination is never emitted');
  assert.ok(compiled.parameters.includes('p-42'));
});

test('cursor direction flips with sort direction', () => {
  const cursor = encodeCursor({ sortValue: 'a', id: '1' });
  assert.match(compile(`after=${cursor}&order=title asc`).sql, /\("title", "id"\) > /);
  assert.match(compile(`after=${cursor}&order=title desc`).sql, /\("title", "id"\) < /);
});

test('a malformed cursor returns the first page instead of throwing', () => {
  assert.equal(decodeCursor('not-a-cursor'), null);
  const compiled = compile('after=not-a-cursor');
  assert.doesNotMatch(compiled.sql, /\("created_at", "id"\)/);
});

test('cursors round-trip', () => {
  const position = { sortValue: '2026-08-04T12:00:00.000Z', id: 'gid-99' };
  assert.deepEqual(decodeCursor(encodeCursor(position)), position);
});

test('column selection always includes id and the sort column', () => {
  const compiled = compile('selectedColumns=title&order=vendor asc');
  assert.match(compiled.sql, /SELECT [^\n]*"id"/);
  assert.match(compiled.sql, /"vendor"/);
  assert.match(compiled.sql, /"title"/);
});

test('unknown requested columns are ignored rather than injected', () => {
  const compiled = compile('selectedColumns=title,"; DROP TABLE x; --');
  assert.ok(!compiled.sql.includes('DROP TABLE'));
});

test('the count query reuses the same predicates and parameters', () => {
  const options = {
    resource,
    tableName: 'products',
    storeId: 'store-1',
    query: parseListQuery(new URLSearchParams('query=vendor%3Aacme')),
  };
  const counted = compileCountQuery(options);
  assert.match(counted.sql, /SELECT COUNT\(\*\)::int AS total/);
  assert.match(counted.sql, /"store_id" = \$1/);
  assert.ok(counted.parameters.includes('store-1'));
  assert.ok(!counted.sql.includes('ORDER BY'));
});

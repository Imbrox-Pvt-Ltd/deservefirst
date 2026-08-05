/**
 * Storefront · tests/resource-search.test.mjs
 * What a theme setting may point at, and what a merchant may search for.
 *
 * The allow-list is the interesting half. The type arrives in a query string
 * and decides which table is read, so a value that slipped through would turn a
 * settings panel into a way to read any table in the database.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isSearchableType,
  normaliseSearchTerm,
  SEARCH_LIMIT,
  SEARCHABLE_TYPES,
} from '../../../dist/storefront/domain/index.js';

test('every searchable type is one a theme setting actually uses', () => {
  // Kept in step with `SettingInput`'s picker types by hand; a type listed here
  // that no setting produces is a table exposed for nothing.
  assert.deepEqual([...SEARCHABLE_TYPES].sort(), [
    'article', 'blog', 'collection', 'link_list', 'page', 'product',
  ]);
});

test('only the declared types are searchable', () => {
  for (const type of SEARCHABLE_TYPES) assert.equal(isSearchableType(type), true, type);
});

test('anything else is refused, including things that look close', () => {
  /**
   * The refusals that matter. `users` and `sessions` are real tables; the rest
   * are attempts to reach one through the type parameter.
   */
  for (const type of [
    'users',
    'sessions',
    'products',        // the TABLE name, not the setting type
    'store_domains',
    "' OR 1=1 --",
    'product; DROP TABLE users',
    '../products',
    '',
    null,
    undefined,
    42,
    ['product'],
    { type: 'product' },
  ]) {
    assert.equal(isSearchableType(type), false, JSON.stringify(type));
  }
});

test('a search term keeps its meaning as text, not as a pattern', () => {
  /**
   * `%` and `_` are wildcards in SQL LIKE. A merchant searching for "50%_off"
   * means those characters — left alone, the first would match every record in
   * the table, which reads as a picker that ignores what you typed.
   */
  assert.equal(normaliseSearchTerm('50%_off'), '50\\%\\_off');
  assert.equal(normaliseSearchTerm('back\\slash'), 'back\\\\slash');
  assert.equal(normaliseSearchTerm('linen shirt'), 'linen shirt');
});

test('a term is trimmed and bounded', () => {
  assert.equal(normaliseSearchTerm('   linen   '), 'linen');
  // A megabyte pasted into a type-ahead should cost a truncation, not a query
  // plan.
  assert.equal(normaliseSearchTerm('a'.repeat(5000)).length, 100);
  assert.equal(normaliseSearchTerm(null), '');
  assert.equal(normaliseSearchTerm(undefined), '');
});

test('the result limit is small enough to read', () => {
  // A picker is for finding one thing. A list long enough to scroll is one a
  // merchant searches again rather than reads.
  assert.ok(SEARCH_LIMIT > 0 && SEARCH_LIMIT <= 50, String(SEARCH_LIMIT));
});

// ------------------------------------------------- the handles a list names

import { parseHandles, RESOLVE_LIMIT } from '../../../dist/storefront/domain/index.js';

test('the order a list asks for is the order it gets back', () => {
  /**
   * A list setting's order IS the layout — it is what the row renders left to
   * right. Returning database order would silently rearrange a merchant's
   * homepage the next time they opened the panel.
   */
  assert.deepEqual(parseHandles('c,a,b'), ['c', 'a', 'b']);
});

test('duplicates collapse and blanks are ignored', () => {
  // A list rendering the same product twice is a mistake, not an instruction.
  assert.deepEqual(parseHandles('a,a,,b, ,a'), ['a', 'b']);
  assert.deepEqual(parseHandles(''), []);
  assert.deepEqual(parseHandles(null), []);
});

test('handles are trimmed, because a list is pasted as often as typed', () => {
  assert.deepEqual(parseHandles(' a , b '), ['a', 'b']);
});

test('a crafted request cannot turn one lookup into a table scan', () => {
  // A featured-products row is six, not six hundred.
  const many = Array.from({ length: 5000 }, (_, i) => `h${i}`).join(',');
  assert.equal(parseHandles(many).length, RESOLVE_LIMIT);
});

/**
 * Core · tests/bind.test.mjs
 * Keeping SQL parameters in the order their placeholders are written.
 *
 * This helper exists because the same mistake happened twice, and the second
 * time nothing reported it. `dialect.placeholder(index)` returns `$1` on
 * Postgres and `?` on MySQL — so on Postgres reusing an index reuses a value,
 * and on MySQL every `?` consumes the NEXT value regardless of the number.
 *
 * The first occurrence was a count mismatch, which MySQL called a syntax error.
 * The second had matching counts and simply shuffled the values, putting a
 * timestamp in a `source_ref` column. Nothing complained at all.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Binder, countPlaceholders } from '../../../dist/core/database/bind.js';

/** The two dialects, as they actually behave. */
const mysql = { placeholder: () => '?', quoteIdentifier: (n) => `\`${n}\`` };
const postgres = { placeholder: (i) => `$${i}`, quoteIdentifier: (n) => `"${n}"` };

test('parameters come out in the order their placeholders were written', () => {
  const bind = new Binder(mysql);
  const sql = `UPDATE t SET a = ${bind.add('A')}, b = ${bind.add('B')} WHERE c = ${bind.add('C')}`;

  assert.equal(sql, 'UPDATE t SET a = ?, b = ? WHERE c = ?');
  assert.deepEqual(bind.finish(sql).parameters, ['A', 'B', 'C']);
});

test('a value used twice is passed twice', () => {
  /**
   * The bug itself. Writing `p(1)` in two places is one value on Postgres and
   * two consumed values on MySQL — so the only portable answer is to pass it
   * twice and let the binder emit two placeholders.
   */
  const bind = new Binder(mysql);
  const id = 'thm_1';
  const sql =
    `UPDATE t SET role = CASE WHEN id = ${bind.add(id)} THEN 'main' ELSE 'draft' END, ` +
    `ref = CASE WHEN id = ${bind.add(id)} THEN ${bind.add('v_1')} ELSE ref END`;

  assert.deepEqual(bind.finish(sql).parameters, ['thm_1', 'thm_1', 'v_1']);
});

test('it numbers correctly on a positional dialect too', () => {
  const bind = new Binder(postgres);
  const sql = `SELECT * FROM t WHERE a = ${bind.add(1)} AND b = ${bind.add(2)}`;

  assert.equal(sql, 'SELECT * FROM t WHERE a = $1 AND b = $2');
  assert.deepEqual(bind.finish(sql).parameters, [1, 2]);
});

test('addAll produces one placeholder per value', () => {
  const bind = new Binder(mysql);
  const sql = `DELETE FROM t WHERE id IN (${bind.addAll(['a', 'b', 'c'])})`;

  assert.equal(sql, 'DELETE FROM t WHERE id IN (?, ?, ?)');
  assert.deepEqual(bind.finish(sql).parameters, ['a', 'b', 'c']);
});

test('a placeholder written by hand is caught', () => {
  /**
   * The other half of the bug class. A fragment with a literal `?` shifts every
   * parameter after it by one, which is silent until somebody reads a column
   * and finds a date in it.
   */
  const bind = new Binder(mysql);
  const sql = `UPDATE t SET a = ${bind.add('A')}, b = ? WHERE c = ${bind.add('C')}`;

  assert.throws(
    () => bind.finish(sql),
    /3 placeholders and 2 values/,
  );
});

test('a question mark inside a string is data, not a placeholder', () => {
  // Otherwise this helper would reject a correct statement.
  assert.equal(countPlaceholders("SELECT * FROM t WHERE note LIKE '%?%'"), 0);
  assert.equal(countPlaceholders("SELECT * FROM t WHERE a = ? AND note LIKE '%?%'"), 1);
});

test('it counts both dialects', () => {
  assert.equal(countPlaceholders('a = ? AND b = ?'), 2);
  assert.equal(countPlaceholders('a = $1 AND b = $2'), 2);
  assert.equal(countPlaceholders('a = 1'), 0);
});

test('a backtick-quoted identifier containing a question mark is not counted', () => {
  // Contrived, and exactly the sort of thing that makes a naive count wrong.
  assert.equal(countPlaceholders('SELECT `weird?column` FROM t WHERE a = ?'), 1);
});

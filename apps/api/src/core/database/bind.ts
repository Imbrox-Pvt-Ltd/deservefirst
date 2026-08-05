/**
 * Core · database/bind.ts
 * Building SQL where the parameters cannot get out of order.
 *
 * This exists because the same bug happened twice in a week, and the second
 * time it was almost invisible.
 *
 * The dialect exposes `placeholder(index)`, which returns `$1` on Postgres and
 * `?` on MySQL. On Postgres the index means something and reusing one reuses a
 * value; on MySQL the index is decoration and **every `?` consumes the next
 * parameter in textual order**. So a statement written as
 *
 *     WHEN id = ${p(1)} THEN ${p(2)} ... WHEN id = ${p(1)} THEN ${p(3)}
 *
 * is correct on one dialect and silently wrong on the other — the second `p(1)`
 * takes whatever value came next, and a timestamp ends up in a `source_ref`
 * column. The first time this happened it was a mismatched count, which MySQL
 * reported as a syntax error. The second time the counts matched and the values
 * were simply shuffled, which nothing reports at all.
 *
 * A binder removes the choice: a value is appended as the fragment that needs
 * it is written, so textual order and parameter order are the same thing by
 * construction, and a value used twice is passed twice.
 * Layer: core (framework-free).
 */

import type { SqlDialect } from '../list-engine/dialect';

export interface BoundStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * Collects parameters in the order their placeholders are written.
 *
 * Deliberately not a query builder. It does one thing — keep the two lists in
 * step — and leaves the SQL as SQL, which stays greppable and reviewable.
 */
export class Binder {
  private readonly values: unknown[] = [];

  constructor(private readonly dialect: SqlDialect) {}

  /** A placeholder for this value, appended in order. */
  add(value: unknown): string {
    this.values.push(value);
    return this.dialect.placeholder(this.values.length);
  }

  /** Placeholders for a list, e.g. for an `IN (...)`. */
  addAll(values: readonly unknown[]): string {
    return values.map((value) => this.add(value)).join(', ');
  }

  get parameters(): readonly unknown[] {
    return this.values;
  }

  /**
   * Pairs the SQL with its parameters, checking they agree.
   *
   * The count check is cheap and catches the other half of this bug class: a
   * fragment written with a literal `?` rather than through `add`, which would
   * shift every parameter after it by one.
   */
  finish(sql: string): BoundStatement {
    const placeholders = countPlaceholders(sql);
    if (placeholders !== this.values.length) {
      throw new Error(
        `This statement has ${placeholders} placeholders and ${this.values.length} values. ` +
          'Every placeholder must come from Binder.add, in the order it appears.',
      );
    }
    return { sql, parameters: this.values };
  }
}

/**
 * Counts placeholders outside string literals.
 *
 * A `?` inside a quoted string is data — `WHERE note LIKE '%?%'` has none — and
 * counting it would make this helper reject a correct statement.
 */
export function countPlaceholders(sql: string): number {
  let count = 0;
  let quote: string | null = null;

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];

    if (quote) {
      if (character === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '?') count++;
    // Postgres `$1`, `$2`, …
    if (character === '$' && /\d/.test(sql[index + 1] ?? '')) count++;
  }

  return count;
}

/**
 * An executor that can report how many rows a write touched.
 *
 * `QueryExecutor` only promises `query`, which returns ROWS. A MySQL driver
 * answers an UPDATE with a result header rather than rows, so reading
 * `affectedRows` off what `query` returns reads it off an array — which is
 * `undefined`, every time. That bug shipped once: a cross-tenant triage was
 * correctly refused and cheerfully reported as succeeding, because the code
 * decided the outcome from a number that was never there.
 *
 * So a write that needs to know what it touched asks for this explicitly, and
 * an executor that cannot answer is refused up front rather than guessed at.
 * The platform does not pretend a write worked.
 */
export interface WritableExecutor {
  execute(sql: string, parameters: readonly unknown[]): Promise<{ affectedRows: number }>;
}

/**
 * Narrows an executor to one that can count its writes, or explains why not.
 *
 * `purpose` names the operation so the failure says which one cannot be
 * verified, rather than reporting a missing method somewhere in the platform.
 */
export function writerFor(executor: unknown, purpose: string): WritableExecutor {
  const candidate = executor as Partial<WritableExecutor>;
  if (typeof candidate.execute !== 'function') {
    throw new Error(
      `This executor cannot report affected rows, so ${purpose} cannot be verified.`,
    );
  }
  return candidate as WritableExecutor;
}

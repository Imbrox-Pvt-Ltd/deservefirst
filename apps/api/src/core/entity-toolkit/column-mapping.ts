/**
 * Core · entity-toolkit/column-mapping.ts
 * The single mapping from a declared field to its physical column(s). Both the
 * schema builder and the query compiler read it, so they cannot disagree about
 * how a field is stored.
 *
 * They previously did disagree: money was one column to the compiler and two to
 * the schema builder, which produced SQL naming a column that did not exist. A
 * shared mapping is the structural fix; two careful implementations is not.
 * Layer: core.
 */

import type { FieldDefinition } from '@deservefirst/contracts';

export function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Money is stored as an exact integer amount plus its currency — never one
 * column, because a lone DECIMAL loses the currency and invites float maths
 * (§15.2).
 */
export function moneyColumnNames(fieldName: string): { amount: string; currency: string } {
  const base = snakeCase(fieldName);
  return { amount: `${base}_amount_minor`, currency: `${base}_currency` };
}

/** Every physical column a declared field occupies. */
export function physicalColumnsFor(field: Pick<FieldDefinition, 'name' | 'type'>): string[] {
  if (field.type === 'money') {
    const { amount, currency } = moneyColumnNames(field.name);
    return [amount, currency];
  }
  return [snakeCase(field.name)];
}

/**
 * The column a field is compared and ordered by. For money that is the integer
 * amount: ordering by currency would be meaningless, and comparing a filter
 * value against the currency column would silently match nothing.
 */
export function comparableColumnFor(field: Pick<FieldDefinition, 'name' | 'type'>): string {
  if (field.type === 'money') return moneyColumnNames(field.name).amount;
  return snakeCase(field.name);
}

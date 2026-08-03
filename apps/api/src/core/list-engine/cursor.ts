/**
 * Core · list-engine/cursor.ts
 * Cursor pagination, everywhere, never offset (§13.6, §30.3). Offset pagination
 * degrades linearly with depth and silently skips or repeats rows when the
 * underlying data shifts between pages — both unacceptable at scale.
 * Layer: core.
 */

export interface CursorPosition {
  /** The sort field's value at this row, as a string for stable encoding. */
  readonly sortValue: string;
  /** The row id, breaking ties so the ordering is total rather than partial. */
  readonly id: string;
}

/**
 * Base64url so a cursor survives a query string untouched. It is opaque by
 * intent — clients must not construct or reason about one.
 */
export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.sortValue, position.id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [sortValue, id] = decoded;
    if (typeof sortValue !== 'string' || typeof id !== 'string') return null;
    return { sortValue, id };
  } catch {
    // A malformed cursor is a client error, not a server one: treat it as absent
    // and return the first page rather than throwing a 500.
    return null;
  }
}

export function cursorFor(row: Record<string, unknown>, sortField: string, idField = 'id'): string {
  const raw = row[sortField];
  const id = String(row[idField] ?? '');
  return encodeCursor({ sortValue: serializeSortValue(raw), id });
}

/**
 * Normalises a sort value so the encoded cursor compares the same way the
 * database does — dates as ISO, nulls as empty, everything else as-is.
 */
export function serializeSortValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

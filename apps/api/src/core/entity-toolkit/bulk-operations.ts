/**
 * Core · entity-toolkit/bulk-operations.ts
 * Bulk selection, the generic bulk editor, and CSV import/export (§12.1, §12.5).
 * One implementation serves every entity — the reference product's bulk editor
 * is a single route parameterised by which fields are editable, and this is the
 * engine behind ours.
 * Layer: core.
 */

import type { ListQuery, ResourceDefinition, StoreId } from '@deservefirst/contracts';

/**
 * A selection is either explicit ids or "everything matching the current
 * filters". The second form matters: a merchant selecting 40,000 rows must not
 * send 40,000 ids, and the count may change between selection and execution.
 */
export type BulkSelection =
  | { readonly kind: 'ids'; readonly ids: readonly string[] }
  | { readonly kind: 'all-matching'; readonly query: ListQuery };

export interface BulkOperation {
  readonly id: string;
  readonly storeId: StoreId;
  readonly entity: string;
  readonly action: string;
  readonly selection: BulkSelection;
  readonly status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly processedCount: number;
  readonly failedCount: number;
  readonly totalCount: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly errorSummary: string | null;
}

/**
 * Anything above this runs as a background job with progress rather than
 * blocking a request. Below it, inline is faster and simpler for the merchant.
 */
export const BULK_INLINE_THRESHOLD = 50;

export function shouldRunInBackground(selection: BulkSelection): boolean {
  return selection.kind === 'all-matching' || selection.ids.length > BULK_INLINE_THRESHOLD;
}

// --- CSV --------------------------------------------------------------------

/**
 * RFC 4180 quoting. Hand-rolled because the rules are small and exact, and a
 * dependency here would be a supply-chain risk for a fifteen-line function.
 */
export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsvRow(values: readonly unknown[]): string {
  return values.map(toCsvValue).join(',');
}

export function buildCsv(
  headers: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [toCsvRow(headers)];
  for (const row of rows) {
    lines.push(toCsvRow(headers.map((header) => row[header])));
  }
  return lines.join('\r\n');
}

/**
 * Parses one CSV line, honouring quoted fields containing commas, quotes and
 * newlines. Splitting on comma is the classic import bug — a product described
 * as "Blue, large" silently becomes two columns.
 */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = splitCsvLines(text).filter((line) => line.trim().length > 0);
  const [headerLine, ...rest] = lines;
  if (!headerLine) return { headers: [], rows: [] };

  const headers = parseCsvLine(headerLine).map((header) => header.trim());
  const rows = rest.map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });

  return { headers, rows };
}

/** Splits on newlines that are not inside a quoted field. */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Columns offered by the CSV export for a resource — declared, not guessed. */
export function exportHeaders(resource: ResourceDefinition): string[] {
  return resource.fields
    .filter((field) => field.visibility !== 'internal')
    .map((field) => field.name);
}

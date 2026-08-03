/**
 * Core · entity-toolkit/timeline.ts
 * Per-record activity: comments, and the audit trail of who changed what when
 * (§12.1, §28.1). Store admins see exactly who did what in their store, on the
 * record itself rather than in a separate log nobody opens.
 * Layer: core.
 */

import type { StoreId, UserId } from '@deservefirst/contracts';

export type TimelineEntryKind = 'comment' | 'change' | 'event' | 'system';

export interface TimelineEntry {
  readonly id: string;
  readonly storeId: StoreId;
  readonly ownerEntity: string;
  readonly ownerId: string;
  readonly kind: TimelineEntryKind;
  readonly actorId: UserId | null;
  readonly actorLabel: string;
  readonly message: string;
  readonly changes: readonly FieldChange[];
  readonly occurredAt: Date;
}

export interface FieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

/**
 * Audit events are a compliance artifact, not ordinary logs: append-only and
 * tamper-evident (§28.3). Nothing in the platform offers an update or delete.
 */
export interface AuditEvent {
  readonly id: string;
  readonly storeId: StoreId | null;
  readonly actorId: UserId | null;
  readonly actorType: string;
  readonly action: string;
  readonly resourceEntity: string;
  readonly resourceId: string;
  readonly requestId: string | null;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}

/**
 * Computes the field-level diff recorded on a record's timeline. Only fields
 * that actually changed are kept — a diff full of unchanged values is noise that
 * makes the real change harder to find.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  trackedFields: readonly string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of trackedFields) {
    const from = before[field];
    const to = after[field];
    if (!valuesEqual(from, to)) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Fields whose values must never reach a timeline or audit payload. A change
 * record that quotes the old and new password has turned an audit feature into
 * a credential leak.
 */
const REDACTED_FIELDS = new Set([
  'password', 'password_hash', 'secret', 'token', 'access_token',
  'refresh_token', 'api_key', 'client_secret', 'card_number', 'cvv',
]);

export function redactChanges(changes: readonly FieldChange[]): FieldChange[] {
  return changes.map((change) =>
    REDACTED_FIELDS.has(change.field.toLowerCase())
      ? { field: change.field, from: '[redacted]', to: '[redacted]' }
      : change,
  );
}

export function describeChange(change: FieldChange): string {
  const from = change.from === null || change.from === undefined ? 'empty' : String(change.from);
  const to = change.to === null || change.to === undefined ? 'empty' : String(change.to);
  return `changed ${change.field} from ${from} to ${to}`;
}

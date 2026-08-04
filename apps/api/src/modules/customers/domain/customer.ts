/**
 * Customers · domain/customer.ts
 * The Customer aggregate and segment rules. A customer is a *shopper*, distinct
 * from the User in the auth module who is staff — conflating them is the mistake
 * that makes "delete this customer" accidentally revoke someone's admin access.
 * Layer: domain (pure).
 */

import type { Money } from '@deservefirst/contracts';

export type CustomerState = 'disabled' | 'invited' | 'active' | 'declined';

/** Explicit consent state. "Unknown" is not "yes" — that distinction is the law. */
export type MarketingConsent = 'subscribed' | 'not-subscribed' | 'pending' | 'unknown';

export interface Address {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly company: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly countryCode: string;
  readonly postalCode: string | null;
  readonly phone: string | null;
}

export interface Customer {
  readonly id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly state: CustomerState;
  readonly emailConsent: MarketingConsent;
  readonly smsConsent: MarketingConsent;
  readonly locale: string;
  readonly note: string | null;
  readonly taxExempt: boolean;
  readonly defaultAddress: Address | null;
  readonly addresses: readonly Address[];
  /** Denormalised for list and segment performance; recomputed from orders. */
  readonly ordersCount: number;
  readonly totalSpent: Money;
  readonly version: number;
}

export class CustomerInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`Customer ${field}: ${detail}`);
    this.name = 'CustomerInvariantError';
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertCustomerValid(customer: Customer): void {
  // A customer with neither an email nor a phone cannot be contacted, notified
  // or deduplicated — it is a record with no way back to a person.
  if (!customer.email && !customer.phone) {
    throw new CustomerInvariantError('contact', 'needs an email address or a phone number');
  }
  if (customer.email && !EMAIL_PATTERN.test(customer.email)) {
    throw new CustomerInvariantError('email', 'is not a valid address');
  }
  if (customer.totalSpent.amountMinor < 0n) {
    throw new CustomerInvariantError('totalSpent', 'cannot be negative');
  }
  if (customer.ordersCount < 0) {
    throw new CustomerInvariantError('ordersCount', 'cannot be negative');
  }

  for (const address of customer.addresses) {
    assertAddressValid(address);
  }
}

export function assertAddressValid(address: Address): void {
  if (address.line1.trim().length === 0) {
    throw new CustomerInvariantError('address', 'needs a street address');
  }
  if (address.city.trim().length === 0) {
    throw new CustomerInvariantError('address', 'needs a city');
  }
  if (!/^[A-Z]{2}$/.test(address.countryCode)) {
    throw new CustomerInvariantError('address', 'needs a two-letter ISO country code');
  }
}

/** Emails normalise so one shopper does not become two records. */
export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether the store may send marketing. Only an explicit subscription counts —
 * treating "unknown" or "pending" as consent is how a platform earns a fine.
 */
export function canEmailMarketing(customer: Customer): boolean {
  return customer.emailConsent === 'subscribed' && customer.email !== null;
}

export function canSmsMarketing(customer: Customer): boolean {
  return customer.smsConsent === 'subscribed' && customer.phone !== null;
}

export function displayName(customer: Customer): string {
  const full = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return customer.email ?? customer.phone ?? 'No name';
}

// --- segments ---------------------------------------------------------------

export type SegmentField =
  | 'ordersCount'
  | 'totalSpent'
  | 'emailConsent'
  | 'state'
  | 'countryCode'
  | 'tag';

export type SegmentOperator = 'equals' | 'notEquals' | 'greaterThan' | 'lessThan';

export interface SegmentCondition {
  readonly field: SegmentField;
  readonly operator: SegmentOperator;
  readonly value: string;
}

export interface Segment {
  readonly id: string;
  readonly name: string;
  readonly match: 'all' | 'any';
  readonly conditions: readonly SegmentCondition[];
}

const NUMERIC_SEGMENT_FIELDS = new Set<SegmentField>(['ordersCount', 'totalSpent']);

export function assertSegmentValid(segment: Segment): void {
  if (segment.name.trim().length === 0) {
    throw new CustomerInvariantError('segment', 'needs a name');
  }
  if (segment.conditions.length === 0) {
    throw new CustomerInvariantError('segment', 'needs at least one condition');
  }
  for (const condition of segment.conditions) {
    if (
      (condition.operator === 'greaterThan' || condition.operator === 'lessThan') &&
      !NUMERIC_SEGMENT_FIELDS.has(condition.field)
    ) {
      throw new CustomerInvariantError(
        'segment',
        `"${condition.operator}" only applies to numeric fields, not "${condition.field}"`,
      );
    }
  }
}

export function matchesSegment(customer: Customer, segment: Segment, tags: readonly string[] = []): boolean {
  const results = segment.conditions.map((condition) => {
    switch (condition.field) {
      case 'ordersCount':
        return compareNumber(customer.ordersCount, condition);
      case 'totalSpent':
        // Compared in exact minor units, never a formatted amount.
        return compareNumber(Number(customer.totalSpent.amountMinor), condition);
      case 'emailConsent':
        return compareText(customer.emailConsent, condition);
      case 'state':
        return compareText(customer.state, condition);
      case 'countryCode':
        return compareText(customer.defaultAddress?.countryCode ?? '', condition);
      case 'tag': {
        const has = tags.some((tag) => tag.toLowerCase() === condition.value.toLowerCase());
        return condition.operator === 'notEquals' ? !has : has;
      }
    }
  });

  return segment.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function compareNumber(actual: number, condition: SegmentCondition): boolean {
  const expected = Number(condition.value);
  switch (condition.operator) {
    case 'equals': return actual === expected;
    case 'notEquals': return actual !== expected;
    case 'greaterThan': return actual > expected;
    case 'lessThan': return actual < expected;
  }
}

function compareText(actual: string, condition: SegmentCondition): boolean {
  const matches = actual.toLowerCase() === condition.value.toLowerCase();
  return condition.operator === 'notEquals' ? !matches : matches;
}

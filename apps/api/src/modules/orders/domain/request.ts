/**
 * Orders · domain/request.ts
 * The Request aggregate — a buyer's inquiry, not a sale.
 *
 * ADR 0001 D10 defers checkout, payment and tax to a later phase, and this
 * module is what makes that a real product rather than a gap. A Request carries
 * lines, quantities and quoted prices; it has no payment state, no tax, and no
 * fulfilment, because §25.1 is right that those four light up together and half
 * of them is worse than none.
 *
 * The deliberate omission is the design. A `paid` flag here would invite exactly
 * the half-built checkout the phasing exists to prevent.
 * Layer: domain (pure).
 */

import { addMoney, type Money, money, multiplyMoney } from '@deservefirst/contracts';

/**
 * A request moves forward through quoting and ends in one of three terminal
 * states. There is no `paid` — taking money is Phase 2.
 */
export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'quoted'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface RequestLine {
  readonly id: string;
  /** References a catalog product through its published contract, never its tables. */
  readonly productId: string;
  readonly variantId: string | null;
  /** Captured at the time of request so a later price change does not rewrite history. */
  readonly title: string;
  readonly sku: string | null;
  readonly quantity: number;
  /** What the catalog listed when the buyer asked. */
  readonly listPrice: Money;
  /** What the merchant is offering. Null until quoted. */
  readonly quotedPrice: Money | null;
  readonly note: string | null;
}

export interface Request {
  readonly id: string;
  /** Human-facing reference, e.g. "RFQ-1001". */
  readonly reference: string;
  readonly customerId: string | null;
  readonly contactEmail: string | null;
  readonly contactName: string | null;
  readonly status: RequestStatus;
  readonly currency: string;
  readonly lines: readonly RequestLine[];
  readonly note: string | null;
  readonly internalNote: string | null;
  /** Set when quoted; a quote that never expires is a price list. */
  readonly quoteExpiresAt: Date | null;
  readonly submittedAt: Date | null;
  readonly respondedAt: Date | null;
  readonly version: number;
}

export class RequestInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`Request ${field}: ${detail}`);
    this.name = 'RequestInvariantError';
  }
}

export const MAX_LINES = 250;
export const MAX_QUANTITY = 1_000_000;

export function assertRequestValid(request: Request): void {
  // A request nobody can be reached about cannot be quoted.
  if (!request.customerId && !request.contactEmail) {
    throw new RequestInvariantError('contact', 'needs a customer or a contact email address');
  }
  if (request.lines.length === 0 && request.status !== 'draft') {
    throw new RequestInvariantError('lines', 'a submitted request needs at least one line');
  }
  if (request.lines.length > MAX_LINES) {
    throw new RequestInvariantError('lines', `at most ${MAX_LINES} lines`);
  }

  for (const line of request.lines) {
    assertLineValid(line, request.currency);
  }

  const references = new Set<string>();
  for (const line of request.lines) {
    const key = `${line.productId}:${line.variantId ?? ''}`;
    if (references.has(key)) {
      throw new RequestInvariantError('lines', 'the same product appears twice — merge the quantities instead');
    }
    references.add(key);
  }

  if (request.status === 'quoted' && request.quoteExpiresAt === null) {
    throw new RequestInvariantError('quoteExpiresAt', 'a quote must have an expiry — an open-ended quote is a price list');
  }
}

function assertLineValid(line: RequestLine, currency: string): void {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new RequestInvariantError('lines', `quantity for "${line.title}" must be a whole number of at least 1`);
  }
  if (line.quantity > MAX_QUANTITY) {
    throw new RequestInvariantError('lines', `quantity for "${line.title}" is implausible`);
  }
  if (line.listPrice.currency !== currency) {
    throw new RequestInvariantError('lines', `"${line.title}" is priced in ${line.listPrice.currency}, not ${currency}`);
  }
  if (line.quotedPrice && line.quotedPrice.currency !== currency) {
    throw new RequestInvariantError('lines', `the quote for "${line.title}" is in a different currency`);
  }
  if (line.listPrice.amountMinor < 0n) {
    throw new RequestInvariantError('lines', `"${line.title}" cannot have a negative price`);
  }
  if (line.quotedPrice && line.quotedPrice.amountMinor < 0n) {
    throw new RequestInvariantError('lines', `the quote for "${line.title}" cannot be negative`);
  }
}

const ALLOWED: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['quoted', 'declined', 'cancelled'],
  quoted: ['accepted', 'declined', 'expired', 'cancelled'],
  // Terminal. An accepted request becomes an order in Phase 2; it does not
  // reopen, because reopening after acceptance is how a quoted price silently
  // changes underneath a buyer.
  accepted: [],
  declined: [],
  expired: [],
  cancelled: [],
};

export function assertTransitionAllowed(from: RequestStatus, to: RequestStatus): void {
  if (from === to) return;
  if (!ALLOWED[from].includes(to)) {
    throw new RequestInvariantError('status', `cannot move from ${from} to ${to}`);
  }
}

export function isTerminal(status: RequestStatus): boolean {
  return ALLOWED[status].length === 0;
}

/**
 * What the buyer would pay if they accepted. Quoted prices win over list prices
 * line by line — a partially quoted request shows the merchant's offer where one
 * exists and the list price where it does not.
 *
 * This is a SUBTOTAL, deliberately: no tax, no shipping, no discounts. Naming it
 * `total` would imply a completeness this phase does not have.
 */
export function subtotal(request: Request): Money {
  return request.lines.reduce(
    (sum, line) => addMoney(sum, multiplyMoney(line.quotedPrice ?? line.listPrice, line.quantity)),
    money(0n, request.currency),
  );
}

/** What the buyer originally asked about, for showing the size of a discount. */
export function listSubtotal(request: Request): Money {
  return request.lines.reduce(
    (sum, line) => addMoney(sum, multiplyMoney(line.listPrice, line.quantity)),
    money(0n, request.currency),
  );
}

export function totalQuantity(request: Request): number {
  return request.lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** Every line has an offer, so the request can be sent as a complete quote. */
export function isFullyQuoted(request: Request): boolean {
  return request.lines.length > 0 && request.lines.every((line) => line.quotedPrice !== null);
}

export function canSendQuote(request: Request): { ok: true } | { ok: false; reason: string } {
  if (request.status !== 'submitted') {
    return { ok: false, reason: `Only a submitted request can be quoted; this one is ${request.status}.` };
  }
  if (!isFullyQuoted(request)) {
    return { ok: false, reason: 'Every line needs a price before the quote can be sent.' };
  }
  return { ok: true };
}

/**
 * A quote past its expiry is expired whatever the stored status says — the
 * status is only updated when something touches the record, and a buyer must
 * never be able to accept a stale price because a job had not run yet.
 */
export function isQuoteExpired(request: Request, now: Date): boolean {
  if (request.status !== 'quoted' || !request.quoteExpiresAt) return false;
  return request.quoteExpiresAt.getTime() <= now.getTime();
}

export function canAccept(request: Request, now: Date): { ok: true } | { ok: false; reason: string } {
  if (request.status !== 'quoted') {
    return { ok: false, reason: 'Only a quoted request can be accepted.' };
  }
  if (isQuoteExpired(request, now)) {
    return { ok: false, reason: 'This quote has expired. Ask for a new one.' };
  }
  return { ok: true };
}

/** Sequential, human-facing reference. Ids are opaque; people quote numbers. */
export function buildReference(prefix: string, sequence: number): string {
  return `${prefix}${sequence}`;
}

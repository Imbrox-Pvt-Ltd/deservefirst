/**
 * Orders · application/request-service.ts
 * Use-cases for the Request aggregate. Lines are loaded, saved and authorised
 * through the request — never addressed independently, because a line without
 * its request has no currency, no status and no buyer (§14.3).
 * Layer: application.
 */

import {
  toDecimalString,
  type Connection,
  type ListQuery,
  type Money,
  type StoreId,
} from '@deservefirst/contracts';

import {
  assertRequestValid,
  assertTransitionAllowed,
  buildReference,
  canAccept,
  canSendQuote,
  subtotal,
  isQuoteExpired,
  isTerminal,
  type Request,
  RequestInvariantError,
  type RequestLine,
} from '../domain';
import { ORDER_EVENTS } from '../events';

export interface RequestRepository {
  findById(id: string): Promise<Request | null>;
  list(query: ListQuery): Promise<Connection<Request>>;
  nextSequence(): Promise<number>;
  insert(request: Request): Promise<Request>;
  update(request: Request, expectedVersion: number): Promise<Request>;
}

export interface RequestPorts {
  newId(): string;
  now(): Date;
  emit(eventType: string, payload: Record<string, unknown>): Promise<void>;
  recordTimeline(input: {
    ownerId: string;
    message: string;
    changes: readonly { field: string; from: unknown; to: unknown }[];
  }): Promise<void>;
  /** Store settings, read through Core rather than a local copy. */
  setting<T>(key: string, fallback: T): Promise<T>;
  /**
   * Runs whatever third parties deployed at an extension point (§22.3).
   *
   * Optional so the module works with no Functions tier wired up — a module
   * that could not be constructed without one would be a module whose tests all
   * need a WebAssembly runtime.
   */
  runFunctionPoint?(
    point: string,
    input: unknown,
  ): Promise<{ allowed: boolean; reasons: readonly string[] }>;
}

export interface AddLineInput {
  readonly productId: string;
  readonly variantId?: string | null;
  readonly title: string;
  readonly sku?: string | null;
  readonly quantity: number;
  readonly listPrice: Money;
  readonly note?: string | null;
}

export class RequestNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No request with id "${id}" in this store.`);
    this.name = 'RequestNotFoundError';
  }
}

export class RequestService {
  constructor(
    private readonly repository: RequestRepository,
    private readonly ports: RequestPorts,
    private readonly storeId: StoreId,
  ) {}

  async list(query: ListQuery): Promise<Connection<Request>> {
    return this.repository.list(query);
  }

  /**
   * Reads a request, lazily expiring a quote whose validity has passed. Doing it
   * on read rather than only in a scheduled job means a buyer can never accept a
   * stale price because the job had not run yet.
   */
  async get(id: string): Promise<Request> {
    const request = await this.repository.findById(id);
    if (!request) throw new RequestNotFoundError(id);

    if (isQuoteExpired(request, this.ports.now())) {
      return this.transition(request, 'expired', 'the quote expired');
    }
    return request;
  }

  async create(input: {
    customerId?: string | null;
    contactEmail?: string | null;
    contactName?: string | null;
    currency: string;
    note?: string | null;
  }): Promise<Request> {
    const prefix = await this.ports.setting('requestPrefix', 'RFQ-');
    const sequence = await this.repository.nextSequence();

    const request: Request = {
      id: this.ports.newId(),
      reference: buildReference(prefix, sequence),
      customerId: input.customerId ?? null,
      contactEmail: input.contactEmail ?? null,
      contactName: input.contactName ?? null,
      status: 'draft',
      currency: input.currency,
      lines: [],
      note: input.note ?? null,
      internalNote: null,
      quoteExpiresAt: null,
      submittedAt: null,
      respondedAt: null,
      version: 1,
    };

    assertRequestValid(request);
    const saved = await this.repository.insert(request);
    await this.ports.recordTimeline({ ownerId: saved.id, message: 'created this request', changes: [] });
    return saved;
  }

  /**
   * Adds a line, or increases the quantity when the same product is already
   * present. Two lines for one product would split the quantity and let a
   * merchant quote the same item twice at different prices.
   */
  async addLine(id: string, input: AddLineInput, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    this.assertMutable(request);

    const key = `${input.productId}:${input.variantId ?? ''}`;
    const existing = request.lines.find((line) => `${line.productId}:${line.variantId ?? ''}` === key);

    const lines: RequestLine[] = existing
      ? request.lines.map((line) =>
          line === existing ? { ...line, quantity: line.quantity + input.quantity } : line,
        )
      : [
          ...request.lines,
          {
            id: this.ports.newId(),
            productId: input.productId,
            variantId: input.variantId ?? null,
            title: input.title,
            sku: input.sku ?? null,
            quantity: input.quantity,
            listPrice: input.listPrice,
            // A new line is unquoted; adding one to a quoted request reopens it.
            quotedPrice: null,
            note: input.note ?? null,
          },
        ];

    return this.saveLines(request, lines, expectedVersion, existing ? 'increased a quantity' : `added ${input.title}`);
  }

  async removeLine(id: string, lineId: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    this.assertMutable(request);

    const line = request.lines.find((entry) => entry.id === lineId);
    if (!line) throw new RequestInvariantError('lines', 'no such line on this request');

    return this.saveLines(
      request,
      request.lines.filter((entry) => entry.id !== lineId),
      expectedVersion,
      `removed ${line.title}`,
    );
  }

  /** Prices one line. Quoting is per line so a merchant can offer partially. */
  async quoteLine(id: string, lineId: string, price: Money, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    this.assertMutable(request);

    if (price.currency !== request.currency) {
      throw new RequestInvariantError('lines', `the quote must be in ${request.currency}`);
    }

    const lines = request.lines.map((line) =>
      line.id === lineId ? { ...line, quotedPrice: price } : line,
    );
    if (lines.every((line, index) => line === request.lines[index])) {
      throw new RequestInvariantError('lines', 'no such line on this request');
    }

    return this.saveLines(request, lines, expectedVersion, 'priced a line');
  }

  /**
   * Records who is asking, before the request leaves their hands.
   *
   * Only while it is still mutable. Contact details on a submitted request are
   * a different act — a merchant correcting an address — and would need to be
   * audited as one rather than accepted from whoever holds the draft's token.
   *
   * Kept apart from `submit` on purpose: the details have to be on the row
   * BEFORE the event fires, because a merchant notified about a request with no
   * way to reply to it is worse off than one not notified at all.
   */
  async setContact(
    id: string,
    input: {
      contactEmail: string;
      contactName: string | null;
      note: string | null;
      /** The contact list entry this enquiry belongs to, if one was made. */
      customerId?: string | null;
    },
    expectedVersion: number,
  ): Promise<Request> {
    const request = await this.get(id);
    this.assertMutable(request);

    const next: Request = {
      ...request,
      contactEmail: input.contactEmail,
      contactName: input.contactName,
      note: input.note,
      /**
       * Only ever set, never cleared.
       *
       * A request already linked to a customer must not become anonymous
       * because a later call omitted the id — the link is how a merchant sees
       * that the same person has asked before.
       */
      customerId: input.customerId ?? request.customerId,
      version: request.version + 1,
    };

    assertRequestValid(next);
    const saved = await this.repository.update(next, expectedVersion);
    /**
     * The email is deliberately not in the timeline message.
     *
     * A timeline is read by staff and exported; repeating a customer's address
     * into it puts personal data somewhere nobody thought to look for it when
     * a deletion request arrives.
     */
    await this.ports.recordTimeline({
      ownerId: saved.id,
      message: 'added contact details',
      changes: [],
    });
    return saved;
  }

  async submit(id: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    assertTransitionAllowed(request.status, 'submitted');

    const next: Request = {
      ...request,
      status: 'submitted',
      submittedAt: this.ports.now(),
      version: request.version + 1,
    };
    assertRequestValid(next);

    const saved = await this.repository.update(next, expectedVersion);
    await this.ports.recordTimeline({ ownerId: saved.id, message: 'submitted this request', changes: [] });
    await this.ports.emit(ORDER_EVENTS.requestSubmitted, {
      requestId: saved.id,
      reference: saved.reference,
      customerId: saved.customerId,
      lineCount: saved.lines.length,
    });
    return saved;
  }

  /** Sends the quote. Refuses unless every line carries a price. */
  async sendQuote(id: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    const verdict = canSendQuote(request);
    if (!verdict.ok) throw new RequestInvariantError('status', verdict.reason);

    /**
     * Whatever the merchant's installed apps deployed at this point.
     *
     * After the module's own rules, not before: a request that this platform
     * would refuse anyway should never reach a third party's code, and running
     * it first would leak the shape of invalid requests to every installed app.
     *
     * The point is declared `onFailure: 'allow'`, so a function that traps or
     * times out does not stop the merchant quoting. That decision lives on the
     * declaration in the manifest rather than here.
     */
    const extensions = await this.ports.runFunctionPoint?.('orders.quote.validate', {
      requestId: request.id,
      subtotal: {
        amount: toDecimalString(subtotal(request)),
        currency: subtotal(request).currency,
      },
      lines: request.lines.length,
    });

    if (extensions && !extensions.allowed) {
      throw new RequestInvariantError('quote', extensions.reasons.join(' '));
    }

    const validityDays = await this.ports.setting('quoteValidityDays', 14);
    const expiresAt = new Date(this.ports.now().getTime() + validityDays * 24 * 60 * 60 * 1000);

    const next: Request = {
      ...request,
      status: 'quoted',
      quoteExpiresAt: expiresAt,
      respondedAt: this.ports.now(),
      version: request.version + 1,
    };
    assertRequestValid(next);

    const saved = await this.repository.update(next, expectedVersion);
    await this.ports.recordTimeline({
      ownerId: saved.id,
      message: `sent a quote, valid until ${expiresAt.toISOString().slice(0, 10)}`,
      changes: [],
    });
    await this.ports.emit(ORDER_EVENTS.requestQuoted, {
      requestId: saved.id,
      reference: saved.reference,
      subtotalAmountMinor: subtotal(saved).amountMinor.toString(),
      currency: saved.currency,
    });
    return saved;
  }

  /**
   * Accepting ends this module's involvement. Phase 2 turns the event into an
   * order; there is deliberately nothing here about payment.
   */
  async accept(id: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    const verdict = canAccept(request, this.ports.now());
    if (!verdict.ok) throw new RequestInvariantError('status', verdict.reason);

    const saved = await this.transitionAndSave(request, 'accepted', 'accepted the quote', expectedVersion);
    await this.ports.emit(ORDER_EVENTS.requestAccepted, {
      requestId: saved.id,
      reference: saved.reference,
      subtotalAmountMinor: subtotal(saved).amountMinor.toString(),
      currency: saved.currency,
    });
    return saved;
  }

  async decline(id: string, reason: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    const saved = await this.transitionAndSave(request, 'declined', `declined: ${reason}`, expectedVersion);
    await this.ports.emit(ORDER_EVENTS.requestDeclined, {
      requestId: saved.id,
      reference: saved.reference,
      reason,
    });
    return saved;
  }

  async cancel(id: string, expectedVersion: number): Promise<Request> {
    const request = await this.get(id);
    return this.transitionAndSave(request, 'cancelled', 'cancelled this request', expectedVersion);
  }

  // --- helpers --------------------------------------------------------------

  private assertMutable(request: Request): void {
    if (isTerminal(request.status)) {
      throw new RequestInvariantError('status', `a ${request.status} request cannot be changed`);
    }
  }

  private async saveLines(
    request: Request,
    lines: readonly RequestLine[],
    expectedVersion: number,
    message: string,
  ): Promise<Request> {
    // Changing the lines invalidates any quote already sent — otherwise the
    // buyer holds a price for a basket that no longer exists.
    const reopened = request.status === 'quoted';

    const next: Request = {
      ...request,
      lines,
      ...(reopened ? { status: 'submitted' as const, quoteExpiresAt: null } : {}),
      version: request.version + 1,
    };
    assertRequestValid(next);

    const saved = await this.repository.update(next, expectedVersion);
    await this.ports.recordTimeline({
      ownerId: saved.id,
      message: reopened ? `${message} — the sent quote is no longer valid` : message,
      changes: [],
    });
    return saved;
  }

  private async transitionAndSave(
    request: Request,
    to: Request['status'],
    message: string,
    expectedVersion: number,
  ): Promise<Request> {
    assertTransitionAllowed(request.status, to);
    const next: Request = {
      ...request,
      status: to,
      respondedAt: this.ports.now(),
      version: request.version + 1,
    };
    const saved = await this.repository.update(next, expectedVersion);
    await this.ports.recordTimeline({
      ownerId: saved.id,
      message,
      changes: [{ field: 'status', from: request.status, to }],
    });
    return saved;
  }

  /** Used by `get` to expire lazily; writes with the version it just read. */
  private async transition(request: Request, to: Request['status'], message: string): Promise<Request> {
    return this.transitionAndSave(request, to, message, request.version);
  }

  get scope(): StoreId {
    return this.storeId;
  }
}

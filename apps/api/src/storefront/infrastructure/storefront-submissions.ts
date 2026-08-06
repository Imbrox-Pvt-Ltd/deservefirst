/**
 * Storefront · infrastructure/storefront-submissions.ts
 * What happens to an enquiry once the storefront has admitted one.
 *
 * An adapter, and the direction of the dependency is the point: the storefront
 * declares a port and this fulfils it using whatever the platform has. The
 * storefront never learns that a quote request is a `Request` in the orders
 * module, so the day that changes, this file changes and nothing else does.
 *
 * A quote request goes through the module's own service rather than its
 * repository — `create`, `addLine`, `submit`. Writing the rows directly would
 * skip the reference sequence, the timeline entry and the
 * `orders.request.submitted` event, and a merchant would find a request in
 * their queue that no notification ever mentioned.
 *
 * And it is **submitted**, not left as a draft. A draft sits invisible: the
 * customer believes they asked for a quote and the merchant never sees one.
 * Layer: infrastructure.
 */

import { money } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import type { StorefrontSubmissions } from '../api/storefront-ports';

/**
 * The slice of the orders module this needs.
 *
 * Declared structurally rather than imported as a class, so the storefront's
 * adapter does not depend on the orders module's construction — the
 * composition root already owns one and hands it over.
 */
export interface QuoteRequests {
  create(input: {
    contactEmail?: string | null;
    contactName?: string | null;
    currency: string;
    note?: string | null;
  }): Promise<{ id: string; reference: string; version: number }>;

  addLine(
    id: string,
    input: {
      productId: string;
      title: string;
      quantity: number;
      listPrice: { amountMinor: bigint; currency: string };
      note?: string | null;
    },
    expectedVersion: number,
  ): Promise<{ id: string; version: number }>;

  submit(id: string, expectedVersion: number): Promise<{ reference: string }>;

  /** Attaches who is asking, before the request leaves the shopper's hands. */
  setContact(
    id: string,
    input: {
      contactEmail: string;
      contactName: string | null;
      note: string | null;
      customerId?: string | null;
    },
    expectedVersion: number,
  ): Promise<{ id: string; version: number }>;
}

/**
 * The contact list, as this needs it.
 *
 * `identify` rather than `create`: a shopper enquiring for the second time is
 * not a duplicate to be refused, they are somebody the merchant has heard from
 * before — which is the whole value of keeping the list.
 */
export interface EnquiringCustomers {
  identify(input: { email: string; name?: string | null }): Promise<{ id: string }>;
}

/** Looking up the product a quote is about. */
export interface ProductLookup {
  byId(productId: string): Promise<{ id: string; title: string; priceAmountMinor: string | null } | null>;
}

export class SqlStorefrontSubmissions implements StorefrontSubmissions {
  constructor(
    private readonly requests: QuoteRequests,
    private readonly products: ProductLookup,
    private readonly customers: EnquiringCustomers,
    private readonly executor: QueryExecutor,
    private readonly newId: () => string,
    private readonly currency: string,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  /**
   * Sends a draft the shopper assembled themselves.
   *
   * Two steps and they cannot be merged: the contact details have to be on the
   * row BEFORE it is submitted, because submitting is what notifies the
   * merchant and a notification about a request with no way to reply is worse
   * than none.
   *
   * The version comes from the caller, which read it with the draft. If
   * somebody added a line between that read and this write, the update is
   * refused rather than silently overwriting — a request submitted without the
   * last thing a shopper added is exactly the kind of error nobody discovers
   * until the goods arrive.
   */
  async submitRequest(input: {
    readonly requestId: string;
    readonly version: number;
    readonly contactEmail: string;
    readonly contactName: string | null;
    readonly message: string | null;
  }): Promise<{ readonly reference: string }> {
    /**
     * The person is recorded before the request is, and a failure here does not
     * stop the enquiry.
     *
     * A merchant losing a contact-list entry is a smaller harm than a shopper
     * losing the request they just spent time assembling — so this is allowed
     * to fail quietly and leave `customerId` null, which is exactly what the
     * column already meant.
     */
    const customer = await this.customers
      .identify({ email: input.contactEmail, name: input.contactName })
      .catch(() => null);

    const withContact = await this.requests.setContact(
      input.requestId,
      {
        contactEmail: input.contactEmail,
        contactName: input.contactName,
        // The customer's own message — the public note, never the internal one.
        note: input.message,
        customerId: customer?.id ?? null,
      },
      input.version,
    );

    return this.requests.submit(withContact.id, withContact.version);
  }

  async requestQuote(input: {
    readonly contactEmail: string;
    readonly contactName: string | null;
    readonly message: string | null;
    readonly productId: string | null;
    readonly quantity: number;
  }): Promise<{ readonly reference: string }> {
    const request = await this.requests.create({
      contactEmail: input.contactEmail,
      contactName: input.contactName,
      currency: this.currency,
      // The customer's own message, which is the public `note` — never the
      // internal one staff write.
      note: input.message,
    });

    let version = request.version;

    if (input.productId) {
      /**
       * The price comes from the catalogue, never from the form.
       *
       * The quantity is the customer's to choose; the price is not. A list
       * price posted from a browser would let anyone name their own, and a
       * merchant reading the quote would have no way to tell.
       */
      const product = await this.products.byId(input.productId);
      if (product) {
        const line = await this.requests.addLine(
          request.id,
          {
            productId: product.id,
            title: product.title,
            quantity: input.quantity,
            listPrice: money(BigInt(product.priceAmountMinor ?? '0'), this.currency),
          },
          version,
        );
        version = line.version;
      }
      /**
       * A product that no longer exists does not lose the enquiry.
       *
       * Somebody wants to buy something and got as far as asking. A request
       * with a note and no line is one a merchant can answer; a discarded one
       * is a customer who thinks they asked.
       */
    }

    /**
     * Submitted, so it lands in the merchant's queue.
     *
     * A draft would sit where nobody looks — the customer believing they asked
     * for a quote and the merchant never seeing one.
     */
    const submitted = await this.requests.submit(request.id, version);
    return { reference: submitted.reference };
  }

  async contact(input: {
    readonly email: string;
    readonly name: string | null;
    readonly body: string;
    readonly sourcePath?: string | null;
  }): Promise<void> {
    const storeId = requireStoreContext('storefront.contact').storeId;

    /**
     * One placeholder per value, and the timestamp passed twice.
     *
     * Reusing `p(6)` for both timestamps produced seven placeholders and six
     * values — which a positional dialect would have caught and a `?` dialect
     * reported as a syntax error near the end of the statement. Found by
     * submitting a real form, not by reading.
     */
    const now = new Date();
    await this.executor.query(
      `INSERT INTO ${this.q('contact_messages')}
         (${this.q('id')}, ${this.q('store_id')}, ${this.q('email')}, ${this.q('name')},
          ${this.q('body')}, ${this.q('source_path')}, ${this.q('status')}, ${this.q('version')},
          ${this.q('created_at')}, ${this.q('updated_at')})
       VALUES (${this.p(1)}, ${this.p(2)}, ${this.p(3)}, ${this.p(4)}, ${this.p(5)}, ${this.p(6)},
               'new', 1, ${this.p(7)}, ${this.p(8)})`,
      [this.newId(), storeId, input.email, input.name, input.body, input.sourcePath ?? null, now, now],
    );
  }
}

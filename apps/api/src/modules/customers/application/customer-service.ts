/**
 * Customers · application/customer-service.ts
 * Use-cases for the Customer aggregate. Consent changes are their own operation
 * rather than an ordinary field update, because a consent change is a legally
 * meaningful event that must be recorded with its before and after (§20.2).
 * Layer: application.
 */

import { type Connection, type ListQuery, money, type StoreId } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  assertCustomerValid,
  type Customer,
  CustomerInvariantError,
  type MarketingConsent,
  normalizeCustomerEmail,
} from '../domain';
import { CUSTOMER_EVENTS } from '../events';

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  list(query: ListQuery): Promise<Connection<Customer>>;
  insert(customer: Customer): Promise<Customer>;
  update(customer: Customer, expectedVersion: number): Promise<Customer>;
  softDelete(id: string): Promise<void>;
}

/** Core's toolkit ports; declared once there rather than per module (§32). */
export type CustomerPorts = ToolkitPorts;

export interface CreateCustomerInput {
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly locale?: string;
  readonly note?: string | null;
  /** Defaults to "unknown" — never to subscribed. */
  readonly emailConsent?: MarketingConsent;
}

export class CustomerNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No customer with id "${id}" in this store.`);
    this.name = 'CustomerNotFoundError';
  }
}

export class DuplicateCustomerError extends Error {
  readonly status = 409;
  constructor(readonly email: string) {
    super(`A customer with the email "${email}" already exists in this store.`);
    this.name = 'DuplicateCustomerError';
  }
}

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly ports: CustomerPorts,
    private readonly storeId: StoreId,
  ) {}

  async list(query: ListQuery): Promise<Connection<Customer>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) throw new CustomerNotFoundError(id);
    return customer;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const email = input.email ? normalizeCustomerEmail(input.email) : null;

    // One shopper, one record. Silently creating a duplicate makes order history
    // and marketing consent split across two identities.
    if (email && (await this.repository.findByEmail(email))) {
      throw new DuplicateCustomerError(email);
    }

    const customer: Customer = {
      id: this.ports.newId(),
      email,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      state: 'disabled',
      // Consent is never assumed. A staff-created customer has not opted in.
      emailConsent: input.emailConsent ?? 'unknown',
      smsConsent: 'unknown',
      locale: input.locale ?? 'en-US',
      note: input.note ?? null,
      taxExempt: false,
      defaultAddress: null,
      addresses: [],
      ordersCount: 0,
      totalSpent: money(0n, 'USD'),
      version: 1,
    };

    assertCustomerValid(customer);
    const saved = await this.repository.insert(customer);

    await this.ports.recordTimeline({
      ownerId: saved.id,
      message: 'created this customer',
      changes: [],
    });
    await this.ports.emit(CUSTOMER_EVENTS.created, { customerId: saved.id, email: saved.email });

    return saved;
  }

  /**
   * The person behind an enquiry, created if this is the first time.
   *
   * Phase 1 is request-only (§25): a shopper leaves an email with a request and
   * never signs in. Without this a merchant receiving three enquiries from the
   * same address sees three unrelated rows and no customer at all — which is
   * the difference between a contact list and a pile of forms.
   *
   * Deliberately NOT `create`. That refuses a duplicate, correctly, because
   * staff adding a customer who already exists have made a mistake. A shopper
   * enquiring twice has not.
   *
   * Consent is never touched, on either path. Leaving an email to ask a
   * question is not subscribing to anything, and a new record here is created
   * `unknown` while an existing one keeps whatever it already had — an enquiry
   * must not be able to resubscribe somebody who opted out.
   */
  async identify(input: { email: string; name?: string | null }): Promise<Customer> {
    const email = normalizeCustomerEmail(input.email);

    const existing = await this.repository.findByEmail(email);
    if (existing) return existing;

    const name = (input.name ?? '').trim();

    return this.create({
      email,
      /**
       * The whole name as given, never split.
       *
       * We were handed one field and have no way to know which part of it is a
       * family name — plenty of names do not divide into two at a space, and
       * guessing renders somebody's name back to them wrong. The request itself
       * carries the name they typed; this is a copy for the contact list.
       */
      firstName: name === '' ? null : name,
    });
  }

  /**
   * Consent changes are their own operation. Folding them into a generic update
   * would lose the before/after pair that a compliance question needs answering
   * with, and would let a bulk edit change consent by accident.
   */
  async changeConsent(input: {
    id: string;
    channel: 'email' | 'sms';
    to: MarketingConsent;
    expectedVersion: number;
  }): Promise<Customer> {
    const existing = await this.get(input.id);
    const from = input.channel === 'email' ? existing.emailConsent : existing.smsConsent;

    if (input.to === 'subscribed') {
      const reachable = input.channel === 'email' ? existing.email : existing.phone;
      if (!reachable) {
        throw new CustomerInvariantError(
          input.channel,
          `cannot subscribe without ${input.channel === 'email' ? 'an email address' : 'a phone number'}`,
        );
      }
    }

    const next: Customer = {
      ...existing,
      ...(input.channel === 'email' ? { emailConsent: input.to } : { smsConsent: input.to }),
      version: existing.version + 1,
    };

    const saved = await this.repository.update(next, input.expectedVersion);

    await this.ports.recordTimeline({
      ownerId: saved.id,
      message: `${input.channel} marketing consent changed from ${from} to ${input.to}`,
      changes: [{ field: `${input.channel}Consent`, from, to: input.to }],
    });
    await this.ports.emit(CUSTOMER_EVENTS.consentChanged, {
      customerId: saved.id,
      channel: input.channel,
      from,
      to: input.to,
    });

    return saved;
  }

  async update(input: {
    id: string;
    expectedVersion: number;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    note?: string | null;
    taxExempt?: boolean;
  }): Promise<Customer> {
    const existing = await this.get(input.id);

    const next: Customer = {
      ...existing,
      firstName: input.firstName === undefined ? existing.firstName : input.firstName,
      lastName: input.lastName === undefined ? existing.lastName : input.lastName,
      phone: input.phone === undefined ? existing.phone : input.phone,
      note: input.note === undefined ? existing.note : input.note,
      taxExempt: input.taxExempt === undefined ? existing.taxExempt : input.taxExempt,
      version: existing.version + 1,
    };

    assertCustomerValid(next);
    const saved = await this.repository.update(next, input.expectedVersion);
    await this.ports.emit(CUSTOMER_EVENTS.updated, { customerId: saved.id });
    return saved;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.repository.softDelete(id);
  }

  get scope(): StoreId {
    return this.storeId;
  }
}

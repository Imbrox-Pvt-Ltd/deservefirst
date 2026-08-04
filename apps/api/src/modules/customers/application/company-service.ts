/**
 * Customers · application/company-service.ts
 * Use-cases for the Company aggregate.
 *
 * Locations and contacts are replaced as whole sets rather than edited one at a
 * time. The invariants span them — exactly one default location, one primary
 * contact, every contact assigned to a location this company has — and a
 * per-item endpoint would let a screen leave the company in a state that
 * violates all three between two calls.
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  assertCompanyValid,
  assertStatusTransition,
  type Company,
  CompanyInvariantError,
  type CompanyContact,
  type CompanyLocation,
  type CompanyStatus,
} from '../domain';

export interface CompanyRepository {
  findById(id: string): Promise<Company | null>;
  findByContact(customerId: string): Promise<readonly Company[]>;
  list(query: ListQuery): Promise<Connection<Company>>;
  insert(company: Company): Promise<Company>;
  update(company: Company, expectedVersion: number): Promise<Company>;
  softDelete(id: string): Promise<void>;
}

export class CompanyNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No company with id "${id}" in this store.`);
    this.name = 'CompanyNotFoundError';
  }
}

export interface LocationInput {
  readonly id?: string;
  readonly name: string;
  readonly addressLine1?: string | null;
  readonly city?: string | null;
  readonly countryCode: string;
  readonly paymentTerms?: CompanyLocation['paymentTerms'];
  readonly creditLimitMinor?: string | null;
  readonly isDefault?: boolean;
}

export interface ContactInput {
  readonly id?: string;
  readonly customerId: string;
  readonly role?: CompanyContact['role'];
  readonly locationIds?: readonly string[];
  readonly isPrimary?: boolean;
}

export class CompanyService {
  constructor(
    private readonly repository: CompanyRepository,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<Company>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Company> {
    const company = await this.repository.findById(id);
    if (!company) throw new CompanyNotFoundError(id);
    return company;
  }

  async forCustomer(customerId: string): Promise<readonly Company[]> {
    return this.repository.findByContact(customerId);
  }

  async create(input: {
    name: string;
    externalId?: string | null;
    note?: string | null;
    location?: LocationInput;
  }): Promise<Company> {
    // A company is created with its first location, because one with none has
    // nowhere to ship and no terms to bill on — and the invariants say so. The
    // form asks for a country; everything else can follow.
    const first = input.location ?? { name: 'Head office', countryCode: 'US' };

    const company: Company = {
      id: this.toolkit.newId(),
      name: input.name,
      externalId: input.externalId ?? null,
      status: 'active',
      note: input.note ?? null,
      locations: [this.toLocation({ ...first, isDefault: true })],
      contacts: [],
      version: 1,
    };

    assertCompanyValid(company);
    const saved = await this.repository.insert(company);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `company "${saved.name}" created`,
      changes: [],
    });
    return saved;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: { name?: string; externalId?: string | null; note?: string | null },
  ): Promise<Company> {
    const current = await this.get(id);

    const next: Company = {
      ...current,
      name: patch.name ?? current.name,
      externalId: patch.externalId === undefined ? current.externalId : patch.externalId,
      note: patch.note === undefined ? current.note : patch.note,
      version: current.version + 1,
    };

    assertCompanyValid(next);
    return this.repository.update(next, expectedVersion);
  }

  /**
   * Replaces the locations.
   *
   * Existing ids are kept where the caller sends them, because a contact's
   * assignment and every past order point at them — regenerating an id here
   * would silently orphan both.
   */
  async setLocations(
    id: string,
    expectedVersion: number,
    locations: readonly LocationInput[],
  ): Promise<Company> {
    const current = await this.get(id);
    const next: Company = {
      ...current,
      locations: locations.map((location) => this.toLocation(location)),
      version: current.version + 1,
    };

    // Contacts assigned to a location that has just been removed would fail the
    // aggregate's own check, which is exactly the outcome wanted: the caller is
    // told rather than left with a contact pointing at nothing.
    assertCompanyValid(next);
    return this.repository.update(next, expectedVersion);
  }

  async setContacts(
    id: string,
    expectedVersion: number,
    contacts: readonly ContactInput[],
  ): Promise<Company> {
    const current = await this.get(id);
    const next: Company = {
      ...current,
      contacts: contacts.map((contact) => ({
        id: contact.id ?? this.toolkit.newId(),
        customerId: contact.customerId,
        role: contact.role ?? 'viewing',
        locationIds: contact.locationIds ?? [],
        isPrimary: contact.isPrimary ?? false,
      })),
      version: current.version + 1,
    };

    assertCompanyValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `contacts updated on "${saved.name}"`,
      changes: [{ field: 'contacts', from: current.contacts.length, to: saved.contacts.length }],
    });
    return saved;
  }

  /**
   * Puts a company on hold, back on, or closes it.
   *
   * On hold is the useful one: it stops new orders without ending the
   * relationship or losing the terms, which is what actually happens when an
   * invoice is overdue.
   */
  async setStatus(id: string, expectedVersion: number, status: CompanyStatus): Promise<Company> {
    const current = await this.get(id);
    assertStatusTransition(current.status, status);
    if (current.status === status) return current;

    const next: Company = { ...current, status, version: current.version + 1 };
    const saved = await this.repository.update(next, expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `company "${saved.name}" is now ${status}`,
      changes: [{ field: 'status', from: current.status, to: status }],
    });
    await this.toolkit.emit('customers.company.status-changed', {
      companyId: saved.id,
      from: current.status,
      to: status,
    });
    return saved;
  }

  private toLocation(input: LocationInput): CompanyLocation {
    if (input.creditLimitMinor !== undefined && input.creditLimitMinor !== null) {
      if (!/^-?\d+$/.test(input.creditLimitMinor)) {
        throw new CompanyInvariantError('locations', 'a credit limit is a whole number of minor units');
      }
    }

    return {
      id: input.id ?? this.toolkit.newId(),
      name: input.name,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      countryCode: input.countryCode.toUpperCase(),
      paymentTerms: input.paymentTerms ?? 'due-on-receipt',
      creditLimitMinor:
        input.creditLimitMinor === undefined || input.creditLimitMinor === null
          ? null
          : BigInt(input.creditLimitMinor),
      isDefault: input.isDefault ?? false,
    };
  }
}

/**
 * Customers · infrastructure/company.repository.ts
 * Persistence for the Company aggregate.
 *
 * Locations and contacts are stored as JSON on the company rather than as their
 * own tables, because the invariants span them — "exactly one default location",
 * "one primary contact", "a contact's locations must belong to this company".
 * Enforcing those across a join means either a transaction per edit or a rule
 * that is true most of the time, and the whole set is read and written together
 * anyway.
 * Layer: infrastructure.
 */

import { type ResourceDefinition } from '@deservefirst/contracts';

import { SqlAggregateRepository, parseJsonArray } from '../../../core/database';
import { companyResource } from '../contracts';
import type { Company, CompanyContact, CompanyLocation } from '../domain';
import type { CompanyRepository } from '../application';

interface CompanyRow extends Record<string, unknown> {
  id: string;
  name: string;
  external_id: string | null;
  status: string;
  note: string | null;
  locations: unknown;
  contacts: unknown;
  version: number;
}

/** Credit limits are minor units, and BigInt does not survive JSON. */
interface StoredLocation extends Omit<CompanyLocation, 'creditLimitMinor'> {
  readonly creditLimitMinor: string | null;
}

export class SqlCompanyRepository
  extends SqlAggregateRepository<Company, CompanyRow>
  implements CompanyRepository
{
  protected readonly tableName = 'companies';
  protected readonly resource: ResourceDefinition = companyResource;
  protected readonly operation = 'customers.companies';

  protected toDomain(row: CompanyRow): Company {
    return {
      id: row.id,
      name: row.name,
      externalId: row.external_id,
      status: row.status as Company['status'],
      note: row.note,
      locations: parseJsonArray<StoredLocation>(row.locations).map((location) => ({
        ...location,
        // Round-tripped as a string so an exact amount survives JSON, which has
        // no integer type large enough to be trusted with money.
        creditLimitMinor: location.creditLimitMinor === null ? null : BigInt(location.creditLimitMinor),
      })),
      contacts: parseJsonArray<CompanyContact>(row.contacts),
      version: Number(row.version),
    };
  }

  protected toColumns(entity: Company): Record<string, unknown> {
    return {
      handle: entity.id,
      name: entity.name,
      external_id: entity.externalId,
      status: entity.status,
      note: entity.note,
      locations: JSON.stringify(
        entity.locations.map((location) => ({
          ...location,
          creditLimitMinor: location.creditLimitMinor?.toString() ?? null,
        })),
      ),
      contacts: JSON.stringify(entity.contacts),
      location_count: entity.locations.length,
      contact_count: entity.contacts.length,
    };
  }

  /** Companies this person is a contact of — for the customer detail screen. */
  async findByContact(customerId: string): Promise<readonly Company[]> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<CompanyRow>(
      `SELECT * FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('deleted_at')} IS NULL
          AND ${this.q('contacts')} LIKE ${p2}`,
      [this.storeId(), `%${customerId}%`],
    );

    // The LIKE narrows the scan; the real check is on the parsed aggregate,
    // because a substring match would also hit an id that merely contains this
    // one.
    return rows
      .map((row) => this.toDomain(row))
      .filter((company) => company.contacts.some((contact) => contact.customerId === customerId));
  }
}

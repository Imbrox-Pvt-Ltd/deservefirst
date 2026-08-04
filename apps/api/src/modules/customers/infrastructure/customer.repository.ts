/**
 * Customers · infrastructure/customer.repository.ts
 * Persistence for the Customer aggregate. Every query is store-scoped from the
 * ambient context, and the column names come from the schema builder rather than
 * being hand-written here (§14.2).
 * Layer: infrastructure.
 */

import { type Connection, type ListQuery, money, type StoreId } from '@deservefirst/contracts';

import { StaleWriteError } from '../../../core/entity-toolkit';
import { ListEngine, type QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import { customerResource } from '../contracts';
import type { Address, Customer } from '../domain';
import type { CustomerRepository } from '../application';

const TABLE = 'customers';

interface CustomerRow extends Record<string, unknown> {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string;
  email_consent: string;
  sms_consent: string;
  locale: string | null;
  tax_exempt: number | boolean;
  orders_count: number;
  total_spent_amount_minor: string | null;
  total_spent_currency: string | null;
  default_address: unknown;
  note: string | null;
  version: number;
}

export class CustomerRepositoryImpl implements CustomerRepository {
  private readonly listEngine: ListEngine;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  private storeId(): StoreId {
    return requireStoreContext('customers').storeId;
  }

  private args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async findById(id: string): Promise<Customer | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<CustomerRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  /** Email is how a shopper is deduplicated, so the lookup must be exact. */
  async findByEmail(email: string): Promise<Customer | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<CustomerRow>(
      `SELECT * FROM ${this.q(TABLE)} WHERE ${this.q('store_id')} = ${p1} AND ${this.q('email')} = ${p2} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [this.storeId(), email],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async list(query: ListQuery): Promise<Connection<Customer>> {
    const connection = await this.listEngine.list<CustomerRow>({
      resource: customerResource,
      tableName: TABLE,
      query,
      dialect: this.dialect,
    });
    return { ...connection, nodes: connection.nodes.map(toDomain) };
  }

  async insert(customer: Customer): Promise<Customer> {
    const columns = [
      'id', 'store_id', 'handle', 'first_name', 'last_name', 'email', 'phone', 'state',
      'email_consent', 'sms_consent', 'locale', 'tax_exempt', 'orders_count',
      'total_spent_amount_minor', 'total_spent_currency', 'default_address', 'note', 'version',
    ];

    await this.executor.query(
      `INSERT INTO ${this.q(TABLE)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        customer.id,
        this.storeId(),
        // Customers have no public URL, so the handle is the id — the unique
        // (store, handle) index still needs a value.
        customer.id,
        customer.firstName,
        customer.lastName,
        customer.email,
        customer.phone,
        customer.state,
        customer.emailConsent,
        customer.smsConsent,
        customer.locale,
        customer.taxExempt ? 1 : 0,
        customer.ordersCount,
        customer.totalSpent.amountMinor.toString(),
        customer.totalSpent.currency,
        JSON.stringify(customer.defaultAddress),
        customer.note,
        customer.version,
      ],
    );
    return customer;
  }

  async update(customer: Customer, expectedVersion: number): Promise<Customer> {
    const assignments = [
      'first_name', 'last_name', 'email', 'phone', 'state', 'email_consent', 'sms_consent',
      'locale', 'tax_exempt', 'orders_count', 'total_spent_amount_minor',
      'total_spent_currency', 'default_address', 'note', 'version',
    ];

    const parameters: unknown[] = [
      customer.firstName,
      customer.lastName,
      customer.email,
      customer.phone,
      customer.state,
      customer.emailConsent,
      customer.smsConsent,
      customer.locale,
      customer.taxExempt ? 1 : 0,
      customer.ordersCount,
      customer.totalSpent.amountMinor.toString(),
      customer.totalSpent.currency,
      JSON.stringify(customer.defaultAddress),
      customer.note,
      customer.version,
      this.storeId(),
      customer.id,
      expectedVersion,
    ];

    const placeholders = this.args(parameters.length);
    const setClause = assignments
      .map((column, index) => `${this.q(column)} = ${placeholders[index]}`)
      .join(', ');
    const [storeParam, idParam, versionParam] = placeholders.slice(assignments.length);

    const affected = await this.executeUpdate(
      `UPDATE ${this.q(TABLE)}
          SET ${setClause}, ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('store_id')} = ${storeParam}
          AND ${this.q('id')} = ${idParam}
          AND ${this.q('version')} = ${versionParam}
          AND ${this.q('deleted_at')} IS NULL`,
      parameters,
    );

    if (affected === 0) {
      throw new StaleWriteError('Customer', customer.id, expectedVersion, customer.version);
    }
    return customer;
  }

  /** Same shape as the catalog repository: RETURNING on Postgres, affectedRows on MySQL. */
  private async executeUpdate(sql: string, parameters: unknown[]): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(`${sql} RETURNING ${this.q('id')}`, parameters);
      return rows.length;
    }

    const writable = this.executor as QueryExecutor & {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };
    if (typeof writable.execute !== 'function') {
      throw new Error('This executor cannot report affected rows, so optimistic concurrency cannot be enforced.');
    }
    return (await writable.execute(sql, parameters)).affectedRows;
  }

  async softDelete(id: string): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q(TABLE)} SET ${this.q('deleted_at')} = CURRENT_TIMESTAMP(3) WHERE ${this.q('store_id')} = ${p1} AND ${this.q('id')} = ${p2}`,
      [this.storeId(), id],
    );
  }
}

function toDomain(row: CustomerRow): Customer {
  const address = parseJson<Address>(row.default_address);
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    state: row.state as Customer['state'],
    emailConsent: row.email_consent as Customer['emailConsent'],
    smsConsent: row.sms_consent as Customer['smsConsent'],
    locale: row.locale ?? 'en-US',
    note: row.note,
    taxExempt: Boolean(Number(row.tax_exempt)),
    defaultAddress: address,
    addresses: address ? [address] : [],
    ordersCount: Number(row.orders_count ?? 0),
    totalSpent: money(BigInt(row.total_spent_amount_minor ?? '0'), row.total_spent_currency ?? 'USD'),
    version: Number(row.version),
  };
}

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

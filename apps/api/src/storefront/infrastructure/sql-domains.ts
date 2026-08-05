/**
 * Storefront · infrastructure/sql-domains.ts
 * Connected hostnames, in the database.
 *
 * Ordinary store-scoped persistence with one deliberate exception, and the
 * exception is the point of the file: `findAnyStoreClaiming` deliberately reads
 * ACROSS stores. Every other query here is scoped by `store_id` because a query
 * that is not is one that can return another tenant's rows — but "has anyone
 * else already proved they own this name" cannot be answered inside one store,
 * and refusing to ask it is how two merchants end up with the same domain.
 *
 * That query is therefore narrow on purpose: it selects the store id and the
 * status and nothing else, so the widest-scoped read in the storefront cannot
 * become a way to enumerate other stores' data.
 * Layer: infrastructure.
 */

import { Binder, writerFor } from '../../core/database/bind';
import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { platformContext, requireStoreContext, withRequestContext } from '../../core/tenant-context';
import type { DomainRepository } from '../application/domain-service';
import type { DomainStatus, StoreDomain } from '../domain';

type Row = Record<string, unknown>;

export class SqlDomainRepository implements DomainRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
    private readonly newId: () => string = () => `dom_${Date.now()}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private storeId(): string {
    return requireStoreContext('storefront.domains').storeId;
  }

  /** Writes go through an executor that can say what they touched. */
  private writer() {
    return writerFor(this.executor, 'a domain change');
  }

  private toRecord(row: Row): StoreDomain {
    return {
      id: String(row.id),
      host: String(row.host),
      role: (String(row.role ?? 'alias') === 'primary' ? 'primary' : 'alias'),
      status: String(row.status ?? 'pending') as DomainStatus,
      verificationToken: String(row.verification_token),
      verifiedAt: row.verified_at ? new Date(row.verified_at as string) : null,
    };
  }

  private get columns(): string {
    return [
      this.q('id'),
      this.q('host'),
      this.q('role'),
      this.q('status'),
      this.q('verification_token'),
      this.q('verified_at'),
    ].join(', ');
  }

  async all(): Promise<readonly StoreDomain[]> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT ${this.columns} FROM ${this.q('store_domains')}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('role')} ASC, ${this.q('host')} ASC`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows.map((row) => this.toRecord(row));
  }

  async byId(id: string): Promise<StoreDomain | null> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT ${this.columns} FROM ${this.q('store_domains')}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('id')} = ${bind.add(id)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  /**
   * The one cross-store read, kept as narrow as the question.
   *
   * Two columns and no more. A merchant asking "can I have this domain" gets an
   * answer about their own request; they do not get to learn whose it is, which
   * would make this endpoint a way to ask which competitors are on the platform.
   *
   * Verified claims sort first so a single verified owner always wins over any
   * number of pending claims on the same name.
   */
  async findAnyStoreClaiming(
    host: string,
  ): Promise<{ storeId: string; status: DomainStatus } | null> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT ${this.q('store_id')}, ${this.q('status')}
         FROM ${this.q('store_domains')}
        WHERE ${this.q('host')} = ${bind.add(host)}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY CASE WHEN ${this.q('status')} = 'verified' THEN 0 ELSE 1 END ASC
        LIMIT 1`;

    const statement = bind.finish(sql);

    /**
     * Run in a PLATFORM context, which is the sanctioned way to cross stores.
     *
     * The query guard refused this — correctly — because it reads a
     * store-scoped table without a store predicate. That is not a rule to work
     * around: it is the reason two tenants' rows cannot be confused. But "has
     * anyone else already proved they own this hostname" genuinely spans every
     * store, and asking it inside one store's scope answers a different
     * question.
     *
     * So it takes the escape hatch the guard itself defines (§14.2) rather than
     * an exemption, which keeps the crossing visible and deliberate. Paired
     * with the two-column projection above, the widest read in the storefront
     * returns a store id and a status and nothing that could describe anyone's
     * business.
     */
    const rows = await withRequestContext(platformContext(), () =>
      this.executor.query<Row>(statement.sql, statement.parameters),
    );

    const row = rows[0];
    if (!row) return null;

    return { storeId: String(row.store_id), status: String(row.status ?? 'pending') as DomainStatus };
  }

  async create(input: {
    readonly host: string;
    readonly role: 'primary' | 'alias';
    readonly verificationToken: string;
  }): Promise<StoreDomain> {
    const id = this.newId();
    const at = this.now();

    const bind = new Binder(this.dialect);
    const sql = `INSERT INTO ${this.q('store_domains')} (
        ${this.q('id')}, ${this.q('store_id')}, ${this.q('host')}, ${this.q('role')},
        ${this.q('status')}, ${this.q('verification_token')}, ${this.q('reaches_us')},
        ${this.q('created_at')}, ${this.q('updated_at')}
      ) VALUES (${bind.add(id)}, ${bind.add(this.storeId())}, ${bind.add(input.host)},
        ${bind.add(input.role)}, ${bind.add('pending')}, ${bind.add(input.verificationToken)},
        ${bind.add(false)}, ${bind.add(at)}, ${bind.add(at)})`;

    const statement = bind.finish(sql);
    await this.writer().execute(statement.sql, statement.parameters);

    return {
      id,
      host: input.host,
      role: input.role,
      // Never anything else. A row is a claim, and a claim serves nothing.
      status: 'pending',
      verificationToken: input.verificationToken,
      verifiedAt: null,
    };
  }

  async recordCheck(
    id: string,
    result: { readonly status: DomainStatus; readonly reachesUs: boolean; readonly verifiedAt: Date | null },
  ): Promise<void> {
    const bind = new Binder(this.dialect);
    const sql = `UPDATE ${this.q('store_domains')}
        SET ${this.q('status')} = ${bind.add(result.status)},
            ${this.q('reaches_us')} = ${bind.add(result.reachesUs)},
            ${this.q('verified_at')} = ${bind.add(result.verifiedAt)},
            ${this.q('last_checked_at')} = ${bind.add(this.now())},
            ${this.q('updated_at')} = ${bind.add(this.now())}
      WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
        AND ${this.q('id')} = ${bind.add(id)}
        AND ${this.q('deleted_at')} IS NULL`;

    const statement = bind.finish(sql);
    await this.writer().execute(statement.sql, statement.parameters);
  }

  /**
   * Every role change in ONE statement.
   *
   * The same reasoning as a theme's role change: two statements leave a window
   * where a store has two primary domains or none, and the second is the one
   * where every page redirects to a hostname that is no longer canonical. A
   * `CASE` over an `IN` list applies wholly or not at all.
   */
  async applyRoles(
    changes: readonly { readonly id: string; readonly role: 'primary' | 'alias' }[],
  ): Promise<void> {
    if (changes.length === 0) return;

    const bind = new Binder(this.dialect);

    /**
     * Built by appending to ONE binder, so each placeholder consumes the value
     * that was added beside it.
     *
     * Written this way because the alternative has bitten this codebase twice:
     * reusing a placeholder index reads correctly on Postgres, where `$1` names
     * a value, and silently shifts every parameter on MySQL, where each `?`
     * takes the next one.
     */
    const roleCases = changes
      .map((change) => `WHEN ${this.q('id')} = ${bind.add(change.id)} THEN ${bind.add(change.role)}`)
      .join(' ');

    const sql = `UPDATE ${this.q('store_domains')}
        SET ${this.q('role')} = CASE ${roleCases} ELSE ${this.q('role')} END,
            ${this.q('updated_at')} = ${bind.add(this.now())}
      WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
        AND ${this.q('id')} IN (${bind.addAll(changes.map((change) => change.id))})
        AND ${this.q('deleted_at')} IS NULL`;

    const statement = bind.finish(sql);
    await this.writer().execute(statement.sql, statement.parameters);
  }

  /**
   * Soft-deleted, like everything else here.
   *
   * It also matters for `findAnyStoreClaiming`: a hard delete would leave no
   * trace that a domain was ever connected, and the audit trail for "who had
   * this hostname and when" is exactly what a dispute over one needs.
   */
  async remove(id: string): Promise<void> {
    const bind = new Binder(this.dialect);
    const sql = `UPDATE ${this.q('store_domains')}
        SET ${this.q('deleted_at')} = ${bind.add(this.now())},
            ${this.q('updated_at')} = ${bind.add(this.now())}
      WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
        AND ${this.q('id')} = ${bind.add(id)}`;

    const statement = bind.finish(sql);
    await this.writer().execute(statement.sql, statement.parameters);
  }
}

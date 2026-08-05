/**
 * Billing · infrastructure/index.ts
 * Storage for charges.
 *
 * Money is two columns — minor units and currency — because that is how the
 * schema builder stores the `money` field type, and because a single decimal
 * column is the mistake §15.2 exists to prevent.
 * Layer: infrastructure.
 */

import type { Money, StoreId } from '@deservefirst/contracts';
import { money } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import { moneyColumnNames } from '../../core/entity-toolkit/column-mapping';
import type { AppCharge } from '../domain/charge';

/**
 * Column names from the platform's own helper, not written out here.
 *
 * The schema builder uses it to CREATE these columns; writing the names a
 * second time is how a repository ends up selecting a column that does not
 * exist — which is exactly what happened on the first run of this file.
 */
const PRICE = moneyColumnNames('price');
const CAP = moneyColumnNames('cappedAmount');
const USED = moneyColumnNames('balanceUsed');

interface ChargeRow extends Record<string, unknown> {
  id: string;
  app_id: string;
  store_id: string;
  kind: string;
  name: string;
  status: string;
  interval: string | null;
  trial_days: number | null;
  activated_at: Date | null;
  current_period_end: Date | null;
  cancelled_at: Date | null;
  is_test: number | boolean | null;
  version: number;
}

/** A money pair back into a value object; missing means zero in the fallback. */
function toMoney(amount: unknown, currency: unknown, fallback: string): Money {
  return money(BigInt(String(amount ?? '0')), String(currency ?? fallback));
}

export class SqlChargeRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private storeId(): string {
    return requireStoreContext('billing.charges').storeId;
  }

  private async runWrite(sql: string, parameters: readonly unknown[]): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(
        `${sql} RETURNING ${this.q('id')}`,
        parameters,
      );
      return rows.length;
    }
    const writable = this.executor as unknown as {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };
    if (typeof writable.execute !== 'function') {
      throw new Error('This executor cannot report affected rows.');
    }
    return (await writable.execute(sql, parameters)).affectedRows;
  }

  private toDomain(row: ChargeRow): AppCharge {
    const currency = String(row[PRICE.currency] ?? 'USD');
    return {
      id: row.id,
      appId: row.app_id,
      storeId: row.store_id,
      kind: row.kind as AppCharge['kind'],
      name: row.name,
      status: row.status as AppCharge['status'],
      price: toMoney(row[PRICE.amount], row[PRICE.currency], currency),
      interval: (row.interval as AppCharge['interval']) ?? null,
      cappedAmount:
        row[CAP.amount] === null || row[CAP.amount] === undefined
          ? null
          : toMoney(row[CAP.amount], row[CAP.currency], currency),
      balanceUsed: toMoney(row[USED.amount], row[USED.currency], currency),
      trialDays: Number(row.trial_days ?? 0),
      activatedAt: row.activated_at,
      currentPeriodEnd: row.current_period_end,
      cancelledAt: row.cancelled_at,
      isTest: Boolean(row.is_test),
      version: Number(row.version),
    };
  }

  private columns(charge: AppCharge): Record<string, unknown> {
    return {
      kind: charge.kind,
      name: charge.name,
      status: charge.status,
      [PRICE.amount]: charge.price.amountMinor.toString(),
      [PRICE.currency]: charge.price.currency,
      interval: charge.interval,
      [CAP.amount]: charge.cappedAmount?.amountMinor.toString() ?? null,
      [CAP.currency]: charge.cappedAmount?.currency ?? null,
      [USED.amount]: charge.balanceUsed.amountMinor.toString(),
      [USED.currency]: charge.balanceUsed.currency,
      trial_days: charge.trialDays,
      activated_at: charge.activatedAt,
      current_period_end: charge.currentPeriodEnd,
      cancelled_at: charge.cancelledAt,
      is_test: charge.isTest,
    };
  }

  async findById(id: string): Promise<AppCharge | null> {
    const rows = await this.executor.query<ChargeRow>(
      `SELECT * FROM ${this.q('app_charges')}
        WHERE ${this.q('id')} = ${this.p(1)} AND ${this.q('store_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [id, this.storeId()],
    );
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async forStore(storeId: StoreId): Promise<readonly AppCharge[]> {
    const rows = await this.executor.query<ChargeRow>(
      `SELECT * FROM ${this.q('app_charges')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('created_at')} DESC`,
      [storeId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async forApp(appId: string, storeId: StoreId): Promise<readonly AppCharge[]> {
    const rows = await this.executor.query<ChargeRow>(
      `SELECT * FROM ${this.q('app_charges')}
        WHERE ${this.q('app_id')} = ${this.p(1)} AND ${this.q('store_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL`,
      [appId, storeId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async insert(charge: AppCharge): Promise<void> {
    const values = {
      id: charge.id,
      handle: charge.id,
      store_id: charge.storeId,
      app_id: charge.appId,
      ...this.columns(charge),
      version: charge.version,
    };
    const names = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('app_charges')} (${names.map((n) => this.q(n)).join(', ')})
       VALUES (${names.map((_, index) => this.p(index + 1)).join(', ')})`,
      Object.values(values),
    );
  }

  /**
   * Version-checked. Returns whether this caller won.
   *
   * Two concurrent usage records would otherwise read the same balance and the
   * second would overwrite the first — billing for one of two things that
   * happened.
   */
  async save(charge: AppCharge, expectedVersion: number): Promise<boolean> {
    const values = { ...this.columns(charge), version: charge.version };
    const names = Object.keys(values);
    const parameters = [...Object.values(values), charge.id, this.storeId(), expectedVersion];

    const setClause = names.map((name, index) => `${this.q(name)} = ${this.p(index + 1)}`).join(', ');
    const [idParam, storeParam, versionParam] = [
      this.p(names.length + 1),
      this.p(names.length + 2),
      this.p(names.length + 3),
    ];

    const affected = await this.runWrite(
      `UPDATE ${this.q('app_charges')} SET ${setClause}
        WHERE ${this.q('id')} = ${idParam} AND ${this.q('store_id')} = ${storeParam}
          AND ${this.q('version')} = ${versionParam}`,
      parameters,
    );
    return affected > 0;
  }
}

/**
 * Auth · infrastructure/partner.repository.ts
 * Reading and writing partners, their staff, and their links to client stores.
 *
 * These tables are platform-scoped: a partner exists above any one store, and
 * its link rows are precisely the records that say which stores it may touch.
 * Scoping them to a store would be circular — the row that decides access
 * cannot itself be behind that access.
 * Layer: infrastructure.
 */

import type { PartnerId, StoreId, UserId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../core/list-engine/dialect';
import type {
  Partner,
  PartnerStaff,
  PartnerStoreLink,
} from '../domain/partner';

interface PartnerRow extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  name: string;
  status: string;
  payout_currency: string | null;
  website_url: string | null;
  version: number;
}

interface StaffRow extends Record<string, unknown> {
  id: string;
  partner_id: string;
  user_id: string;
  role: string;
  status: string;
}

interface LinkRow extends Record<string, unknown> {
  id: string;
  partner_id: string;
  store_id: string;
  status: string;
  access_level: string;
  permissions: unknown;
  created_by_partner: number | boolean;
  requested_at: Date;
  decided_at: Date | null;
  revoked_reason: string | null;
}

function toPartner(row: PartnerRow): Partner {
  return {
    id: row.id as PartnerId,
    ownerUserId: row.owner_user_id as UserId,
    name: row.name,
    status: row.status as Partner['status'],
    payoutCurrency: row.payout_currency,
    websiteUrl: row.website_url,
    version: Number(row.version),
  };
}

function toStaff(row: StaffRow): PartnerStaff {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    role: row.role as PartnerStaff['role'],
    status: row.status as PartnerStaff['status'],
  };
}

/** JSON columns come back parsed on one driver and as text on another. */
function toList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toLink(row: LinkRow): PartnerStoreLink {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    status: row.status as PartnerStoreLink['status'],
    accessLevel: row.access_level as PartnerStoreLink['accessLevel'],
    permissions: toList(row.permissions),
    createdByPartner: Boolean(row.created_by_partner),
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    revokedReason: row.revoked_reason,
  };
}

export class SqlPartnerRepository {
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

  /**
   * Rows actually changed — Postgres reports it via RETURNING, MySQL via the
   * driver. The same shape the aggregate repository uses, because deciding a
   * version check any other way is not safe under concurrency.
   */
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
      throw new Error(
        'This executor cannot report affected rows, so optimistic concurrency cannot be enforced.',
      );
    }
    return (await writable.execute(sql, parameters)).affectedRows;
  }

  async findById(id: PartnerId): Promise<Partner | null> {
    const rows = await this.executor.query<PartnerRow>(
      `SELECT * FROM ${this.q('partners')} WHERE ${this.q('id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? toPartner(rows[0]) : null;
  }

  async insert(partner: Partner): Promise<void> {
    const columns = ['id', 'owner_user_id', 'name', 'status', 'payout_currency', 'website_url', 'version'];
    await this.executor.query(
      `INSERT INTO ${this.q('partners')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        partner.id,
        partner.ownerUserId,
        partner.name,
        partner.status,
        partner.payoutCurrency,
        partner.websiteUrl,
        partner.version,
      ],
    );
  }

  /**
   * Updates by version, and reports whether the row moved.
   *
   * The caller turns `false` into a 409. Deciding it from the driver's affected
   * count rather than re-reading the version is the only way that is honest
   * under concurrency: a re-read can see the winner's value and conclude it won.
   */
  async update(partner: Partner): Promise<boolean> {
    const affected = await this.runWrite(
      `UPDATE ${this.q('partners')} SET
         ${this.q('name')} = ${this.p(1)},
         ${this.q('status')} = ${this.p(2)},
         ${this.q('payout_currency')} = ${this.p(3)},
         ${this.q('website_url')} = ${this.p(4)},
         ${this.q('owner_user_id')} = ${this.p(5)},
         ${this.q('version')} = ${this.q('version')} + 1
       WHERE ${this.q('id')} = ${this.p(6)} AND ${this.q('version')} = ${this.p(7)}`,
      [
        partner.name,
        partner.status,
        partner.payoutCurrency,
        partner.websiteUrl,
        partner.ownerUserId,
        partner.id,
        partner.version,
      ],
    );
    return affected > 0;
  }

  // --- staff -----------------------------------------------------------------

  async staffFor(partnerId: PartnerId): Promise<readonly PartnerStaff[]> {
    const rows = await this.executor.query<StaffRow>(
      `SELECT * FROM ${this.q('partner_staff')}
        WHERE ${this.q('partner_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('created_at')} ASC`,
      [partnerId],
    );
    return rows.map(toStaff);
  }

  async insertStaff(partnerId: PartnerId, member: PartnerStaff): Promise<void> {
    const columns = ['id', 'partner_id', 'user_id', 'role', 'status'];
    await this.executor.query(
      `INSERT INTO ${this.q('partner_staff')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [member.id, partnerId, member.userId, member.role, member.status],
    );
  }

  async saveStaff(member: PartnerStaff): Promise<void> {
    await this.runWrite(
      `UPDATE ${this.q('partner_staff')} SET ${this.q('role')} = ${this.p(1)}, ${this.q('status')} = ${this.p(2)}
        WHERE ${this.q('id')} = ${this.p(3)}`,
      [member.role, member.status, member.id],
    );
  }

  /**
   * Every partner this user works for.
   *
   * Drives the partner picker and, more importantly, session resolution: it is
   * how a request learns it is being made by partner staff at all.
   */
  async partnersFor(userId: UserId): Promise<readonly { partner: Partner; member: PartnerStaff }[]> {
    const rows = await this.executor.query<PartnerRow & StaffRow>(
      `SELECT p.*, s.${this.q('id')} AS staff_id, s.${this.q('role')} AS staff_role, s.${this.q('status')} AS staff_status
         FROM ${this.q('partner_staff')} s
         JOIN ${this.q('partners')} p ON p.${this.q('id')} = s.${this.q('partner_id')}
        WHERE s.${this.q('user_id')} = ${this.p(1)}
          AND s.${this.q('status')} = 'active'
          AND s.${this.q('deleted_at')} IS NULL
          AND p.${this.q('deleted_at')} IS NULL`,
      [userId],
    );

    return rows.map((row: PartnerRow & StaffRow) => ({
      partner: toPartner(row),
      member: {
        id: String(row.staff_id),
        userId: userId,
        role: String(row.staff_role) as PartnerStaff['role'],
        status: String(row.staff_status) as PartnerStaff['status'],
      },
    }));
  }

  // --- links to client stores ------------------------------------------------

  /**
   * This partner's client stores, with each store's name and handle.
   *
   * Joined rather than left to the caller to look up: a partner dashboard
   * listing eleven opaque store ids is not a dashboard, and resolving them one
   * at a time is the N+1 that turns a page into a page load.
   */
  async linksFor(
    partnerId: PartnerId,
  ): Promise<readonly { link: PartnerStoreLink; storeName: string | null; storeHandle: string | null }[]> {
    const rows = await this.executor.query<LinkRow & { store_name: string | null; store_handle: string | null }>(
      `SELECT l.*, s.${this.q('name')} AS store_name, s.${this.q('handle')} AS store_handle
         FROM ${this.q('partner_store_links')} l
         LEFT JOIN ${this.q('stores')} s ON s.${this.q('id')} = l.${this.q('store_id')}
        WHERE l.${this.q('partner_id')} = ${this.p(1)} AND l.${this.q('deleted_at')} IS NULL
        ORDER BY l.${this.q('requested_at')} DESC`,
      [partnerId],
    );
    return rows.map((row: LinkRow & { store_name: string | null; store_handle: string | null }) => ({
      link: toLink(row),
      // Null when the store was deleted out from under the link — shown as
      // "no longer exists" rather than crashing the list.
      storeName: row.store_name,
      storeHandle: row.store_handle,
    }));
  }

  /** The partners asking for, or holding, access to one store. */
  async linksForStore(storeId: StoreId): Promise<readonly { partnerId: PartnerId; partnerName: string; link: PartnerStoreLink }[]> {
    const rows = await this.executor.query<LinkRow & { partner_name: string }>(
      `SELECT l.*, p.${this.q('name')} AS partner_name
         FROM ${this.q('partner_store_links')} l
         JOIN ${this.q('partners')} p ON p.${this.q('id')} = l.${this.q('partner_id')}
        WHERE l.${this.q('store_id')} = ${this.p(1)} AND l.${this.q('deleted_at')} IS NULL
        ORDER BY l.${this.q('requested_at')} DESC`,
      [storeId],
    );
    return rows.map((row: LinkRow & { partner_name: string }) => ({
      partnerId: row.partner_id as PartnerId,
      partnerName: row.partner_name,
      link: toLink(row),
    }));
  }

  async findLink(partnerId: PartnerId, storeId: StoreId): Promise<PartnerStoreLink | null> {
    const rows = await this.executor.query<LinkRow>(
      `SELECT * FROM ${this.q('partner_store_links')}
        WHERE ${this.q('partner_id')} = ${this.p(1)} AND ${this.q('store_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [partnerId, storeId],
    );
    return rows[0] ? toLink(rows[0]) : null;
  }

  async findLinkById(id: string): Promise<{ partnerId: PartnerId; link: PartnerStoreLink } | null> {
    const rows = await this.executor.query<LinkRow>(
      `SELECT * FROM ${this.q('partner_store_links')} WHERE ${this.q('id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? { partnerId: rows[0].partner_id as PartnerId, link: toLink(rows[0]) } : null;
  }

  async insertLink(partnerId: PartnerId, link: PartnerStoreLink): Promise<void> {
    const columns = [
      'id', 'partner_id', 'store_id', 'status', 'access_level', 'permissions',
      'created_by_partner', 'requested_at', 'decided_at', 'revoked_reason',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('partner_store_links')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        link.id,
        partnerId,
        link.storeId,
        link.status,
        link.accessLevel,
        JSON.stringify(link.permissions),
        link.createdByPartner,
        link.requestedAt,
        link.decidedAt,
        link.revokedReason,
      ],
    );
  }

  async saveLink(link: PartnerStoreLink): Promise<void> {
    await this.runWrite(
      `UPDATE ${this.q('partner_store_links')} SET
         ${this.q('status')} = ${this.p(1)},
         ${this.q('access_level')} = ${this.p(2)},
         ${this.q('permissions')} = ${this.p(3)},
         ${this.q('created_by_partner')} = ${this.p(4)},
         ${this.q('requested_at')} = ${this.p(5)},
         ${this.q('decided_at')} = ${this.p(6)},
         ${this.q('revoked_reason')} = ${this.p(7)}
       WHERE ${this.q('id')} = ${this.p(8)}`,
      [
        link.status,
        link.accessLevel,
        JSON.stringify(link.permissions),
        link.createdByPartner,
        link.requestedAt,
        link.decidedAt,
        link.revokedReason,
        link.id,
      ],
    );
  }
}

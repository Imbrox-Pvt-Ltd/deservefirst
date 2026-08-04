/**
 * Auth · infrastructure/identity.repository.ts
 * Persistence for the identity model. Identity is the one place where NOT every
 * query is store-scoped — a user must be found before any store context exists,
 * and organizations span stores. Those tables are declared platform- and
 * organization-scoped in the manifest, so the query guard knows not to demand a
 * store predicate on them.
 *
 * Where a query IS store-scoped — memberships, role assignments — the boundary
 * is explicit and passed, because at login time there is no ambient context yet.
 * Layer: infrastructure.
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../core/list-engine/dialect';
import type { IdentityRepository } from '../application';
import type {
  BusinessEntity,
  Membership,
  Organization,
  Store,
  User,
} from '../domain';

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  email_verified_at: Date | null;
  secondary_email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  mfa_enabled: number | boolean;
  provider_ref: string | null;
  password_hash: string | null;
  mfa_secret: string | null;
  recovery_code_hashes: unknown;
  locale: string | null;
  time_zone: string | null;
  created_at: Date;
}

interface StoreRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  business_entity_id: string | null;
  handle: string;
  name: string;
  type: string;
  status: string;
  default_locale: string | null;
  time_zone: string | null;
  base_currency: string | null;
  feature_previews: unknown;
  created_at: Date;
}

export class SqlIdentityRepository implements IdentityRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private args(count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.dialect.placeholder(index + 1));
  }

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async findUserByEmail(email: string): Promise<(User & { passwordHash: string | null }) | null> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<UserRow>(
      `SELECT * FROM ${this.q('users')} WHERE ${this.q('email')} = ${p1} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [email],
    );
    const row = rows[0];
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async findUserById(id: UserId): Promise<User | null> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<UserRow>(
      `SELECT * FROM ${this.q('users')} WHERE ${this.q('id')} = ${p1} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async createUser(user: User, passwordHash: string): Promise<User> {
    const columns = [
      'id', 'email', 'email_verified_at', 'secondary_email', 'first_name', 'last_name',
      'status', 'mfa_enabled', 'provider_ref', 'password_hash', 'locale', 'time_zone',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('users')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        user.id,
        user.email,
        user.emailVerifiedAt,
        user.secondaryEmail,
        user.firstName,
        user.lastName,
        user.status,
        user.mfaEnabled ? 1 : 0,
        user.providerRef,
        passwordHash,
        user.locale,
        user.timeZone,
      ],
    );
    return user;
  }

  async updatePasswordHash(userId: UserId, passwordHash: string): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q('users')} SET ${this.q('password_hash')} = ${p1} WHERE ${this.q('id')} = ${p2}`,
      [passwordHash, userId],
    );
  }

  /**
   * Every store this user can reach. The join is the authorisation boundary at
   * login time — a store not returned here can never be switched into.
   */
  async membershipsFor(userId: UserId): Promise<readonly (Membership & { store: Store })[]> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<Record<string, unknown>>(
      `SELECT m.${this.q('id')} AS membership_id,
              m.${this.q('user_id')} AS user_id,
              m.${this.q('store_id')} AS store_id,
              m.${this.q('organization_id')} AS organization_id,
              m.${this.q('status')} AS membership_status,
              m.${this.q('invited_by')} AS invited_by,
              m.${this.q('created_at')} AS membership_created_at,
              s.*
         FROM ${this.q('memberships')} m
         JOIN ${this.q('stores')} s ON s.${this.q('id')} = m.${this.q('store_id')}
        WHERE m.${this.q('user_id')} = ${p1}
          AND m.${this.q('deleted_at')} IS NULL
          AND s.${this.q('deleted_at')} IS NULL`,
      [userId],
    );

    return rows.map((row) => ({
      id: String(row.membership_id),
      userId: String(row.user_id) as UserId,
      storeId: String(row.store_id) as StoreId,
      organizationId: String(row.organization_id) as OrganizationId,
      status: String(row.membership_status) as Membership['status'],
      invitedBy: row.invited_by ? (String(row.invited_by) as UserId) : null,
      createdAt: row.membership_created_at as Date,
      store: toStore(row as unknown as StoreRow),
    }));
  }

  /**
   * Effective permissions: the union across every role assigned to this user for
   * this store, plus any org-wide assignment (store_id NULL). Computed, never
   * stored — a cached permission set is a stale permission set.
   */
  async permissionsFor(userId: UserId, storeId: StoreId): Promise<readonly string[]> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<{ permissions: unknown }>(
      `SELECT r.${this.q('permissions')} AS permissions
         FROM ${this.q('role_assignments')} ra
         JOIN ${this.q('roles')} r ON r.${this.q('id')} = ra.${this.q('role_id')}
        WHERE ra.${this.q('user_id')} = ${p1}
          AND (ra.${this.q('store_id')} = ${p2} OR ra.${this.q('store_id')} IS NULL)
          AND r.${this.q('deleted_at')} IS NULL`,
      [userId, storeId],
    );

    const permissions = new Set<string>();
    for (const row of rows) {
      for (const permission of parseJsonArray(row.permissions)) {
        permissions.add(permission);
      }
    }
    return [...permissions].sort();
  }

  async roleKeysFor(userId: UserId, storeId: StoreId): Promise<readonly string[]> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<{ name: string }>(
      `SELECT r.${this.q('name')} AS name
         FROM ${this.q('role_assignments')} ra
         JOIN ${this.q('roles')} r ON r.${this.q('id')} = ra.${this.q('role_id')}
        WHERE ra.${this.q('user_id')} = ${p1}
          AND (ra.${this.q('store_id')} = ${p2} OR ra.${this.q('store_id')} IS NULL)
          AND r.${this.q('deleted_at')} IS NULL`,
      [userId, storeId],
    );
    return rows.map((row) => row.name);
  }

  async mfaSecretFor(userId: UserId): Promise<string | null> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<{ mfa_secret: string | null }>(
      `SELECT ${this.q('mfa_secret')} FROM ${this.q('users')} WHERE ${this.q('id')} = ${p1}`,
      [userId],
    );
    return rows[0]?.mfa_secret ?? null;
  }

  async recoveryCodeHashesFor(userId: UserId): Promise<readonly string[]> {
    const [p1] = this.args(1);
    const rows = await this.executor.query<{ recovery_code_hashes: unknown }>(
      `SELECT ${this.q('recovery_code_hashes')} FROM ${this.q('users')} WHERE ${this.q('id')} = ${p1}`,
      [userId],
    );
    return parseJsonArray(rows[0]?.recovery_code_hashes);
  }

  async replaceRecoveryCodes(userId: UserId, hashes: readonly string[]): Promise<void> {
    const [p1, p2] = this.args(2);
    await this.executor.query(
      `UPDATE ${this.q('users')} SET ${this.q('recovery_code_hashes')} = ${p1} WHERE ${this.q('id')} = ${p2}`,
      [JSON.stringify(hashes), userId],
    );
  }

  // --- provisioning ---------------------------------------------------------

  async createOrganization(organization: Organization): Promise<Organization> {
    const [p1, p2, p3] = this.args(3);
    await this.executor.query(
      `INSERT INTO ${this.q('organizations')} (${this.q('id')}, ${this.q('name')}, ${this.q('require_secure_sign_in')})
       VALUES (${p1}, ${p2}, ${p3})`,
      [organization.id, organization.name, organization.requireSecureSignIn ? 1 : 0],
    );
    return organization;
  }

  async createBusinessEntity(entity: BusinessEntity): Promise<BusinessEntity> {
    const columns = ['id', 'organization_id', 'name', 'country_code', 'company_type', 'tax_registration_id', 'archived_at'];
    await this.executor.query(
      `INSERT INTO ${this.q('business_entities')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        entity.id,
        entity.organizationId,
        entity.name,
        entity.countryCode,
        entity.companyType,
        entity.taxRegistrationId,
        entity.archivedAt,
      ],
    );
    return entity;
  }

  async createStore(store: Store): Promise<Store> {
    const columns = [
      'id', 'organization_id', 'handle', 'name', 'business_entity_id', 'type', 'status',
      'default_locale', 'time_zone', 'base_currency', 'feature_previews',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('stores')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        store.id,
        store.organizationId,
        store.handle,
        store.name,
        store.businessEntityId,
        store.type,
        store.status,
        store.defaultLocale,
        store.timeZone,
        store.baseCurrency,
        JSON.stringify(store.featurePreviews),
      ],
    );
    return store;
  }

  async createMembership(membership: Membership): Promise<Membership> {
    const columns = ['id', 'organization_id', 'user_id', 'store_id', 'status', 'invited_by'];
    await this.executor.query(
      `INSERT INTO ${this.q('memberships')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        membership.id,
        membership.organizationId,
        membership.userId,
        membership.storeId,
        membership.status,
        membership.invitedBy,
      ],
    );
    return membership;
  }

  async createRole(role: {
    id: string;
    organizationId: OrganizationId;
    storeId: StoreId | null;
    category: string;
    name: string;
    description: string;
    permissions: readonly string[];
    system: boolean;
    grantsApproval: boolean;
  }): Promise<void> {
    const columns = [
      'id', 'organization_id', 'store_id', 'category', 'name', 'description',
      'permissions', 'system', 'grants_approval',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('roles')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [
        role.id,
        role.organizationId,
        role.storeId,
        role.category,
        role.name,
        role.description,
        JSON.stringify(role.permissions),
        role.system ? 1 : 0,
        role.grantsApproval ? 1 : 0,
      ],
    );
  }

  async assignRole(assignment: {
    id: string;
    organizationId: OrganizationId;
    userId: UserId;
    roleId: string;
    storeId: StoreId | null;
  }): Promise<void> {
    const columns = ['id', 'organization_id', 'user_id', 'role_id', 'store_id'];
    await this.executor.query(
      `INSERT INTO ${this.q('role_assignments')} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${this.args(columns.length).join(', ')})`,
      [assignment.id, assignment.organizationId, assignment.userId, assignment.roleId, assignment.storeId],
    );
  }
}

function toUser(row: UserRow): User {
  return {
    id: String(row.id) as UserId,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    secondaryEmail: row.secondary_email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status as User['status'],
    mfaEnabled: Boolean(Number(row.mfa_enabled)),
    providerRef: row.provider_ref,
    locale: row.locale ?? 'en-US',
    timeZone: row.time_zone ?? 'UTC',
    createdAt: row.created_at,
  };
}

function toStore(row: StoreRow): Store {
  return {
    id: String(row.id) as StoreId,
    organizationId: String(row.organization_id) as OrganizationId,
    businessEntityId: row.business_entity_id ? (String(row.business_entity_id) as never) : null,
    handle: row.handle,
    name: row.name,
    type: row.type as Store['type'],
    status: row.status as Store['status'],
    defaultLocale: row.default_locale ?? 'en-US',
    timeZone: row.time_zone ?? 'UTC',
    baseCurrency: row.base_currency ?? 'USD',
    featurePreviews: parseJsonArray(row.feature_previews),
    createdAt: row.created_at,
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

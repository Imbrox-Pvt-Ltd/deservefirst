/**
 * Auth · infrastructure/session.repository.ts
 * Sessions and in-progress login flows.
 *
 * Both are platform-scoped, not store-scoped, and that is the point: a session
 * belongs to a PERSON, who may be a member of several stores and switches
 * between them without logging in again (§5.1). Scoping the session to a store
 * would make "switch store" mean "sign in again", which is the behaviour the
 * multi-store model exists to avoid.
 *
 * The refresh token is stored only as a hash. A leaked sessions table must not
 * be a set of working credentials, and there is never a reason to read the
 * original back — it is compared, not recovered.
 * Layer: infrastructure.
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import type { SqlDialect } from '../../core/list-engine/dialect';
import type { LoginFlowRepository, SessionRepository } from '../application';
import type { LoginFlow, Session } from '../domain';

interface SessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  store_id: string | null;
  organization_id: string | null;
  refresh_token_hash: string;
  device_label: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

const date = (value: Date | string | null): Date | null => (value ? new Date(value) : null);

export class SqlSessionRepository implements SessionRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private toDomain(row: SessionRow): Session {
    return {
      id: row.id,
      userId: row.user_id as UserId,
      storeId: row.store_id as StoreId | null,
      organizationId: row.organization_id as OrganizationId | null,
      refreshTokenHash: row.refresh_token_hash,
      deviceLabel: row.device_label,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: date(row.created_at)!,
      lastSeenAt: date(row.last_seen_at)!,
      expiresAt: date(row.expires_at)!,
      revokedAt: date(row.revoked_at),
    };
  }

  async create(session: Session): Promise<Session> {
    const values: Record<string, unknown> = {
      id: session.id,
      handle: session.id,
      user_id: session.userId,
      store_id: session.storeId,
      organization_id: session.organizationId,
      refresh_token_hash: session.refreshTokenHash,
      device_label: session.deviceLabel,
      ip_address: session.ipAddress,
      user_agent: session.userAgent,
      last_seen_at: session.lastSeenAt,
      expires_at: session.expiresAt,
      revoked_at: session.revokedAt,
      version: 1,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('sessions')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, i) => this.p(i + 1)).join(', ')})`,
      Object.values(values),
    );
    return session;
  }

  async findById(id: string): Promise<Session | null> {
    const rows = await this.executor.query<SessionRow>(
      `SELECT * FROM ${this.q('sessions')} WHERE ${this.q('id')} = ${this.p(1)} LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async findByRefreshHash(hash: string): Promise<Session | null> {
    const rows = await this.executor.query<SessionRow>(
      `SELECT * FROM ${this.q('sessions')} WHERE ${this.q('refresh_token_hash')} = ${this.p(1)} LIMIT 1`,
      [hash],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async listForUser(userId: UserId): Promise<readonly Session[]> {
    const rows = await this.executor.query<SessionRow>(
      `SELECT * FROM ${this.q('sessions')}
        WHERE ${this.q('user_id')} = ${this.p(1)} AND ${this.q('revoked_at')} IS NULL
        ORDER BY ${this.q('last_seen_at')} DESC`,
      [userId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async rotate(sessionId: string, refreshTokenHash: string, expiresAt: Date): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('sessions')}
          SET ${this.q('refresh_token_hash')} = ${this.p(1)},
              ${this.q('expires_at')} = ${this.p(2)},
              ${this.q('last_seen_at')} = ${this.p(3)}
        WHERE ${this.q('id')} = ${this.p(4)}`,
      [refreshTokenHash, expiresAt, new Date(), sessionId],
    );
  }

  async rescope(sessionId: string, storeId: StoreId, organizationId: OrganizationId): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('sessions')}
          SET ${this.q('store_id')} = ${this.p(1)}, ${this.q('organization_id')} = ${this.p(2)}
        WHERE ${this.q('id')} = ${this.p(3)}`,
      [storeId, organizationId, sessionId],
    );
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('sessions')} SET ${this.q('revoked_at')} = ${this.p(1)} WHERE ${this.q('id')} = ${this.p(2)}`,
      [at, sessionId],
    );
  }

  async revokeAllForUser(userId: UserId, at: Date, exceptSessionId?: string): Promise<number> {
    const parameters: unknown[] = [at, userId];
    if (exceptSessionId) parameters.push(exceptSessionId);

    const rows = await this.executor.query<{ id: string }>(
      `SELECT ${this.q('id')} FROM ${this.q('sessions')}
        WHERE ${this.q('user_id')} = ${this.p(2)}
          AND ${this.q('revoked_at')} IS NULL
          ${exceptSessionId ? `AND ${this.q('id')} <> ${this.p(3)}` : ''}`,
      parameters,
    );

    if (rows.length > 0) {
      await this.executor.query(
        `UPDATE ${this.q('sessions')} SET ${this.q('revoked_at')} = ${this.p(1)}
          WHERE ${this.q('user_id')} = ${this.p(2)}
            AND ${this.q('revoked_at')} IS NULL
            ${exceptSessionId ? `AND ${this.q('id')} <> ${this.p(3)}` : ''}`,
        parameters,
      );
    }
    return rows.length;
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('sessions')} SET ${this.q('last_seen_at')} = ${this.p(1)} WHERE ${this.q('id')} = ${this.p(2)}`,
      [at, sessionId],
    );
  }
}

interface FlowRow extends Record<string, unknown> {
  id: string;
  step: string;
  email: string | null;
  user_id: string | null;
  return_path: string | null;
  attempts: number;
  created_at: Date | string;
  expires_at: Date | string;
}

/**
 * A login flow is short-lived server state for a login in progress.
 *
 * It exists so the steps — password, MFA, choosing a store — cannot be skipped
 * or reordered by a client that simply posts to the last one. The rid is the
 * only thing the browser holds, and it proves nothing on its own.
 */
export class SqlLoginFlowRepository implements LoginFlowRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  async create(flow: LoginFlow): Promise<void> {
    const values: Record<string, unknown> = {
      id: flow.rid,
      handle: flow.rid,
      rid: flow.rid,
      step: flow.step,
      email: flow.email,
      user_id: flow.userId,
      return_path: flow.returnPath,
      attempts: flow.attempts,
      expires_at: flow.expiresAt,
      version: 1,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('login_flows')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, i) => this.p(i + 1)).join(', ')})`,
      Object.values(values),
    );
  }

  async find(rid: string): Promise<LoginFlow | null> {
    const rows = await this.executor.query<FlowRow>(
      `SELECT * FROM ${this.q('login_flows')} WHERE ${this.q('id')} = ${this.p(1)} LIMIT 1`,
      [rid],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      rid: row.id,
      step: row.step as LoginFlow['step'],
      email: row.email,
      userId: row.user_id as UserId | null,
      returnPath: row.return_path,
      attempts: Number(row.attempts),
      startedAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  async update(flow: LoginFlow): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('login_flows')}
          SET ${this.q('step')} = ${this.p(1)},
              ${this.q('email')} = ${this.p(2)},
              ${this.q('user_id')} = ${this.p(3)},
              ${this.q('attempts')} = ${this.p(4)}
        WHERE ${this.q('id')} = ${this.p(5)}`,
      [flow.step, flow.email, flow.userId, flow.attempts, flow.rid],
    );
  }

  async recordAttempt(rid: string): Promise<void> {
    // Incremented in the database rather than read-modify-written, so two
    // simultaneous guesses both count. Counting attempts is the whole defence;
    // losing one to a race is losing the defence.
    await this.executor.query(
      `UPDATE ${this.q('login_flows')}
          SET ${this.q('attempts')} = ${this.q('attempts')} + 1
        WHERE ${this.q('id')} = ${this.p(1)}`,
      [rid],
    );
  }
}

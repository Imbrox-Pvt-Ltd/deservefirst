/**
 * Apps · infrastructure/app.repository.ts
 * Storage for apps, installs, codes and tokens.
 *
 * All four tables are platform-scoped. That is not an oversight: an app exists
 * above any store, and the install and token rows are precisely the records
 * that decide which store a caller may touch. Putting them behind the store
 * guard would be circular — the row that grants access cannot itself sit behind
 * that access.
 * Layer: infrastructure.
 */

import { createHash } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../core/list-engine/dialect';
import type { App, AppInstallation, AppToken, AuthorizationCode } from '../domain/app';

/**
 * Secrets and tokens are stored as a SHA-256 digest.
 *
 * Not a password hash: these are 256 bits of randomness we generated, so there
 * is nothing to brute-force and a slow KDF would only add latency to every API
 * call. What matters is that the stored form is not usable if it leaks, and a
 * digest achieves that.
 */
export function digestOf(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface AppRow extends Record<string, unknown> {
  id: string;
  partner_id: string;
  name: string;
  handle: string;
  status: string;
  distribution: string;
  app_url: string | null;
  redirect_uris: unknown;
  requested_scopes: unknown;
  client_id: string;
  client_secret_hash: string;
  version: number;
}

interface InstallationRow extends Record<string, unknown> {
  id: string;
  app_id: string;
  store_id: string;
  status: string;
  granted_scopes: unknown;
  installed_at: Date;
  uninstalled_at: Date | null;
}

interface CodeRow extends Record<string, unknown> {
  code: string;
  app_id: string;
  store_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: unknown;
  token_type: string;
  expires_at: Date;
  used_at: Date | null;
}

interface TokenRow extends Record<string, unknown> {
  id: string;
  app_id: string;
  store_id: string;
  token_type: string;
  user_id: string | null;
  token_hash: string;
  scopes: unknown;
  expires_at: Date | null;
  revoked_at: Date | null;
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

function toApp(row: AppRow): App {
  return {
    id: row.id,
    partnerId: row.partner_id,
    name: row.name,
    handle: row.handle,
    status: row.status as App['status'],
    distribution: row.distribution as App['distribution'],
    appUrl: row.app_url,
    redirectUris: toList(row.redirect_uris),
    requestedScopes: toList(row.requested_scopes),
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    version: Number(row.version),
  };
}

function toInstallation(row: InstallationRow): AppInstallation {
  return {
    id: row.id,
    appId: row.app_id,
    storeId: row.store_id as StoreId,
    status: row.status as AppInstallation['status'],
    grantedScopes: toList(row.granted_scopes),
    installedAt: row.installed_at,
    uninstalledAt: row.uninstalled_at,
  };
}

function toCode(row: CodeRow): AuthorizationCode {
  return {
    code: row.code,
    appId: row.app_id,
    storeId: row.store_id as StoreId,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    scopes: toList(row.scopes),
    tokenType: row.token_type as AuthorizationCode['tokenType'],
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

function toToken(row: TokenRow): AppToken {
  return {
    id: row.id,
    appId: row.app_id,
    storeId: row.store_id as StoreId,
    tokenType: row.token_type as AppToken['tokenType'],
    userId: row.user_id,
    tokenHash: row.token_hash,
    scopes: toList(row.scopes),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SqlAppRepository {
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

  private async runWrite(sql: string, parameters: readonly unknown[]): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const rows = await this.executor.query<{ id: string }>(`${sql} RETURNING 1 AS ${this.q('id')}`, parameters);
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

  // --- apps ------------------------------------------------------------------

  async findApp(id: string): Promise<App | null> {
    const rows = await this.executor.query<AppRow>(
      `SELECT * FROM ${this.q('apps')} WHERE ${this.q('id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? toApp(rows[0]) : null;
  }

  async findAppByClientId(clientId: string): Promise<App | null> {
    const rows = await this.executor.query<AppRow>(
      `SELECT * FROM ${this.q('apps')} WHERE ${this.q('client_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [clientId],
    );
    return rows[0] ? toApp(rows[0]) : null;
  }

  async appsForPartner(partnerId: string): Promise<readonly App[]> {
    const rows = await this.executor.query<AppRow>(
      `SELECT * FROM ${this.q('apps')}
        WHERE ${this.q('partner_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('created_at')} DESC`,
      [partnerId],
    );
    return rows.map(toApp);
  }

  async insertApp(app: App): Promise<void> {
    const columns = [
      'id', 'partner_id', 'name', 'handle', 'status', 'distribution', 'app_url',
      'redirect_uris', 'requested_scopes', 'client_id', 'client_secret_hash', 'version',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('apps')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        app.id, app.partnerId, app.name, app.handle, app.status, app.distribution, app.appUrl,
        JSON.stringify(app.redirectUris), JSON.stringify(app.requestedScopes),
        app.clientId, app.clientSecretHash, app.version,
      ],
    );
  }

  async updateApp(app: App): Promise<boolean> {
    const affected = await this.runWrite(
      `UPDATE ${this.q('apps')} SET
         ${this.q('name')} = ${this.p(1)},
         ${this.q('status')} = ${this.p(2)},
         ${this.q('distribution')} = ${this.p(3)},
         ${this.q('app_url')} = ${this.p(4)},
         ${this.q('redirect_uris')} = ${this.p(5)},
         ${this.q('requested_scopes')} = ${this.p(6)},
         ${this.q('version')} = ${this.q('version')} + 1
       WHERE ${this.q('id')} = ${this.p(7)} AND ${this.q('version')} = ${this.p(8)}`,
      [
        app.name, app.status, app.distribution, app.appUrl,
        JSON.stringify(app.redirectUris), JSON.stringify(app.requestedScopes),
        app.id, app.version,
      ],
    );
    return affected > 0;
  }

  // --- installations ---------------------------------------------------------

  async findInstallation(appId: string, storeId: StoreId): Promise<AppInstallation | null> {
    const rows = await this.executor.query<InstallationRow>(
      `SELECT * FROM ${this.q('app_installations')}
        WHERE ${this.q('app_id')} = ${this.p(1)} AND ${this.q('store_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [appId, storeId],
    );
    return rows[0] ? toInstallation(rows[0]) : null;
  }

  /** Everything installed on one store, with each app's name for the screen. */
  async installationsForStore(
    storeId: StoreId,
  ): Promise<readonly { installation: AppInstallation; appName: string; appHandle: string }[]> {
    const rows = await this.executor.query<InstallationRow & { app_name: string; app_handle: string }>(
      `SELECT i.*, a.${this.q('name')} AS app_name, a.${this.q('handle')} AS app_handle
         FROM ${this.q('app_installations')} i
         JOIN ${this.q('apps')} a ON a.${this.q('id')} = i.${this.q('app_id')}
        WHERE i.${this.q('store_id')} = ${this.p(1)} AND i.${this.q('deleted_at')} IS NULL
        ORDER BY i.${this.q('installed_at')} DESC`,
      [storeId],
    );
    return rows.map((row: InstallationRow & { app_name: string; app_handle: string }) => ({
      installation: toInstallation(row),
      appName: row.app_name,
      appHandle: row.app_handle,
    }));
  }

  async insertInstallation(installation: AppInstallation): Promise<void> {
    const columns = [
      'id', 'app_id', 'store_id', 'status', 'granted_scopes', 'installed_at', 'uninstalled_at',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('app_installations')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        installation.id, installation.appId, installation.storeId, installation.status,
        JSON.stringify(installation.grantedScopes), installation.installedAt,
        installation.uninstalledAt,
      ],
    );
  }

  async saveInstallation(installation: AppInstallation): Promise<void> {
    await this.runWrite(
      `UPDATE ${this.q('app_installations')} SET
         ${this.q('status')} = ${this.p(1)},
         ${this.q('granted_scopes')} = ${this.p(2)},
         ${this.q('installed_at')} = ${this.p(3)},
         ${this.q('uninstalled_at')} = ${this.p(4)}
       WHERE ${this.q('id')} = ${this.p(5)}`,
      [
        installation.status,
        JSON.stringify(installation.grantedScopes),
        installation.installedAt,
        installation.uninstalledAt,
        installation.id,
      ],
    );
  }

  // --- authorization codes ---------------------------------------------------

  async insertCode(code: AuthorizationCode): Promise<void> {
    const columns = [
      'id', 'code', 'app_id', 'store_id', 'user_id', 'redirect_uri', 'scopes',
      'token_type', 'expires_at', 'used_at',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('app_authorization_codes')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        // The code doubles as the row id: it is unique, unguessable, and this
        // removes a second identifier that would have to be kept in step.
        code.code, code.code, code.appId, code.storeId, code.userId, code.redirectUri,
        JSON.stringify(code.scopes), code.tokenType, code.expiresAt, code.usedAt,
      ],
    );
  }

  async findCode(code: string): Promise<AuthorizationCode | null> {
    const rows = await this.executor.query<CodeRow>(
      `SELECT * FROM ${this.q('app_authorization_codes')} WHERE ${this.q('code')} = ${this.p(1)} LIMIT 1`,
      [code],
    );
    return rows[0] ? toCode(rows[0]) : null;
  }

  /**
   * Marks a code used, and reports whether THIS caller was the one who did it.
   *
   * The `used_at IS NULL` predicate is the single-use guarantee, not the check
   * in the domain: two exchanges arriving together would both pass a read-then-
   * write check, and exactly one can win this UPDATE.
   */
  async claimCode(code: string, at: Date): Promise<boolean> {
    const affected = await this.runWrite(
      `UPDATE ${this.q('app_authorization_codes')} SET ${this.q('used_at')} = ${this.p(1)}
        WHERE ${this.q('code')} = ${this.p(2)} AND ${this.q('used_at')} IS NULL`,
      [at, code],
    );
    return affected > 0;
  }

  // --- tokens ----------------------------------------------------------------

  async insertToken(token: AppToken): Promise<void> {
    const columns = [
      'id', 'app_id', 'store_id', 'token_type', 'user_id', 'token_hash', 'scopes',
      'expires_at', 'revoked_at',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('app_tokens')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        token.id, token.appId, token.storeId, token.tokenType, token.userId,
        token.tokenHash, JSON.stringify(token.scopes), token.expiresAt, token.revokedAt,
      ],
    );
  }

  async findTokenByHash(hash: string): Promise<AppToken | null> {
    const rows = await this.executor.query<TokenRow>(
      `SELECT * FROM ${this.q('app_tokens')} WHERE ${this.q('token_hash')} = ${this.p(1)} LIMIT 1`,
      [hash],
    );
    return rows[0] ? toToken(rows[0]) : null;
  }

  /** Kills every token an app holds for one store. Used by uninstall. */
  async revokeTokensFor(appId: string, storeId: StoreId, at: Date): Promise<number> {
    return this.runWrite(
      `UPDATE ${this.q('app_tokens')} SET ${this.q('revoked_at')} = ${this.p(1)}
        WHERE ${this.q('app_id')} = ${this.p(2)} AND ${this.q('store_id')} = ${this.p(3)}
          AND ${this.q('revoked_at')} IS NULL`,
      [at, appId, storeId],
    );
  }
}

/**
 * Storefront · infrastructure/sql-store-resolver.ts
 * A hostname becomes a store, or nothing.
 *
 * This is the tenant boundary for every anonymous request the platform serves,
 * so the shape matters more than the code. The subdomain is **extracted and
 * then looked up** — never trusted as an identifier. A store id parsed out of a
 * header would be a tenant boundary made of string manipulation, and the only
 * thing standing between two merchants' data would be a regular expression.
 *
 * A host that is not ours resolves to nothing, and the transport answers 404
 * without saying which hosts do exist.
 * Layer: infrastructure.
 */

import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import type { ResolvedStore, StoreResolver } from '../api/storefront-ports';
import type { ThemeSource } from '../domain';
import { FilesystemThemeSource } from './filesystem-theme-source';
import { SqlStorefrontData } from './sql-storefront-data';

export interface StoreResolverOptions {
  /** The suffix storefronts live under, e.g. `stores.deservefirst.example`. */
  readonly storefrontHost: string;
  /** Where filesystem-backed themes are rooted, in development. */
  readonly themeRoot: string;
}

interface Row extends Record<string, unknown> {}

export class SqlStoreResolver implements StoreResolver {
  /**
   * Resolutions are cached briefly, keyed by host.
   *
   * A storefront resolves the store on every request, and that is one query
   * before any real work. The window is short because publishing a theme or
   * pausing a store must take effect quickly — a merchant who publishes and
   * sees no change assumes it failed and publishes again.
   */
  private readonly cache = new Map<string, { at: number; store: ResolvedStore | null }>();
  private static readonly TTL_MS = 5_000;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly options: StoreResolverOptions,
    private readonly now: () => number = () => Date.now(),
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  async resolve(host: string): Promise<ResolvedStore | null> {
    const cached = this.cache.get(host);
    if (cached && this.now() - cached.at < SqlStoreResolver.TTL_MS) return cached.store;

    const store = await this.lookup(host);
    this.cache.set(host, { at: this.now(), store });
    return store;
  }

  private async lookup(host: string): Promise<ResolvedStore | null> {
    const handle = this.handleFor(host);
    if (handle === null) return null;

    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('handle')}, ${this.q('type')}, ${this.q('status')}
         FROM ${this.q('stores')}
        WHERE ${this.q('handle')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [handle],
    );

    const row = rows[0];
    if (!row) return null;

    /**
     * A closed store is not served at all.
     *
     * `paused` and `closed` are different from `password_protected`: the first
     * two mean the store should not answer, the third means it answers with a
     * password page. Conflating them would either serve a closed store's
     * catalogue or hide a merchant's own preview.
     */
    const status = String(row.status ?? 'active');
    if (status === 'closed') return null;

    const storeId = String(row.id);
    const theme = await this.themeFor(storeId);
    if (!theme) return null;

    return {
      storeId,
      theme,
      closed: status === 'paused' || String(row.type) === 'password_protected',
      data: new SqlStorefrontData(this.executor, this.options.storefrontHost, this.dialect),
    };
  }

  /**
   * The store handle a hostname refers to, or null.
   *
   * Only the platform's own storefront suffix for now. Custom domains need
   * their own table and a verification step — a host that merely *claims* to be
   * a store is not one, and accepting the claim would let anyone point a
   * hostname at us and serve someone else's shop under it.
   */
  private handleFor(host: string): string | null {
    const suffix = `.${this.options.storefrontHost}`;
    if (!host.endsWith(suffix)) return null;

    const handle = host.slice(0, -suffix.length);
    // One label. `a.b.stores.example` is not a store, and treating it as one
    // would make the boundary depend on how many dots an attacker used.
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(handle)) return null;
    return handle;
  }

  /**
   * The published theme for a store.
   *
   * Object-store themes are not implemented yet, so a store whose theme lives
   * there resolves to nothing rather than to a half-rendered page — an empty
   * storefront is a clearer failure than one missing every section.
   */
  private async themeFor(
    storeId: string,
  ): Promise<(ThemeSource & { manifest(): Promise<ReadonlySet<string>> }) | null> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('source_kind')}, ${this.q('source_ref')} FROM ${this.q('themes')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('role')} = 'main'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [storeId],
    );

    const row = rows[0];
    if (!row) return null;
    if (String(row.source_kind) !== 'filesystem') return null;

    const reference = String(row.source_ref);
    // The reference is merchant-adjacent data that becomes a path, so it is
    // confined to one directory name under the configured root.
    if (!/^[A-Za-z0-9][\w.-]*$/.test(reference)) return null;

    return new FilesystemThemeSource(`${this.options.themeRoot}/${reference}`);
  }

  /** Drops a cached resolution, for when a theme is published. */
  forget(host: string): void {
    this.cache.delete(host);
  }
}

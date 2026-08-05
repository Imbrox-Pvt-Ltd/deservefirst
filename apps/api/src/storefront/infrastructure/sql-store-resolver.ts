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
import type { ResolvedStore, StorefrontSubmissions, StoreResolver } from '../api/storefront-ports';
import type { ThemeSource } from '../domain';
import { FilesystemThemeSource } from './filesystem-theme-source';
import { SqlStorefrontData } from './sql-storefront-data';

export interface StoreResolverOptions {
  /** The suffix storefronts live under, e.g. `stores.deservefirst.example`. */
  readonly storefrontHost: string;
  /** Where filesystem-backed themes are rooted, in development. */
  readonly themeRoot: string;
  /**
   * Builds what carries out a form submission for one store.
   *
   * A factory rather than an instance: the quote service is store-scoped, and a
   * single one shared across every storefront request would serve whichever
   * store happened to construct it.
   */
  readonly submissionsFor?: (storeId: string, currency: string) => StorefrontSubmissions;
  /**
   * Where a theme's files live, given its id and what it points at.
   *
   * Supplied rather than decided here, because the editor needs the same
   * answer — and when the two worked it out separately they disagreed the
   * moment versions arrived. Publishing wrote to
   * `.versions/{themeId}/{ref}` while this looked in `{root}/{ref}`, so a
   * successful publish returned a 500 to every visitor.
   */
  readonly themeSourceFor?: (
    theme: { id: string; versionRef: string },
  ) => ThemeSource & { manifest(): Promise<ReadonlySet<string>> };
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
    /**
     * The platform's own subdomain first, then a connected domain.
     *
     * Order matters. The subdomain is derived from the handle and is
     * unforgeable — it cannot be claimed by a row — so checking it first means
     * no `store_domains` record can ever shadow the hostname a store is
     * guaranteed to answer on. `normaliseDomain` already refuses to store one,
     * and this is the second lock on the same door.
     */
    const handle = this.handleFor(host);
    const rows =
      handle !== null ? await this.storeByHandle(handle) : await this.storeByConnectedDomain(host);

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
      primaryHost: await this.primaryHostFor(storeId),
      closed: status === 'paused' || String(row.type) === 'password_protected',
      data: new SqlStorefrontData(this.executor, this.options.storefrontHost, this.dialect),
      /**
       * Absent when the platform cannot yet take submissions.
       *
       * The handler says so plainly rather than pretending a form worked, which
       * would lose a customer's enquiry silently.
       */
      submissions: this.options.submissionsFor?.(
        storeId,
        String(row.base_currency ?? 'USD'),
      ),
    };
  }

  private storeByHandle(handle: string): Promise<Row[]> {
    return this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('handle')}, ${this.q('type')}, ${this.q('status')},
              ${this.q('base_currency')}
         FROM ${this.q('stores')}
        WHERE ${this.q('handle')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [handle],
    );
  }

  /**
   * A hostname a merchant connected and PROVED they own.
   *
   * `status = 'verified'` is not a detail of this query, it is the whole point.
   * A row in `store_domains` records a claim; anyone may claim any hostname,
   * because DNS takes days to propagate and the claim has to exist before the
   * proof does. Dropping this condition would serve a store from any name
   * anybody typed into a form — including one they do not own.
   */
  private storeByConnectedDomain(host: string): Promise<Row[]> {
    return this.executor.query<Row>(
      `SELECT ${this.q('s')}.${this.q('id')}, ${this.q('s')}.${this.q('handle')},
              ${this.q('s')}.${this.q('type')}, ${this.q('s')}.${this.q('status')},
              ${this.q('s')}.${this.q('base_currency')}
         FROM ${this.q('store_domains')} ${this.q('d')}
         JOIN ${this.q('stores')} ${this.q('s')}
           ON ${this.q('s')}.${this.q('id')} = ${this.q('d')}.${this.q('store_id')}
        WHERE ${this.q('d')}.${this.q('host')} = ${this.p(1)}
          AND ${this.q('d')}.${this.q('status')} = 'verified'
          AND ${this.q('d')}.${this.q('deleted_at')} IS NULL
          AND ${this.q('s')}.${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [host],
    );
  }

  /**
   * The hostname this store canonically lives at, if it has one.
   *
   * Read on resolution rather than per render, because the transport needs it
   * before it decides whether to redirect — and it is cached with the rest of
   * the resolution, so this costs one query per store per five seconds rather
   * than one per request.
   */
  private async primaryHostFor(storeId: string): Promise<string | null> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('host')} FROM ${this.q('store_domains')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('role')} = 'primary'
          AND ${this.q('status')} = 'verified'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [storeId],
    );
    return rows[0] ? String(rows[0].host) : null;
  }

  /**
   * The store handle a hostname refers to, or null.
   *
   * The platform's own storefront suffix only. A hostname outside it is a
   * connected domain or nothing — see `storeByConnectedDomain`, where the
   * verification requirement lives.
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
      `SELECT ${this.q('id')}, ${this.q('source_kind')}, ${this.q('source_ref')} FROM ${this.q('themes')}
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
    // Merchant-adjacent data that becomes a path, so it is constrained before
    // anything reads it.
    if (!/^[A-Za-z0-9][\w.-]*$/.test(reference)) return null;

    /**
     * One place decides where a theme's files are.
     *
     * The composition root supplies this, and gives the editor the same
     * function — so a version written by a publish is read by the storefront
     * without either having to know the layout.
     */
    if (this.options.themeSourceFor) {
      return this.options.themeSourceFor({ id: String(row.id), versionRef: reference });
    }

    return new FilesystemThemeSource(`${this.options.themeRoot}/${reference}`);
  }

  /** Drops a cached resolution, for when a theme is published. */
  forget(host: string): void {
    this.cache.delete(host);
  }
}

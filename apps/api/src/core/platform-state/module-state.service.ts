/**
 * Core · platform-state/module-state.service.ts
 * Who may turn a module on, and who may turn it off.
 *
 * Two levels, and the order between them is the point:
 *
 *   platform admin  →  store  →  (plan entitlement)
 *
 * A platform admin's decision is FIRST and absolute: disabling a module
 * platform-wide takes it away from every store, and no store setting can put it
 * back. That is what makes it usable as an incident control — turning a broken
 * module off has to be one action with no exceptions, not one action per tenant
 * that a tenant can then undo.
 *
 * A store's toggle only narrows what the platform already permits (§5.2). The
 * asymmetry is deliberate: "on" is a request, "off" is a guarantee.
 *
 * An absent row means "no decision recorded", which resolves to enabled. A newly
 * deployed module is available unless somebody says otherwise — the alternative
 * makes every release a scavenger hunt for the toggle that turns it on.
 * Layer: core.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import type { CacheService } from '../cache/cache.service';
import type { QueryExecutor } from '../list-engine';
import type { SqlDialect } from '../list-engine/dialect';

export type ModuleAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly blockedBy: 'platform' | 'store'; readonly reason: string };

export interface ModuleStateOptions {
  readonly executor: QueryExecutor;
  readonly dialect: SqlDialect;
  readonly cache: CacheService;
  /** Modules the registry actually loaded, so an unknown id is not silently "on". */
  readonly known: () => readonly string[];
}

const PLATFORM_TABLE = 'platform_module_states';
const STORE_TABLE = 'store_module_states';

/** Platform decisions change rarely and are read on every request. */
const PLATFORM_CACHE_TAG = 'platform:module-states';
const CACHE_TTL_SECONDS = 60;

interface StateRow extends Record<string, unknown> {
  handle: string;
  enabled: number | boolean;
  reason: string | null;
}

export class ModuleStateService {
  constructor(private readonly options: ModuleStateOptions) {}

  private q(name: string): string {
    return this.options.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.options.dialect.placeholder(index);
  }

  /**
   * Platform-wide decisions, keyed by module id.
   *
   * Cached because every authorisation check reads this and it changes when a
   * platform admin acts, which is rare. The cache is dropped on every write
   * rather than expiring on its own — a kill switch that takes a minute to take
   * effect is not a kill switch.
   */
  private async platformStates(): Promise<ReadonlyMap<string, { enabled: boolean; reason: string }>> {
    const entries = await this.options.cache.wrap<[string, { enabled: boolean; reason: string }][]>(
      this.options.cache.platformKey('module-states'),
      { ttlSeconds: CACHE_TTL_SECONDS, tags: [PLATFORM_CACHE_TAG] },
      async () => {
        const rows = await this.options.executor.query<StateRow>(
          `SELECT ${this.q('handle')}, ${this.q('enabled')}, ${this.q('reason')}
             FROM ${this.q(PLATFORM_TABLE)}
            WHERE ${this.q('deleted_at')} IS NULL`,
          [],
        );

        return rows.map((row) => [
          row.handle,
          { enabled: Boolean(Number(row.enabled)), reason: row.reason ?? 'No reason recorded.' },
        ]);
      },
    );

    return new Map(entries);
  }

  /** True unless a platform admin has explicitly turned this module off. */
  async isEnabledPlatformWide(moduleId: string): Promise<boolean> {
    const state = (await this.platformStates()).get(moduleId);
    return state ? state.enabled : true;
  }

  async isEnabledForStore(storeId: StoreId, moduleId: string): Promise<boolean> {
    // The platform's decision is checked first and cannot be overridden below.
    if (!(await this.isEnabledPlatformWide(moduleId))) return false;

    const rows = await this.options.executor.query<StateRow>(
      `SELECT ${this.q('enabled')} FROM ${this.q(STORE_TABLE)}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [storeId, moduleId],
    );

    const row = rows[0];
    return row ? Boolean(Number(row.enabled)) : true;
  }

  /** The full answer, including which level said no — support needs to know. */
  async availability(storeId: StoreId, moduleId: string): Promise<ModuleAvailability> {
    const platform = (await this.platformStates()).get(moduleId);
    if (platform && !platform.enabled) {
      return { available: false, blockedBy: 'platform', reason: platform.reason };
    }

    const enabledHere = await this.isEnabledForStore(storeId, moduleId);
    if (!enabledHere) {
      return { available: false, blockedBy: 'store', reason: 'Turned off for this store.' };
    }

    return { available: true };
  }

  /** Platform-wide state for every loaded module, for the platform admin screen. */
  async platformOverview(): Promise<
    readonly { moduleId: string; enabled: boolean; reason: string | null }[]
  > {
    const states = await this.platformStates();
    return this.options.known().map((moduleId) => {
      const state = states.get(moduleId);
      return {
        moduleId,
        enabled: state ? state.enabled : true,
        reason: state && !state.enabled ? state.reason : null,
      };
    });
  }

  /**
   * The platform admin's switch. Disabling requires a reason, because the person
   * who finds a module missing is never the person who turned it off.
   */
  async setPlatformState(moduleId: string, enabled: boolean, reason?: string): Promise<void> {
    this.assertKnown(moduleId);
    if (!enabled && !reason?.trim()) {
      throw new ModuleStateError('Disabling a module platform-wide needs a reason.');
    }

    await this.upsert(PLATFORM_TABLE, null, moduleId, enabled, reason?.trim() ?? null);
    // Invalidated rather than left to expire: a kill switch that takes a minute
    // to take effect is not a kill switch.
    await this.options.cache.invalidateTags([PLATFORM_CACHE_TAG]);
  }

  /** A store's own toggle. It can only narrow what the platform permits. */
  async setStoreState(storeId: StoreId, moduleId: string, enabled: boolean): Promise<void> {
    this.assertKnown(moduleId);
    if (enabled && !(await this.isEnabledPlatformWide(moduleId))) {
      throw new ModuleStateError(
        `"${moduleId}" is disabled platform-wide and cannot be enabled for one store.`,
      );
    }

    await this.upsert(STORE_TABLE, storeId, moduleId, enabled, null);
  }

  private assertKnown(moduleId: string): void {
    if (!this.options.known().includes(moduleId)) {
      throw new ModuleStateError(`No module "${moduleId}" is loaded on this platform.`);
    }
  }

  /**
   * Written as delete-then-insert rather than a dialect-specific upsert.
   *
   * `ON DUPLICATE KEY UPDATE` and `ON CONFLICT` are spelled differently in MySQL
   * and Postgres, and this table is written a handful of times a year by an
   * operator — the portability is worth more here than the round trip.
   */
  private async upsert(
    table: string,
    storeId: StoreId | null,
    moduleId: string,
    enabled: boolean,
    reason: string | null,
  ): Promise<void> {
    const scoped = storeId !== null;

    await this.options.executor.query(
      `DELETE FROM ${this.q(table)}
        WHERE ${scoped ? `${this.q('store_id')} = ${this.p(1)} AND ` : ''}${this.q('handle')} = ${this.p(scoped ? 2 : 1)}`,
      scoped ? [storeId, moduleId] : [moduleId],
    );

    const columns = scoped
      ? ['id', 'store_id', 'handle', 'module_id', 'enabled', 'version']
      : ['id', 'handle', 'module_id', 'enabled', 'reason', 'version'];
    const values = scoped
      ? [randomUUID(), storeId, moduleId, moduleId, enabled ? 1 : 0, 1]
      : [randomUUID(), moduleId, moduleId, enabled ? 1 : 0, reason, 1];

    await this.options.executor.query(
      `INSERT INTO ${this.q(table)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      values,
    );
  }
}

export class ModuleStateError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ModuleStateError';
  }
}

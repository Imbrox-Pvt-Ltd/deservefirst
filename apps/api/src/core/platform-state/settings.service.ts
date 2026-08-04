/**
 * Core · platform-state/settings.service.ts
 * Where a setting's value actually comes from.
 *
 * Four sources, most specific first:
 *
 *   1. store     — what this store chose
 *   2. platform   — what the platform admin set as the default for every store
 *   3. environment — DF_SETTING_* , for deployment-specific values
 *   4. manifest    — the module author's declared default, in code
 *
 * The store comes first because a setting is the store's business; the platform
 * level exists to move the DEFAULT, not to overrule a store that has decided.
 * That is the opposite of module enablement, where the platform is absolute —
 * and the difference is intentional. Turning a module off is an operational act
 * that must hold everywhere; choosing a currency format is not.
 *
 * Every read reports its source alongside its value. A settings screen that
 * shows a value without saying where it came from is how somebody "changes" a
 * setting that was never theirs to change and cannot work out why nothing moved.
 * Layer: core.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../list-engine';
import type { SqlDialect } from '../list-engine/dialect';

export type SettingSource = 'store' | 'platform' | 'environment' | 'default';

export interface ResolvedSetting {
  readonly key: string;
  readonly value: unknown;
  readonly source: SettingSource;
  /** What it would fall back to if this store's value were cleared. */
  readonly inherited: unknown;
}

export interface SettingsOptions {
  readonly executor: QueryExecutor;
  readonly dialect: SqlDialect;
  /** Declared defaults from the manifests, keyed by setting key. */
  readonly defaults: () => ReadonlyMap<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
}

const PLATFORM_TABLE = 'platform_settings';
const STORE_TABLE = 'store_settings';

/**
 * `requestPrefix` → `DF_SETTING_REQUEST_PREFIX`.
 *
 * Environment variables are screamed snake case by convention, and a setting key
 * is camelCase; doing the conversion here means a deployment never has to guess.
 */
export function envNameFor(key: string): string {
  return `DF_SETTING_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[.\-]/g, '_').toUpperCase()}`;
}

interface SettingRow extends Record<string, unknown> {
  handle: string;
  value: unknown;
}

export class SettingsService {
  constructor(private readonly options: SettingsOptions) {}

  private q(name: string): string {
    return this.options.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.options.dialect.placeholder(index);
  }

  /** One setting, resolved through the chain. */
  async get(key: string, storeId: StoreId | null): Promise<ResolvedSetting> {
    const [platform, store] = await Promise.all([
      this.readOne(PLATFORM_TABLE, null, key),
      storeId === null ? Promise.resolve(undefined) : this.readOne(STORE_TABLE, storeId, key),
    ]);

    const inherited = this.below(key, platform);

    if (store !== undefined) {
      return { key, value: store, source: 'store', inherited };
    }
    return { key, value: inherited, source: this.sourceOf(key, platform), inherited };
  }

  /** Every declared setting for a store, with where each value came from. */
  async all(storeId: StoreId | null): Promise<readonly ResolvedSetting[]> {
    const [platform, store] = await Promise.all([
      this.readAll(PLATFORM_TABLE, null),
      storeId === null ? Promise.resolve(new Map<string, unknown>()) : this.readAll(STORE_TABLE, storeId),
    ]);

    return [...this.options.defaults().keys()].map((key) => {
      const inherited = this.below(key, platform.get(key));
      return store.has(key)
        ? { key, value: store.get(key), source: 'store' as const, inherited }
        : { key, value: inherited, source: this.sourceOf(key, platform.get(key)), inherited };
    });
  }

  async setForStore(storeId: StoreId, key: string, value: unknown): Promise<void> {
    this.assertDeclared(key);
    await this.write(STORE_TABLE, storeId, key, value);
  }

  /** Clears a store's choice, so it inherits again. */
  async clearForStore(storeId: StoreId, key: string): Promise<void> {
    this.assertDeclared(key);
    await this.remove(STORE_TABLE, storeId, key);
  }

  async setForPlatform(key: string, value: unknown): Promise<void> {
    this.assertDeclared(key);
    await this.write(PLATFORM_TABLE, null, key, value);
  }

  /**
   * A setting nothing declares is refused rather than stored.
   *
   * Accepting it would write a row that no screen renders and no module reads —
   * invisible until someone spends an afternoon working out why their value has
   * no effect.
   */
  private assertDeclared(key: string): void {
    if (!this.options.defaults().has(key)) {
      throw new SettingsError(`No module declares a setting called "${key}".`);
    }
  }

  /** Everything below the store level: platform, then environment, then code. */
  private below(key: string, platformValue: unknown): unknown {
    if (platformValue !== undefined) return platformValue;

    const fromEnv = (this.options.env ?? process.env)[envNameFor(key)];
    if (fromEnv !== undefined) return parseEnvValue(fromEnv);

    return this.options.defaults().get(key);
  }

  private sourceOf(key: string, platformValue: unknown): SettingSource {
    if (platformValue !== undefined) return 'platform';
    if ((this.options.env ?? process.env)[envNameFor(key)] !== undefined) return 'environment';
    return 'default';
  }

  private async readOne(
    table: string,
    storeId: StoreId | null,
    key: string,
  ): Promise<unknown | undefined> {
    const scoped = storeId !== null;
    const rows = await this.options.executor.query<SettingRow>(
      `SELECT ${this.q('value')} FROM ${this.q(table)}
        WHERE ${scoped ? `${this.q('store_id')} = ${this.p(1)} AND ` : ''}${this.q('handle')} = ${this.p(scoped ? 2 : 1)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      scoped ? [storeId, key] : [key],
    );

    const row = rows[0];
    return row === undefined ? undefined : decode(row.value);
  }

  private async readAll(table: string, storeId: StoreId | null): Promise<Map<string, unknown>> {
    const scoped = storeId !== null;
    const rows = await this.options.executor.query<SettingRow>(
      `SELECT ${this.q('handle')}, ${this.q('value')} FROM ${this.q(table)}
        WHERE ${scoped ? `${this.q('store_id')} = ${this.p(1)} AND ` : ''}${this.q('deleted_at')} IS NULL`,
      scoped ? [storeId] : [],
    );
    return new Map(rows.map((row) => [row.handle, decode(row.value)]));
  }

  private async write(
    table: string,
    storeId: StoreId | null,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.remove(table, storeId, key);

    const scoped = storeId !== null;
    const columns = scoped
      ? ['id', 'store_id', 'handle', 'setting_key', 'value', 'version']
      : ['id', 'handle', 'setting_key', 'value', 'version'];
    // Wrapped in an object so a stored `null` survives the round trip — bare
    // JSON `null` is indistinguishable from "no row" once it comes back.
    const encoded = JSON.stringify({ v: value });
    const values = scoped
      ? [randomUUID(), storeId, key, key, encoded, 1]
      : [randomUUID(), key, key, encoded, 1];

    await this.options.executor.query(
      `INSERT INTO ${this.q(table)} (${columns.map((column) => this.q(column)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      values,
    );
  }

  private async remove(table: string, storeId: StoreId | null, key: string): Promise<void> {
    const scoped = storeId !== null;
    await this.options.executor.query(
      `DELETE FROM ${this.q(table)}
        WHERE ${scoped ? `${this.q('store_id')} = ${this.p(1)} AND ` : ''}${this.q('handle')} = ${this.p(scoped ? 2 : 1)}`,
      scoped ? [storeId, key] : [key],
    );
  }
}

/** Unwraps the `{ v }` envelope a stored value is written in. */
function decode(stored: unknown): unknown {
  const parsed = typeof stored === 'string' ? safeParse(stored) : stored;
  if (parsed && typeof parsed === 'object' && 'v' in (parsed as Record<string, unknown>)) {
    return (parsed as { v: unknown }).v;
  }
  return parsed;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Environment variables are strings; settings are typed.
 *
 * JSON first, so `true`, `42` and `["a"]` arrive as themselves, falling back to
 * the raw string — which is what a plain word like `USD` should stay.
 */
function parseEnvValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export class SettingsError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

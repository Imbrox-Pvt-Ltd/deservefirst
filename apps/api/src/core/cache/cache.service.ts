/**
 * Core · cache/cache.service.ts
 * One caching abstraction with tag-based invalidation (§5.5, §30.4). Every module
 * reuses it; none implements its own. A cache entry with no declared
 * invalidation is a bug, so the API makes tags mandatory rather than optional.
 * Layer: core.
 */

import { platformCacheKey, storeCacheKey, type StoreId } from '@deservefirst/contracts';

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  addToTag(tag: string, key: string): Promise<void>;
  membersOfTag(tag: string): Promise<readonly string[]>;
  clearTag(tag: string): Promise<void>;
}

/** In-memory store for development and tests; Redis in every other environment. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly tags = new Map<string, Set<string>>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
  }

  async addToTag(tag: string, key: string): Promise<void> {
    const set = this.tags.get(tag) ?? new Set<string>();
    set.add(key);
    this.tags.set(tag, set);
  }

  async membersOfTag(tag: string): Promise<readonly string[]> {
    return [...(this.tags.get(tag) ?? [])];
  }

  async clearTag(tag: string): Promise<void> {
    this.tags.delete(tag);
  }

  /** Test helper: how many live entries the store holds. */
  size(): number {
    return this.entries.size;
  }
}

export interface CacheOptions {
  readonly ttlSeconds: number;
  /**
   * Tags this entry belongs to. Required, not optional: an entry nobody can
   * invalidate is a stale-data incident waiting for a deploy.
   */
  readonly tags: readonly string[];
}

export class CacheService {
  constructor(private readonly store: CacheStore) {}

  /** Namespaces a key to a store so one tenant can never read another's entry. */
  keyFor(storeId: StoreId, ...segments: readonly string[]): string {
    return storeCacheKey(storeId, ...segments);
  }

  platformKey(...segments: readonly string[]): string {
    return platformCacheKey(...segments);
  }

  /**
   * Cache-first read: hit returns immediately; miss computes, stores and
   * registers the key against every tag so a later write can bust it.
   */
  async wrap<T>(key: string, options: CacheOptions, compute: () => Promise<T>): Promise<T> {
    if (options.tags.length === 0) {
      throw new Error(
        `Cache entry "${key}" declares no tags. Every entry must declare how it is invalidated (§30.4).`,
      );
    }

    const cached = await this.store.get(key);
    if (cached !== undefined) {
      return JSON.parse(cached) as T;
    }

    const value = await compute();
    await this.store.set(key, JSON.stringify(value), options.ttlSeconds);
    for (const tag of options.tags) {
      await this.store.addToTag(tag, key);
    }
    return value;
  }

  /** Busts every entry carrying any of these tags. Called on write, from events. */
  async invalidateTags(tags: readonly string[]): Promise<number> {
    let removed = 0;
    for (const tag of tags) {
      const keys = await this.store.membersOfTag(tag);
      if (keys.length > 0) {
        await this.store.delete(keys);
        removed += keys.length;
      }
      await this.store.clearTag(tag);
    }
    return removed;
  }

  async forget(keys: readonly string[]): Promise<void> {
    await this.store.delete(keys);
  }
}

/** Conventional tag shapes, so modules bust each other's caches predictably. */
export const cacheTags = {
  entity: (storeId: StoreId, entity: string) => `store:${storeId}:entity:${entity}`,
  record: (storeId: StoreId, entity: string, id: string) => `store:${storeId}:entity:${entity}:${id}`,
  settings: (storeId: StoreId) => `store:${storeId}:settings`,
  entitlements: (storeId: StoreId) => `store:${storeId}:entitlements`,
} as const;

/**
 * Storefront · infrastructure/memory-page-cache.ts
 * Rendered pages, kept in this process.
 *
 * The single-node implementation. A shared cache is the production one and gets
 * the same interface — which is the reason there is an interface at all, since
 * a cache that only ever lives in memory would not need one.
 *
 * Bounded by BYTES rather than by entry count, because entries are pages: a
 * thousand product pages at 40 KB is forty megabytes, and a limit expressed in
 * entries would have looked reasonable while the process ran out of heap.
 * Layer: infrastructure.
 */

import type { CachedPage, PageCache } from '../api/storefront-ports';

export interface MemoryPageCacheOptions {
  /** The ceiling, in bytes of body. Default 64 MB. */
  readonly maxBytes?: number;
  readonly now?: () => number;
}

export class MemoryPageCache implements PageCache {
  /**
   * Insertion-ordered, which is what makes eviction cheap.
   *
   * A `Map` preserves insertion order, so the oldest key is the first one the
   * iterator yields — and re-inserting on a hit moves an entry to the end. That
   * is a least-recently-used policy without a second data structure to keep in
   * step.
   */
  private readonly entries = new Map<string, CachedPage>();
  private readonly epochs = new Map<string, number>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;

  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: MemoryPageCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.now = options.now ?? (() => Date.now());
  }

  async get(key: string): Promise<CachedPage | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expiresAt <= this.now()) {
      // Expiry is checked on read rather than swept on a timer: a page nobody
      // asks for costs nothing to leave, and a timer over a large map is work
      // done for entries that will never be read again.
      this.entries.delete(key);
      this.bytes -= entry.body.length;
      this.misses++;
      return null;
    }

    // Re-inserting moves it to the end, which is the LRU half of the policy.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry;
  }

  async set(key: string, page: CachedPage): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) this.bytes -= existing.body.length;

    this.entries.set(key, page);
    this.bytes += page.body.length;

    /**
     * Evict oldest-first until under the ceiling.
     *
     * A single page larger than the whole budget would otherwise loop forever
     * evicting everything and still not fit, so the guard is on the map being
     * non-empty rather than on the arithmetic alone.
     */
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value as string;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (evicted) this.bytes -= evicted.body.length;
    }
  }

  /**
   * Retires a store's pages by moving its epoch, not by scanning.
   *
   * The epoch is part of every key, so a bump orphans the old entries and they
   * fall out through expiry and eviction. Scanning the map for one store's keys
   * would be O(n) on a cache holding every store's pages, at exactly the moment
   * a merchant is waiting to see their change.
   */
  async invalidateStore(storeId: string): Promise<void> {
    this.epochs.set(storeId, this.epochFor(storeId) + 1);
  }

  epochFor(storeId: string): number {
    return this.epochs.get(storeId) ?? 0;
  }

  stats(): { entries: number; bytes: number; hits: number; misses: number } {
    return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses };
  }
}

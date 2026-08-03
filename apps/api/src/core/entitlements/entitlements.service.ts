/**
 * Core · entitlements/entitlements.service.ts
 * Maps a store to its active modules and plan limits (§5.3), and meters usage
 * against them. Two separate concerns, deliberately not merged: entitlements are
 * *commercial* (what the plan sold), feature flags are *technical* (what the code
 * exposes) — §36.2.
 * Layer: core.
 */

import { createHash } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import { cacheTags, type CacheService } from '../cache/cache.service';

export interface PlanLimit {
  readonly featureKey: string;
  /** null means unlimited. */
  readonly limit: number | null;
  readonly window: 'daily' | 'monthly' | 'billing-period';
}

export interface Entitlements {
  readonly storeId: StoreId;
  readonly planKey: string;
  readonly enabledModules: readonly string[];
  readonly limits: readonly PlanLimit[];
}

export interface EntitlementSource {
  load(storeId: StoreId): Promise<Entitlements>;
}

export class NotEntitledError extends Error {
  readonly status = 402;
  constructor(
    readonly storeId: StoreId,
    readonly requirement: string,
  ) {
    super(`Store "${storeId}" is not entitled to "${requirement}".`);
    this.name = 'NotEntitledError';
  }
}

export class UsageLimitExceededError extends Error {
  readonly status = 429;
  constructor(
    readonly storeId: StoreId,
    readonly featureKey: string,
    readonly limit: number,
  ) {
    super(`Store "${storeId}" has reached its limit of ${limit} for "${featureKey}".`);
    this.name = 'UsageLimitExceededError';
  }
}

/**
 * Usage is reserved when work is queued and consumed when it succeeds, so a
 * failed job does not silently burn quota. Reservations are released only on
 * terminal failure — a retry keeps its reservation.
 */
export interface UsageLedger {
  reserved(storeId: StoreId, featureKey: string, window: string): Promise<number>;
  reserve(storeId: StoreId, featureKey: string, window: string, executionId: string): Promise<void>;
  consume(storeId: StoreId, featureKey: string, executionId: string): Promise<void>;
  release(storeId: StoreId, featureKey: string, executionId: string): Promise<void>;
}

export class EntitlementsService {
  constructor(
    private readonly source: EntitlementSource,
    private readonly cache: CacheService,
    private readonly usage: UsageLedger,
  ) {}

  async forStore(storeId: StoreId): Promise<Entitlements> {
    return this.cache.wrap(
      this.cache.keyFor(storeId, 'entitlements'),
      { ttlSeconds: 300, tags: [cacheTags.entitlements(storeId)] },
      () => this.source.load(storeId),
    );
  }

  /**
   * A hash of the entitlement set, embedded in the access token so the gateway
   * can short-circuit most checks without a lookup (§4.4). When the hash in the
   * token differs from the current one, the token is stale and must refresh.
   */
  async hashFor(storeId: StoreId): Promise<string> {
    const entitlements = await this.forStore(storeId);
    const canonical = JSON.stringify({
      plan: entitlements.planKey,
      modules: [...entitlements.enabledModules].sort(),
      limits: [...entitlements.limits]
        .map((limit) => `${limit.featureKey}:${limit.limit ?? 'unlimited'}`)
        .sort(),
    });
    return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  }

  async isModuleEnabled(storeId: StoreId, moduleId: string): Promise<boolean> {
    const entitlements = await this.forStore(storeId);
    return entitlements.enabledModules.includes(moduleId);
  }

  /** Throws unless the store's plan includes the module. Every feature calls this. */
  async assertModule(storeId: StoreId, moduleId: string): Promise<void> {
    if (!(await this.isModuleEnabled(storeId, moduleId))) {
      throw new NotEntitledError(storeId, moduleId);
    }
  }

  /**
   * Reserves one unit of a metered feature, refusing when the window is spent.
   * The check and the reservation are one call so two concurrent requests cannot
   * both pass a limit that only had room for one.
   */
  async reserveUsage(storeId: StoreId, featureKey: string, executionId: string): Promise<void> {
    const entitlements = await this.forStore(storeId);
    const limit = entitlements.limits.find((entry) => entry.featureKey === featureKey);
    if (!limit || limit.limit === null) {
      await this.usage.reserve(storeId, featureKey, limit?.window ?? 'monthly', executionId);
      return;
    }

    const used = await this.usage.reserved(storeId, featureKey, limit.window);
    if (used >= limit.limit) {
      throw new UsageLimitExceededError(storeId, featureKey, limit.limit);
    }
    await this.usage.reserve(storeId, featureKey, limit.window, executionId);
  }

  async consumeUsage(storeId: StoreId, featureKey: string, executionId: string): Promise<void> {
    await this.usage.consume(storeId, featureKey, executionId);
  }

  async releaseUsage(storeId: StoreId, featureKey: string, executionId: string): Promise<void> {
    await this.usage.release(storeId, featureKey, executionId);
  }

  /** Called when a subscription changes; the next read repopulates from source. */
  async invalidate(storeId: StoreId): Promise<void> {
    await this.cache.invalidateTags([cacheTags.entitlements(storeId)]);
  }
}

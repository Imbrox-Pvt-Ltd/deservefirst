/**
 * Core · rate-limit/rate-limiter.ts
 * Central token-bucket limiter, per store and per plan (§5.5, §6). Enforcement
 * happens in real time — we never rely on a human reacting to an alert to stop
 * abuse (§29.1). Alerting sits on top for awareness.
 * Layer: core.
 */

import type { StoreId } from '@deservefirst/contracts';

export interface BucketSpec {
  /** Sustained rate. */
  readonly refillPerSecond: number;
  /** Burst allowance. */
  readonly capacity: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly limit: number;
}

export interface TokenBucketStore {
  /**
   * Atomically consumes `cost` tokens if available. Must be atomic — a
   * read-then-write limiter lets concurrent requests both pass a limit that had
   * room for one.
   */
  consume(key: string, spec: BucketSpec, cost: number, now: number): Promise<RateLimitDecision>;
}

export class MemoryTokenBucketStore implements TokenBucketStore {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  async consume(
    key: string,
    spec: BucketSpec,
    cost: number,
    now: number,
  ): Promise<RateLimitDecision> {
    const existing = this.buckets.get(key) ?? { tokens: spec.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, (now - existing.updatedAt) / 1000);
    const refilled = Math.min(spec.capacity, existing.tokens + elapsedSeconds * spec.refillPerSecond);

    if (refilled < cost) {
      this.buckets.set(key, { tokens: refilled, updatedAt: now });
      const deficit = cost - refilled;
      return {
        allowed: false,
        remaining: Math.floor(refilled),
        retryAfterSeconds: Math.ceil(deficit / spec.refillPerSecond),
        limit: spec.capacity,
      };
    }

    const remaining = refilled - cost;
    this.buckets.set(key, { tokens: remaining, updatedAt: now });
    return {
      allowed: true,
      remaining: Math.floor(remaining),
      retryAfterSeconds: 0,
      limit: spec.capacity,
    };
  }
}

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(
    readonly scope: string,
    readonly decision: RateLimitDecision,
  ) {
    super(`Rate limit exceeded for ${scope}. Retry in ${decision.retryAfterSeconds}s.`);
    this.name = 'RateLimitedError';
  }
}

export class RateLimiter {
  constructor(
    private readonly store: TokenBucketStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(key: string, spec: BucketSpec, cost = 1): Promise<RateLimitDecision> {
    return this.store.consume(key, spec, cost, this.now());
  }

  async enforce(key: string, spec: BucketSpec, cost = 1): Promise<RateLimitDecision> {
    const decision = await this.check(key, spec, cost);
    if (!decision.allowed) {
      throw new RateLimitedError(key, decision);
    }
    return decision;
  }

  /**
   * GraphQL is limited by query *cost*, not request count (§23.2, §30.5) — one
   * deep query can be worth a thousand shallow ones, and per-second limits
   * cannot see the difference.
   */
  async enforceQueryCost(storeId: StoreId, spec: BucketSpec, cost: number): Promise<RateLimitDecision> {
    return this.enforce(`store:${storeId}:graphql`, spec, cost);
  }
}

/** Bucket shapes by scope. Auth is deliberately tight — credential stuffing (§4.6). */
export const rateLimitBuckets = {
  authPerIp: { refillPerSecond: 0.2, capacity: 10 } satisfies BucketSpec,
  authPerAccount: { refillPerSecond: 0.1, capacity: 5 } satisfies BucketSpec,
  adminApi: { refillPerSecond: 20, capacity: 100 } satisfies BucketSpec,
  storefrontApi: { refillPerSecond: 100, capacity: 500 } satisfies BucketSpec,
  graphqlCost: { refillPerSecond: 50, capacity: 1000 } satisfies BucketSpec,
} as const;

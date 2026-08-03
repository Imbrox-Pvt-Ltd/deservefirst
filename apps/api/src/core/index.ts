/**
 * Core · index.ts
 * The kernel every module depends on (§5). Modules consume these services and
 * never re-implement them; the fitness suite fails the build on any that tries.
 * Layer: core.
 */

export * from './tenant-context';
export * from './module-registry/registry';
export * from './event-bus/event-bus';
export * from './cache/cache.service';
export * from './entitlements/entitlements.service';
export * from './rate-limit/rate-limiter';
export * from './http/response-envelope';
export * from './adapters';
export * from './entity-toolkit';
export * from './list-engine';

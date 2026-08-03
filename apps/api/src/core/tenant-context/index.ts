/**
 * Core · tenant-context/index.ts
 * The tenant-context kernel: resolve once per request, propagate everywhere,
 * fail hard on mismatch, and push the boundary down into the database so it is
 * enforced even when application code forgets (§5.1, §5.6, §20.1).
 * Layer: core.
 */

export * from './request-context.store';
export * from './tenant-mismatch';
export * from './postgres-rls-context';
export * from './database-isolation.service';

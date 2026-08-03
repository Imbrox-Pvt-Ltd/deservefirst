/**
 * Core · tenant-context/request-context.store.ts
 * Ambient storage for the resolved request context (§5.1). Uses AsyncLocalStorage
 * so the context follows the async call chain without being threaded through
 * every signature — and, critically, so the database layer can read it when
 * setting row-level-security variables.
 * Layer: core (framework-free; Node built-ins only).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { RequestContext, StoreRequestContext } from '@deservefirst/contracts';

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` bound for the whole async subtree. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Thrown when store-scoped work is attempted without a store context. This is a
 * programming error, not a user error: the request should have been rejected at
 * the gateway.
 */
export class MissingStoreContextError extends Error {
  constructor(operation: string) {
    super(
      `"${operation}" is store-scoped but ran without an active store context. ` +
        'No store-scoped operation may continue without one.',
    );
    this.name = 'MissingStoreContextError';
  }
}

/**
 * Reads the context and asserts it is store-scoped. Every repository and worker
 * that touches store data calls this rather than reading the store id from an
 * argument — an argument can be forged, the context cannot.
 */
export function requireStoreContext(operation: string): StoreRequestContext {
  const context = storage.getStore();
  if (!context || context.storeId === null) {
    throw new MissingStoreContextError(operation);
  }
  return context as StoreRequestContext;
}

/** Platform-only surfaces may omit the store, but must still carry a request id. */
export function requirePlatformContext(operation: string): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingStoreContextError(operation);
  }
  return context;
}

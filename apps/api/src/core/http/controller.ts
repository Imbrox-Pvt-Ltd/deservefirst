/**
 * Core · http/controller.ts
 * How a module contributes endpoints.
 *
 * A module returns route DEFINITIONS — method, path, permission, handler — and
 * the transport registers them. It never touches Fastify, never builds a
 * response envelope, and never performs its own authorisation check.
 *
 * That last point is the reason this exists at all. Every hand-written endpoint
 * previously repeated the same preamble: resolve context, check the store is
 * present, assert the permission, enter the tenant scope, wrap the result. Five
 * lines that are easy to write and easy to write WRONG — and one of them was:
 * the entitlement check derived its module from the permission's prefix, so
 * every route on the platform asked whether `catalog` was enabled. Here the
 * module id comes from the controller that owns the route, so it cannot be
 * guessed at and cannot be wrong.
 * Layer: core/http.
 */

import type { RequestContext, StoreId } from '@deservefirst/contracts';

export type ControllerMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Everything a handler gets, already resolved and already authorised. */
export interface RouteRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly query: URLSearchParams;
  readonly context: RequestContext;
  /** Guaranteed present: a store-scoped route never runs without one. */
  readonly storeId: StoreId;
}

export interface RouteDefinition {
  readonly method: ControllerMethod;
  /** Relative to `/{version}/{moduleId}` — a module cannot mount outside itself. */
  readonly path: string;
  readonly permission: string;
  /** 201 for creates; the default is 200. */
  readonly status?: number;
  /**
   * A larger request body than the platform default, in bytes.
   *
   * Per route rather than global, because the default is a defence: every
   * endpoint that accepts a megabyte is an endpoint somebody can send a
   * megabyte to, repeatedly. Raising it everywhere so one upload works trades
   * a real limit for a convenience. A route that genuinely receives a file
   * declares what it needs and the rest stay small.
   */
  readonly bodyLimit?: number;
  /**
   * Returns the payload, not a response. Throwing is how a handler fails —
   * the transport's single error mapper turns a domain error into its status,
   * so no handler has to know what an HTTP code is.
   */
  handle(request: RouteRequest): Promise<unknown>;
}

export interface ModuleController {
  /** Must match the manifest id: it namespaces the routes AND gates the module. */
  readonly moduleId: string;
  readonly routes: readonly RouteDefinition[];
}

/** Convenience for building a controller without repeating the module id. */
export function controller(
  moduleId: string,
  routes: readonly RouteDefinition[],
): ModuleController {
  const duplicate = routes.find(
    (route, index) =>
      routes.findIndex((other) => other.method === route.method && other.path === route.path) !==
      index,
  );
  if (duplicate) {
    // Fastify would refuse this at boot anyway; failing here names the module.
    throw new Error(
      `Module "${moduleId}" declares ${duplicate.method} ${duplicate.path} more than once.`,
    );
  }

  return { moduleId, routes };
}

/**
 * Core · http/route-composer.ts
 * Composes the API surface from module manifests at boot (§13.5, §24.1). Routes
 * are declaratively registered and composed — never resolved from a database,
 * which would cost type-safety, caching, security and observability for nothing.
 *
 * One resource declaration yields the REST endpoints, their permissions and
 * their visibility, so the frontend route tree and the backend operations cannot
 * drift: both derive from the same source.
 * Layer: core/http.
 */

import type { ResourceDefinition, Visibility } from '@deservefirst/contracts';

import type { ModuleRegistry } from '../module-registry/registry';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ComposedRoute {
  readonly moduleId: string;
  readonly method: HttpMethod;
  /** Path template with `:param` segments, mounted under the dated API version. */
  readonly path: string;
  readonly operation: string;
  readonly resource: string;
  readonly permission: string;
  readonly visibility: Visibility;
  /** Store-scoped routes require an active store context before they run. */
  readonly storeScoped: boolean;
}

/**
 * The five operations every resource gets. Custom behaviour is a service method
 * reached through one of these, never a bespoke endpoint — otherwise the API
 * stops being predictable and the generated docs stop being complete (§13.5).
 */
function routesForResource(moduleId: string, resource: ResourceDefinition): ComposedRoute[] {
  const base = `/${resource.urlSegment}`;
  const common = {
    moduleId,
    resource: resource.name,
    visibility: resource.api.visibility,
    storeScoped: true,
  } as const;

  const routes: ComposedRoute[] = [
    { ...common, method: 'GET', path: base, operation: `${resource.name}.list`, permission: resource.permissions.read },
    { ...common, method: 'GET', path: `${base}/:id`, operation: `${resource.name}.get`, permission: resource.permissions.read },
    { ...common, method: 'POST', path: base, operation: `${resource.name}.create`, permission: resource.permissions.write },
    { ...common, method: 'PATCH', path: `${base}/:id`, operation: `${resource.name}.update`, permission: resource.permissions.write },
  ];

  if (resource.permissions.delete) {
    routes.push({
      ...common,
      method: 'DELETE',
      path: `${base}/:id`,
      operation: `${resource.name}.delete`,
      permission: resource.permissions.delete,
    });
  }

  return routes;
}

export class RouteCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteCompositionError';
  }
}

/**
 * Builds the full route table. Collisions are fatal: two handlers on one path
 * makes dispatch depend on registration order, which only breaks after a deploy
 * reorders discovery.
 */
export function composeApiRoutes(registry: ModuleRegistry): readonly ComposedRoute[] {
  const routes: ComposedRoute[] = [];
  const seen = new Map<string, string>();

  for (const entry of registry.resources()) {
    if (!entry.item.api.rest) continue;

    for (const route of routesForResource(entry.moduleId, entry.item)) {
      const key = `${route.method} ${route.path}`;
      const owner = seen.get(key);
      if (owner && owner !== route.moduleId) {
        throw new RouteCompositionError(
          `"${key}" is claimed by both "${owner}" and "${route.moduleId}"`,
        );
      }
      seen.set(key, route.moduleId);
      routes.push(route);
    }
  }

  return routes;
}

/**
 * The public API surface: private and internal operations are excluded here and
 * therefore cannot leak into the generated reference docs (§26.4).
 */
export function publicRoutes(routes: readonly ComposedRoute[]): readonly ComposedRoute[] {
  return routes.filter((route) => route.visibility === 'public');
}

/**
 * The queryable route registry (§24.2) — every route on the platform, which
 * module owns it, and what it requires. This is what makes central tracking,
 * the collision check and the Reflection API (§36.1) one thing rather than three.
 */
export interface RouteRegistryEntry {
  readonly method: HttpMethod;
  readonly path: string;
  readonly moduleId: string;
  readonly operation: string;
  readonly permission: string;
  readonly visibility: Visibility;
}

export function buildRouteRegistry(registry: ModuleRegistry): readonly RouteRegistryEntry[] {
  return composeApiRoutes(registry).map((route) => ({
    method: route.method,
    path: route.path,
    moduleId: route.moduleId,
    operation: route.operation,
    permission: route.permission,
    visibility: route.visibility,
  }));
}

/** Screen routes contributed by modules, for the frontend route tree (§24.1). */
export function composeScreenRoutes(registry: ModuleRegistry) {
  return registry.routes().map((entry) => ({
    moduleId: entry.moduleId,
    path: entry.item.path,
    screen: entry.item.screen,
    entity: entry.item.entity ?? null,
    permission: entry.item.permission,
    presentation: entry.item.presentation ?? 'page',
  }));
}

/** Mounts a route under the dated API version: `/2026-01/catalog/products`. */
export function mountPath(version: string, route: ComposedRoute): string {
  return `/${version}/${route.moduleId}${route.path}`;
}

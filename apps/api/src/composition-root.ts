/**
 * composition-root.ts
 * Where the platform is assembled. Dependencies are wired explicitly rather than
 * by a DI container (ADR 0003): with a manifest registry already answering "what
 * modules exist", a second container answering "what providers exist" would be a
 * competing module system.
 *
 * Boot order matters and is enforced: discover manifests → validate capability
 * contracts → resolve dependencies → seal the registry → compose routes. A
 * module that fails validation stops the boot loudly (§31.7).
 * Layer: composition root.
 */

import { randomUUID } from 'node:crypto';

import { loadPlatformConfig } from '@deservefirst/config';

import { authManifest } from './auth/auth.manifest';
import { AccessEvaluator } from './auth/application';
import { SqlIdentityRepository } from './auth/infrastructure';
import { requiresApproval } from './auth/domain';
import {
  CacheService,
  composeApiRoutes,
  createMysqlPool,
  EntitlementsService,
  EventBus,
  MemoryCacheStore,
  MemoryTokenBucketStore,
  ModuleRegistry,
  MysqlExecutor,
  QueryGuard,
  RateLimiter,
  buildRouteRegistry,
  dialectFor,
  guardExecutor,
  type SqlDialect,
} from './core';
import { catalogManifest } from './modules/catalog/catalog.manifest';
import { ProductRepositoryImpl } from './modules/catalog/infrastructure';

export interface Platform {
  readonly registry: ModuleRegistry;
  readonly dialect: SqlDialect;
  readonly executor: MysqlExecutor;
  readonly cache: CacheService;
  readonly events: EventBus;
  readonly rateLimiter: RateLimiter;
  readonly entitlements: EntitlementsService;
  readonly access: AccessEvaluator;
  readonly identity: SqlIdentityRepository;
  readonly products: ProductRepositoryImpl;
  readonly routes: ReturnType<typeof buildRouteRegistry>;
  shutdown(): Promise<void>;
}

export async function bootstrap(): Promise<Platform> {
  const config = loadPlatformConfig();

  // 1. Discover and validate. Registration throws on an invalid manifest, and
  //    sealing throws on an unmet required dependency or a route collision.
  const registry = new ModuleRegistry();
  registry.register(authManifest);
  registry.register(catalogManifest);
  registry.seal();

  // 2. Database. The dialect follows the URL scheme, so moving to Postgres is a
  //    configuration change (ADR 0002).
  const dialectName = config.database.url.startsWith('postgres') ? 'postgres' : 'mysql';
  const dialect = dialectFor(dialectName);
  const pool = await createMysqlPool(config.database.url);

  // 3. Every statement passes the guard. Applied at the executor so no
  //    repository can bypass it; enforcing only where the database cannot.
  const guard = new QueryGuard({
    storeScopedTables: registry.storeScopedTables(),
    enforce: !dialect.enforcesRowLevelSecurity,
    onViolation: (error) => {
      // eslint-disable-next-line no-console
      console.error('[isolation]', error.message);
    },
  });
  const executor = guardExecutor(new MysqlExecutor({ pool }), guard);

  // 4. Core services.
  const cache = new CacheService(new MemoryCacheStore());
  const events = new EventBus((error, context) => {
    // eslint-disable-next-line no-console
    console.error(`[events] ${context.moduleId} failed on ${context.eventType}`, error);
  });
  for (const entry of registry.events()) {
    if (entry.item.direction === 'emits') {
      events.declareEmitter(entry.moduleId, entry.item.type);
    }
  }

  const rateLimiter = new RateLimiter(new MemoryTokenBucketStore());

  const entitlements = new EntitlementsService(
    {
      // Until billing exists, every registered module is entitled. This is a
      // stub with a known shape, not a permanent decision.
      load: async (storeId) => ({
        storeId,
        planKey: 'development',
        enabledModules: registry.enabled().map((entry) => entry.manifest.id),
        limits: [],
      }),
    },
    cache,
    {
      reserved: async () => 0,
      reserve: async () => {},
      consume: async () => {},
      release: async () => {},
    },
  );

  const access = new AccessEvaluator({
    isModuleEnabledGlobally: (moduleId) => registry.get(moduleId)?.enabled ?? false,
    isModuleEnabledForStore: async (storeId, moduleId) => entitlements.isModuleEnabled(storeId, moduleId),
    isEntitled: async (storeId, moduleId) => entitlements.isModuleEnabled(storeId, moduleId),
    permissionRequiresApproval: (permission) => requiresApproval(permission),
    supportSessionValid: async () => true,
  });

  const identity = new SqlIdentityRepository(executor, dialect);
  const products = new ProductRepositoryImpl(executor, dialect);

  // 5. Compose the API surface. Throws on collision rather than picking a winner.
  composeApiRoutes(registry);
  const routes = buildRouteRegistry(registry);

  return {
    registry,
    dialect,
    executor,
    cache,
    events,
    rateLimiter,
    entitlements,
    access,
    identity,
    products,
    routes,
    shutdown: async () => {
      await pool.end();
    },
  };
}

/** Correlation id for a request that arrives without one. */
export function newRequestId(): string {
  return randomUUID();
}

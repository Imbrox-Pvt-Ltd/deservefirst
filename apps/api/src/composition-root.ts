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
  createToolkitPorts,
  dialectFor,
  guardExecutor,
  type SqlDialect,
} from './core';
import { catalogManifest } from './modules/catalog/catalog.manifest';
import { customersManifest } from './modules/customers/customers.manifest';
import { CustomerService } from './modules/customers/application';
import { CustomerRepositoryImpl } from './modules/customers/infrastructure';
import { ordersManifest } from './modules/orders/orders.manifest';
import { RequestService } from './modules/orders/application';
import { SqlRequestRepository } from './modules/orders/infrastructure';
import { CollectionService, ProductService } from './modules/catalog/application';
import { CollectionRepositoryImpl, ProductRepositoryImpl } from './modules/catalog/infrastructure';

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
  /** Built per request: the service is scoped to whichever store is active. */
  productServiceFor(storeId: string): ProductService;
  requestServiceFor(storeId: string): RequestService;
  collectionServiceFor(storeId: string): CollectionService;
  customerServiceFor(storeId: string): CustomerService;
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
  registry.register(customersManifest);
  registry.register(ordersManifest);
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

  const toolkitPorts = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Product',
  });

  const collections = new CollectionRepositoryImpl(executor, dialect);
  const collectionToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Collection',
  });

  const customerRecords = new CustomerRepositoryImpl(executor, dialect);
  const customerToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Customer',
  });

  const requests = new SqlRequestRepository(executor, dialect);
  const requestToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Request',
  });

  /** Store settings, from the registry's declared defaults until storage exists. */
  const settingDefaults = new Map(
    registry.settings().map((entry) => [entry.item.key, entry.item.defaultValue]),
  );

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
    // The store is passed explicitly rather than read from context here, so a
    // worker outside a request can build one too.
    productServiceFor: (storeId) =>
      new ProductService(products, toolkitPorts, storeId as never),
    collectionServiceFor: (storeId) =>
      new CollectionService(collections, collectionToolkit, storeId as never),
    customerServiceFor: (storeId) =>
      new CustomerService(customerRecords, customerToolkit, storeId as never),
    requestServiceFor: (storeId) =>
      new RequestService(
        requests,
        {
          ...requestToolkit,
          setting: async (key, fallback) => (settingDefaults.get(key) as never) ?? fallback,
        },
        storeId as never,
      ),
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

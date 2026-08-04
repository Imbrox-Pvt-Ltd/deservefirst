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
import { platformManifest } from './core/platform.manifest';
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
  ModuleStateService,
  MysqlExecutor,
  QueryGuard,
  RateLimiter,
  SettingsService,
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
import { contentManifest } from './modules/content/content.manifest';
import { MetaobjectService, PageService } from './modules/content/application';
import {
  SqlDefinitionRepository,
  SqlEntryRepository,
  SqlPageRepository,
} from './modules/content/infrastructure';
import { inventoryManifest } from './modules/inventory/inventory.manifest';
import {
  InventoryService,
  PurchaseOrderService,
  TransferService,
} from './modules/inventory/application';
import {
  SqlAdjustmentRepository,
  SqlLevelRepository,
  SqlLocationRepository,
  SqlPurchaseOrderRepository,
  SqlTransferRepository,
} from './modules/inventory/infrastructure';
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
  /** The platform admin's controls, and where each setting's value comes from. */
  readonly moduleState: ModuleStateService;
  readonly settings: SettingsService;
  readonly identity: SqlIdentityRepository;
  readonly products: ProductRepositoryImpl;
  /** Built per request: the service is scoped to whichever store is active. */
  productServiceFor(storeId: string): ProductService;
  requestServiceFor(storeId: string): RequestService;
  collectionServiceFor(storeId: string): CollectionService;
  customerServiceFor(storeId: string): CustomerService;
  /**
   * Inventory has no per-store constructor argument: every one of its queries
   * reads the active store from the request context, so a service built once is
   * already scoped. The others take a storeId only because they predate that.
   */
  readonly inventory: InventoryService;
  readonly pages: PageService;
  readonly metaobjects: MetaobjectService;
  readonly purchaseOrders: PurchaseOrderService;
  readonly transfers: TransferService;
  readonly routes: ReturnType<typeof buildRouteRegistry>;
  shutdown(): Promise<void>;
}

export async function bootstrap(): Promise<Platform> {
  const config = loadPlatformConfig();

  // 1. Discover and validate. Registration throws on an invalid manifest, and
  //    sealing throws on an unmet required dependency or a route collision.
  const registry = new ModuleRegistry();
  // Core's own entities and permissions, declared like a module's so the schema
  // builder and the permission catalogue see them the same way.
  registry.register(platformManifest);
  registry.register(authManifest);
  registry.register(catalogManifest);
  registry.register(customersManifest);
  registry.register(ordersManifest);
  registry.register(contentManifest);
  registry.register(inventoryManifest);
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

  /** Declared defaults from every manifest — the bottom of the settings chain. */
  const settingDefaults = new Map(
    registry.settings().map((entry) => [entry.item.key, entry.item.defaultValue]),
  );

  const moduleState = new ModuleStateService({
    executor,
    dialect,
    cache,
    known: () => registry.all().map((entry) => entry.manifest.id),
  });

  const settings = new SettingsService({
    executor,
    dialect,
    defaults: () => settingDefaults,
  });

  /**
   * The three gates, in the order the evaluator applies them.
   *
   * `isModuleEnabledGlobally` was the registry's boot health — whether the
   * module loaded — which is a different question from whether an operator wants
   * it running. Both matter, so both are asked: a module that failed its
   * capability contract is unavailable, and so is one a platform admin turned
   * off. Boot health is checked synchronously here; the operator's decision is
   * the cached lookup, and the evaluator's own ordering keeps it ahead of any
   * store setting.
   */
  const access = new AccessEvaluator({
    isModuleEnabledGlobally: async (moduleId) =>
      // Two different questions, both platform-wide: did it load, and does the
      // operator permit it. Asking only the first made an incident kill switch
      // surface as "not enabled for this store", which sends support to a store
      // screen that cannot fix it.
      (registry.get(moduleId)?.enabled ?? false) &&
      (await moduleState.isEnabledPlatformWide(moduleId)),
    isModuleEnabledForStore: async (storeId, moduleId) =>
      moduleState.isEnabledForStore(storeId as never, moduleId),
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

  const pageRecords = new SqlPageRepository(executor, dialect);
  const definitions = new SqlDefinitionRepository(executor, dialect);
  const entries = new SqlEntryRepository(executor, dialect);
  const pageToolkit = createToolkitPorts({ executor, events, dialect, ownerEntity: 'Page' });
  const metaobjectToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'MetaobjectEntry',
    // The entity is MetaobjectEntry but the table is metaobject_entries — the
    // plural is irregular, so it is stated rather than guessed at.
    ownerTable: 'metaobject_entries',
  });

  const locations = new SqlLocationRepository(executor, dialect);
  const levels = new SqlLevelRepository(executor, dialect);
  const adjustments = new SqlAdjustmentRepository(executor, dialect);
  const purchaseOrders = new SqlPurchaseOrderRepository(executor, dialect);
  const transfers = new SqlTransferRepository(executor, dialect);

  // One inventory service, shared by the purchase-order and transfer services.
  // Receiving stock must leave the same audit trail whatever caused it, and it
  // does so precisely because there is only one code path that moves a level.
  const inventoryToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'InventoryLevel',
  });
  const inventory = new InventoryService(levels, adjustments, locations, inventoryToolkit);

  const purchaseOrderToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'PurchaseOrder',
  });
  const transferToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Transfer',
  });

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
    moduleState,
    settings,
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
          // Resolved through store → platform → environment → declared default,
          // so a module never has to know which level answered.
          setting: async (key, fallback) =>
            ((await settings.get(key, storeId as never)).value as never) ?? fallback,
        },
        storeId as never,
      ),
    inventory,
    pages: new PageService(pageRecords, pageToolkit),
    metaobjects: new MetaobjectService(definitions, entries, metaobjectToolkit),
    purchaseOrders: new PurchaseOrderService(purchaseOrders, locations, inventory, purchaseOrderToolkit),
    transfers: new TransferService(transfers, locations, inventory, transferToolkit),
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

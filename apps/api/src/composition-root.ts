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
import { appsManifest } from './apps/apps.manifest';
import { platformManifest } from './core/platform.manifest';
import { AccessEvaluator, AuthService } from './auth/application';
import {
  SqlIdentityRepository,
  SqlLoginFlowRepository,
  SqlSessionRepository,
  createAuthPorts,
  sealSessionId,
  type SessionIdentity,
} from './auth/infrastructure';
import { requiresApproval } from './auth/domain';
import { requireStoreContext, withRequestContext } from './core/tenant-context';
import {
  CacheService,
  DashboardService,
  composeApiRoutes,
  createMysqlPool,
  EntitlementsService,
  EventBus,
  MemoryCacheStore,
  MemoryTokenBucketStore,
  type ModuleController,
  ModuleRegistry,
  ModuleStateService,
  MysqlExecutor,
  QueryGuard,
  RateLimiter,
  SettingsService,
  SqlWebhookDeliveryRepository,
  SqlWebhookSubscriptionRepository,
  WebhookDeliveryService,
  buildRouteRegistry,
  httpTransport,
  webhooksController,
  createToolkitPorts,
  dialectFor,
  guardExecutor,
  type SqlDialect,
} from './core';
import { PartnerService } from './auth/application/partner-service';
import { SqlPartnerRepository } from './auth/infrastructure/partner.repository';
import { partnerController } from './auth/api/partner.controller';
import {
  AppReviewService,
  AppService,
  AppSuspensionService,
  type ScopeCatalogEntry,
} from './apps/application';
import { SqlAppRepository } from './apps/infrastructure';
import { appsController } from './apps/api';
import { catalogController } from './modules/catalog/api/catalog.controller';
import { catalogMetrics } from './modules/catalog/api/catalog.metrics';
import { contentMetrics } from './modules/content/api/content.metrics';
import { customersMetrics } from './modules/customers/api/customers.metrics';
import { inventoryMetrics } from './modules/inventory/api/inventory.metrics';
import { ordersMetrics } from './modules/orders/api/orders.metrics';
import { contentController } from './modules/content/api/content.controller';
import { customersController } from './modules/customers/api/customers.controller';
import { inventoryController } from './modules/inventory/api/inventory.controller';
import { ordersController } from './modules/orders/api/orders.controller';
import { catalogManifest } from './modules/catalog/catalog.manifest';
import { customersManifest } from './modules/customers/customers.manifest';
import { CompanyService, CustomerService, SegmentService } from './modules/customers/application';
import {
  CustomerRepositoryImpl,
  SqlCompanyRepository,
  SqlSegmentRepository,
} from './modules/customers/infrastructure';
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
  /** Home and the other slots, composed from what the modules contribute. */
  readonly dashboard: DashboardService;
  readonly webhooks: WebhookDeliveryService;
  /**
   * Sends what is due, across every store.
   *
   * Runs in a PLATFORM-scoped context, which is the escape hatch the tenant
   * guard already defines for exactly this: background work that legitimately
   * spans tenants (§14.2). Wrapping it here rather than loosening the guard
   * keeps the rule intact and makes the one place that crosses stores visible.
   */
  drainWebhooks(limit?: number): Promise<{ attempted: number; delivered: number; dead: number }>;
  readonly webhookSubscriptions: SqlWebhookSubscriptionRepository;
  readonly webhookDeliveries: SqlWebhookDeliveryRepository;
  readonly identity: SqlIdentityRepository;
  /** Partners, their staff, and their grants into client stores. */
  readonly partners: PartnerService;
  /** Third-party apps: registry, install lifecycle and token resolution. */
  readonly apps: AppService;
  /** Scope review, an operator's use case with an operator's permission. */
  readonly appReview: AppReviewService;
  /** Stopping an app across every store it is installed on. */
  readonly appSuspension: AppSuspensionService;
  /** Every app scope the installed modules declare (§23.2). */
  scopeCatalog(): readonly ScopeCatalogEntry[];
  readonly auth: AuthService;
  /**
   * Turns a session id into who the caller is and what they may do.
   *
   * Permissions are read per request rather than cached in the cookie, so
   * revoking a role or a session takes effect on the next call rather than when
   * a token happens to expire.
   */
  resolveSession(sessionId: string): Promise<SessionIdentity | null>;
  sealSession(sessionId: string): string;
  storesFor(userId: string): Promise<readonly { id: string; handle: string; name: string }[]>;
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
  /** Each module's HTTP surface, registered by the transport in one loop. */
  readonly controllers: readonly ModuleController[];
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
  registry.register(appsManifest);
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

  /**
   * The scope vocabulary, read off the manifests every time.
   *
   * Not captured at boot: `full` and `read_*` have to mean what the installed
   * modules say TODAY, and a snapshot would quietly deny an app a scope its
   * module already declares.
   */
  const scopeCatalog = (): readonly ScopeCatalogEntry[] =>
    registry.all().flatMap((entry) =>
      (entry.manifest.apiScopes ?? []).map((scope) => ({
        key: scope.key,
        label: scope.label,
        description: scope.description,
        family: scope.family,
        feature: scope.feature,
        access: scope.access,
        grants: scope.grants,
        restricted: scope.restricted === true,
      })),
    );

  const appRecords = new SqlAppRepository(executor, dialect);
  const appService = new AppService({
    apps: appRecords,
    scopeCatalog,
    publish: async (event) => {
      await events.emit(event.type, event.payload);
    },
    // Read from the operator's decisions. This returned nothing while the
    // review workflow did not exist, which failed closed correctly and also
    // meant no app could ever be published asking for a restricted scope.
    approvedScopesFor: (appId) => appRecords.approvedScopesFor(appId),
    ensureAppSubscription: async ({ appId, storeId, url, secret, eventTypes }) => {
      const existing = await webhookSubscriptions.forApp(storeId, appId);
      for (const eventType of eventTypes) {
        const already = existing.find((entry) => entry.eventType === eventType);
        if (already) continue;
        await webhookSubscriptions.insert({
          id: randomUUID(),
          appId,
          eventType,
          url,
          secret,
          status: 'active',
          consecutiveFailures: 0,
          disabledReason: null,
          version: 1,
        });
      }
    },
  });
  const partnerRecords = new SqlPartnerRepository(executor, dialect);
  const partnerService = new PartnerService({
    partners: partnerRecords,
    publish: async (event) => {
      await events.emit(event.type, event.payload);
    },
    /**
     * Read from the registry every time rather than captured once: `full`
     * access has to mean everything the store has NOW, and a snapshot taken at
     * boot would quietly withhold any permission a module declares later.
     */
    allStorePermissions: () =>
      registry
        .permissions()
        .map((entry) => entry.item.key)
        .filter((key) => !key.startsWith('partner.') && !key.startsWith('platform.')),
  });
  const sessions = new SqlSessionRepository(executor, dialect);
  const loginFlows = new SqlLoginFlowRepository(executor, dialect);

  const sessionSecret = process.env.SESSION_SECRET ?? 'development-secret-not-for-production';
  const auth = new AuthService(
    identity,
    sessions,
    loginFlows,
    createAuthPorts({
      secret: sessionSecret,
      events,
      entitlementsHashFor: async (storeId) => entitlements.hashFor(storeId),
    }),
  );
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
  const segmentRecords = new SqlSegmentRepository(executor, dialect);
  const companyRecords = new SqlCompanyRepository(executor, dialect);
  const companyToolkit = createToolkitPorts({
    executor,
    events,
    dialect,
    ownerEntity: 'Company',
    ownerTable: 'companies',
  });
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

  /**
   * Widgets come from the manifests; the numbers come from the modules. Core
   * composes the two and never queries a module's tables to build a card.
   */
  const dashboard = new DashboardService({
    registry,
    providers: [
      catalogMetrics(executor, dialect),
      ordersMetrics(executor, dialect),
      customersMetrics(executor, dialect),
      inventoryMetrics(executor, dialect),
      contentMetrics(executor, dialect),
    ],
    // A disabled module's card disappears with it — the same toggle, one place.
    isModuleAvailable: (storeId, moduleId) => moduleState.isEnabledForStore(storeId, moduleId),
  });

  /**
   * Outbound webhooks.
   *
   * Subscribed to EVERY event type any module declares as emitted, so a module
   * gets an integration surface by declaring an event rather than by knowing
   * webhooks exist (§31.9). Delivery is recorded here and sent on the drain, so
   * a slow receiver never makes a merchant's save slow.
   */
  const webhookSubscriptions = new SqlWebhookSubscriptionRepository(executor, dialect);
  const webhookDeliveries = new SqlWebhookDeliveryRepository(executor, dialect);
  const webhooks = new WebhookDeliveryService({
    subscriptions: webhookSubscriptions,
    deliveries: webhookDeliveries,
    transport: httpTransport(),
  });

  for (const entry of registry.events()) {
    if (entry.item.direction !== 'emits') continue;
    events.subscribe('core.webhooks', entry.item.type, async (envelope) => {
      const storeId = requireStoreContext('core.webhooks').storeId;
      await webhooks.enqueue({
        storeId,
        eventId: envelope.id,
        eventType: envelope.type,
        occurredAt: envelope.occurredAt,
        payload: envelope.payload,
      });
    });
  }

  // 5. Compose the API surface. Throws on collision rather than picking a winner.
  composeApiRoutes(registry);
  const routes = buildRouteRegistry(registry);

  /**
   * Sends what is due, across every store.
   *
   * Runs in a PLATFORM-scoped context, which is the escape hatch the tenant
   * guard already defines for exactly this: background work that legitimately
   * spans tenants. Wrapping it here rather than loosening the guard keeps the
   * rule intact and makes the one place that crosses stores visible.
   */
  const drainWebhooks = (limit?: number) =>
    withRequestContext(
      {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        actorType: 'system',
        userId: null,
        organizationId: null,
        businessEntityId: null,
        storeId: null,
        partnerId: null,
        appId: null,
        accessType: 'platform',
        roleKeys: [],
        permissions: [],
        supportSessionId: null,
        entitlementsHash: null,
        locale: 'en-US',
        timeZone: 'UTC',
        shardKey: null,
      },
      () => webhooks.drain(limit),
    );

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
    dashboard,
    webhooks,
    drainWebhooks,
    webhookSubscriptions,
    webhookDeliveries,
    identity,
    partners: partnerService,
    apps: appService,
    appReview: new AppReviewService({
      apps: appRecords,
      scopeCatalog,
      publish: async (event) => {
        await events.emit(event.type, event.payload);
      },
      approvedScopesFor: (appId) => appRecords.approvedScopesFor(appId),
      ensureAppSubscription: async () => {
        // Review never installs anything; the port exists on the shared shape.
      },
    }),
    appSuspension: new AppSuspensionService({
      apps: appRecords,
      scopeCatalog,
      publish: async (event) => {
        await events.emit(event.type, event.payload);
      },
      approvedScopesFor: (appId) => appRecords.approvedScopesFor(appId),
      ensureAppSubscription: async () => {
        // Suspending installs nothing; the port exists on the shared shape.
      },
    }),
    scopeCatalog,
    auth,

    resolveSession: async (sessionId) => {
      const session = await sessions.findById(sessionId);
      if (!session) return null;
      // Expired or revoked is not a reduced session; it is no session.
      if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) return null;

      const [storePermissions, roleKeys] = session.storeId
        ? await Promise.all([
            identity.permissionsFor(session.userId, session.storeId),
            identity.roleKeysFor(session.userId, session.storeId),
          ])
        : [[], []];

      /**
       * Operator permissions are read whether or not a store is selected.
       *
       * They govern every store, so gating them behind having picked one meant
       * an operator who had not chosen a store had no permissions at all — and
       * an operator has no store to choose.
       */
      const platformPermissions = await identity.platformPermissionsFor(session.userId);

      return {
        sessionId: session.id,
        userId: session.userId,
        storeId: session.storeId,
        organizationId: session.organizationId,
        permissions: [...new Set([...storePermissions, ...platformPermissions])],
        roleKeys,
        // Holding a platform role IS being an operator. Derived rather than
        // stored on the session, so revoking the role takes effect on the next
        // request rather than when the session happens to expire.
        accessType: platformPermissions.length > 0 ? ('platform' as const) : ('member' as const),
      };
    },

    sealSession: (sessionId) => sealSessionId(sessionSecret, sessionId),

    storesFor: async (userId) => {
      const memberships = await identity.membershipsFor(userId as never);
      return memberships
        .filter((membership) => membership.status === 'active')
        .map((membership) => ({
          id: membership.store.id,
          handle: membership.store.handle,
          name: membership.store.name,
        }));
    },

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
    // Built here because a controller needs its module's services, and this is
    // the only place that has them. The transport receives the finished list.
    controllers: [
      catalogController({
        productServiceFor: (storeId) => new ProductService(products, toolkitPorts, storeId as never),
        collectionServiceFor: (storeId) =>
          new CollectionService(collections, collectionToolkit, storeId as never),
      }),
      customersController({
        customerServiceFor: (storeId) =>
          new CustomerService(customerRecords, customerToolkit, storeId as never),
        // The customer REPOSITORY, not the service: a segment answers through
        // the same listing path the customer screen uses, so the two can never
        // disagree about the same filter.
        segmentServiceFor: () =>
          new SegmentService(segmentRecords, customerRecords, customerToolkit),
        companyServiceFor: () => new CompanyService(companyRecords, companyToolkit),
      }),
      ordersController({
        requestServiceFor: (storeId) =>
          new RequestService(
            requests,
            {
              ...requestToolkit,
              setting: async (key, fallback) =>
                ((await settings.get(key, storeId as never)).value as never) ?? fallback,
            },
            storeId as never,
          ),
      }),
      inventoryController({
        inventory,
        purchaseOrders: new PurchaseOrderService(
          purchaseOrders,
          locations,
          inventory,
          purchaseOrderToolkit,
        ),
        transfers: new TransferService(transfers, locations, inventory, transferToolkit),
      }),
      contentController({
        pages: new PageService(pageRecords, pageToolkit),
        metaobjects: new MetaobjectService(definitions, entries, metaobjectToolkit),
      }),
      // The merchant's half of the partner gate: store-scoped, so it mounts with
      // the modules. The partner's own half is not store-scoped and does not.
      appsController({ apps: appService }),
      partnerController({
        partners: partnerService,
        grantablePermissions: () =>
          registry
            .permissions()
            .filter(
              (entry) =>
                !entry.item.key.startsWith('partner.') && !entry.item.key.startsWith('platform.'),
            )
            .map((entry) => ({ key: entry.item.key, label: entry.item.label })),
      }),
      // Core's own routes go through the same door as a module's, so they are
      // authorised the same way and — the reason this matters — appear in the
      // generated API reference. A hand-registered endpoint does not.
      webhooksController({
        registry,
        moduleState,
        deliveries: webhookDeliveries,
        subscriptions: webhookSubscriptions,
        webhooks,
        drainWebhooks,
      }),
    ],
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

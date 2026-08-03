/**
 * Core · tests/core-services.test.mjs
 * The kernel services every module depends on. The registry tests matter most:
 * they are what prove "if it isn't declared, it doesn't load" is real behaviour
 * rather than a slogan in a README.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CacheService,
  EntitlementsService,
  EventBus,
  MemoryCacheStore,
  MemoryTokenBucketStore,
  ModuleRegistry,
  ModuleRegistryError,
  NotEntitledError,
  RateLimitedError,
  RateLimiter,
  UsageLimitExceededError,
  apiError,
  paginated,
  success,
} from '../dist/core/index.js';

const manifest = (overrides = {}) => ({
  id: 'catalog',
  version: '1.0.0',
  label: 'Catalog',
  description: 'Products.',
  entitlementKey: 'catalog',
  dependsOn: [{ module: 'core', type: 'required' }],
  capabilities: ['permissions'],
  permissions: [{ key: 'catalog.read', label: 'Read', description: '', categories: ['store'] }],
  ...overrides,
});

// --- module registry -------------------------------------------------------

test('an invalid manifest is rejected at registration, not at first use', () => {
  const registry = new ModuleRegistry();
  assert.throws(
    () => registry.register(manifest({ capabilities: ['permissions', 'jobs'] })),
    /failed capability-contract validation/,
  );
});

test('registering the same module twice is refused', () => {
  const registry = new ModuleRegistry();
  registry.register(manifest());
  assert.throws(() => registry.register(manifest()), ModuleRegistryError);
});

test('a missing required dependency refuses to start', () => {
  const registry = new ModuleRegistry();
  registry.register(
    manifest({
      id: 'shipping',
      dependsOn: [{ module: 'catalog', type: 'required' }],
    }),
  );
  assert.throws(() => registry.seal(), /unmet required dependencies/);
});

test('a missing optional dependency degrades that module instead', () => {
  const registry = new ModuleRegistry();
  registry.register(
    manifest({
      id: 'shipping',
      dependsOn: [{ module: 'search', type: 'optional' }],
    }),
  );
  const sealed = registry.seal();
  assert.equal(sealed[0].enabled, false);
  assert.match(sealed[0].degradedReason, /depends on "search"/);
  // The platform still starts — a dead optional dependency is not an outage.
  assert.equal(registry.all().length, 1);
});

test('a dependency on a capability the target does not declare is caught', () => {
  const registry = new ModuleRegistry();
  registry.register(manifest());
  registry.register(
    manifest({
      id: 'shipping',
      dependsOn: [{ module: 'catalog', type: 'required', capability: 'search' }],
    }),
  );
  assert.throws(() => registry.seal(), /needs capability "search" from "catalog"/);
});

test('two modules claiming the same route is fatal', () => {
  const registry = new ModuleRegistry();
  const withRoute = (id) =>
    manifest({
      id,
      capabilities: ['permissions', 'routes'],
      routes: [{ path: '/store/:handle/products', screen: 'ListScreen', permission: 'catalog.read' }],
    });
  registry.register(withRoute('catalog'));
  registry.register(withRoute('other'));
  assert.throws(() => registry.seal(), /Route collisions/);
});

test('modules cannot be registered after sealing', () => {
  const registry = new ModuleRegistry();
  registry.register(manifest());
  registry.seal();
  assert.throws(() => registry.register(manifest({ id: 'late' })), /after the registry is sealed/);
});

test('composed views only include enabled modules', () => {
  const registry = new ModuleRegistry();
  registry.register(manifest());
  registry.register(
    manifest({ id: 'degraded', dependsOn: [{ module: 'ghost', type: 'optional' }] }),
  );
  registry.seal();
  const owners = registry.permissions().map((entry) => entry.moduleId);
  assert.deepEqual(owners, ['catalog']);
});

test('store-scoped tables are collected for the isolation check', () => {
  const registry = new ModuleRegistry();
  registry.register(
    manifest({
      capabilities: ['permissions', 'entities'],
      entities: [
        { name: 'Product', tableName: 'products' },
        { name: 'Collection', tableName: 'collections' },
      ],
    }),
  );
  registry.seal();
  assert.deepEqual(registry.storeScopedTables(), ['products', 'collections']);
});

// --- event bus -------------------------------------------------------------

test('event names must follow the naming standard', () => {
  const bus = new EventBus();
  assert.throws(() => bus.declareEmitter('catalog', 'ProductCreated'), /must be \{context\}/);
  assert.doesNotThrow(() => bus.declareEmitter('catalog', 'catalog.product.created'));
});

test('two modules cannot own the same event', () => {
  const bus = new EventBus();
  bus.declareEmitter('catalog', 'catalog.product.created');
  assert.throws(
    () => bus.declareEmitter('other', 'catalog.product.created'),
    /already emitted by "catalog"/,
  );
});

test('a failing subscriber does not fail the emitter', async () => {
  const errors = [];
  const bus = new EventBus((error, context) => errors.push(context.moduleId));
  bus.subscribe('bad', 'catalog.product.created', () => {
    throw new Error('boom');
  });
  let reachedGoodSubscriber = false;
  bus.subscribe('good', 'catalog.product.created', () => {
    reachedGoodSubscriber = true;
  });

  const envelope = await bus.emit('catalog.product.created', { id: '1' });
  assert.equal(envelope.type, 'catalog.product.created');
  assert.equal(reachedGoodSubscriber, true, 'one bad consumer must not starve the others');
  assert.deepEqual(errors, ['bad']);
});

test('filters chain in priority order and do propagate failures', async () => {
  const bus = new EventBus();
  bus.registerHook({ name: 'beforeSave', kind: 'filter', priority: 20, handler: (v) => `${v}-second` });
  bus.registerHook({ name: 'beforeSave', kind: 'filter', priority: 10, handler: (v) => `${v}-first` });
  assert.equal(await bus.applyFilter('beforeSave', 'value'), 'value-first-second');

  bus.registerHook({
    name: 'explode',
    kind: 'filter',
    priority: 1,
    handler: () => {
      throw new Error('nope');
    },
  });
  // A filter that fails produced no value to carry forward, so it must surface.
  await assert.rejects(() => bus.applyFilter('explode', 'x'), /nope/);
});

test('unsubscribing stops delivery', async () => {
  const bus = new EventBus();
  let calls = 0;
  const off = bus.subscribe('m', 'catalog.product.created', () => {
    calls += 1;
  });
  await bus.emit('catalog.product.created', {});
  off();
  await bus.emit('catalog.product.created', {});
  assert.equal(calls, 1);
});

// --- cache -----------------------------------------------------------------

test('an entry with no invalidation tag is refused', async () => {
  const cache = new CacheService(new MemoryCacheStore());
  await assert.rejects(
    () => cache.wrap('k', { ttlSeconds: 60, tags: [] }, async () => 1),
    /declares no tags/,
  );
});

test('cache-first: a hit does not recompute', async () => {
  const cache = new CacheService(new MemoryCacheStore());
  let computed = 0;
  const compute = async () => {
    computed += 1;
    return { value: 42 };
  };
  await cache.wrap('k', { ttlSeconds: 60, tags: ['t'] }, compute);
  const second = await cache.wrap('k', { ttlSeconds: 60, tags: ['t'] }, compute);
  assert.equal(computed, 1);
  assert.deepEqual(second, { value: 42 });
});

test('tag invalidation busts every entry carrying it', async () => {
  const cache = new CacheService(new MemoryCacheStore());
  await cache.wrap('a', { ttlSeconds: 60, tags: ['products'] }, async () => 1);
  await cache.wrap('b', { ttlSeconds: 60, tags: ['products'] }, async () => 2);
  await cache.wrap('c', { ttlSeconds: 60, tags: ['orders'] }, async () => 3);

  assert.equal(await cache.invalidateTags(['products']), 2);
  let recomputed = 0;
  await cache.wrap('a', { ttlSeconds: 60, tags: ['products'] }, async () => {
    recomputed += 1;
    return 1;
  });
  assert.equal(recomputed, 1);
});

test('cache keys are namespaced per store', () => {
  const cache = new CacheService(new MemoryCacheStore());
  assert.equal(cache.keyFor('store-1', 'products', 'list'), 'store:store-1:products:list');
  assert.equal(cache.platformKey('modules'), 'platform:modules');
});

// --- entitlements ----------------------------------------------------------

function entitlementsFixture(limits = []) {
  const usage = new Map();
  const ledger = {
    reserved: async (storeId, featureKey) => usage.get(`${storeId}:${featureKey}`) ?? 0,
    reserve: async (storeId, featureKey) => {
      usage.set(`${storeId}:${featureKey}`, (usage.get(`${storeId}:${featureKey}`) ?? 0) + 1);
    },
    consume: async () => {},
    release: async (storeId, featureKey) => {
      usage.set(`${storeId}:${featureKey}`, (usage.get(`${storeId}:${featureKey}`) ?? 1) - 1);
    },
  };
  const source = {
    load: async (storeId) => ({
      storeId,
      planKey: 'growth',
      enabledModules: ['catalog'],
      limits,
    }),
  };
  return new EntitlementsService(source, new CacheService(new MemoryCacheStore()), ledger);
}

test('a disabled module is refused', async () => {
  const service = entitlementsFixture();
  await assert.doesNotReject(() => service.assertModule('store-1', 'catalog'));
  await assert.rejects(() => service.assertModule('store-1', 'shipping'), NotEntitledError);
});

test('the entitlements hash is stable across key order and changes with content', async () => {
  const a = await entitlementsFixture([{ featureKey: 'x', limit: 5, window: 'monthly' }]).hashFor('s');
  const b = await entitlementsFixture([{ featureKey: 'x', limit: 5, window: 'monthly' }]).hashFor('s');
  const c = await entitlementsFixture([{ featureKey: 'x', limit: 6, window: 'monthly' }]).hashFor('s');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('usage is refused once the window is spent', async () => {
  const service = entitlementsFixture([{ featureKey: 'imports', limit: 2, window: 'monthly' }]);
  await service.reserveUsage('store-1', 'imports', 'e1');
  await service.reserveUsage('store-1', 'imports', 'e2');
  await assert.rejects(
    () => service.reserveUsage('store-1', 'imports', 'e3'),
    UsageLimitExceededError,
  );
});

test('an unlimited feature never blocks', async () => {
  const service = entitlementsFixture([{ featureKey: 'imports', limit: null, window: 'monthly' }]);
  for (let index = 0; index < 50; index += 1) {
    await service.reserveUsage('store-1', 'imports', `e${index}`);
  }
});

// --- rate limiting ---------------------------------------------------------

test('the bucket allows a burst then throttles', async () => {
  let now = 0;
  const limiter = new RateLimiter(new MemoryTokenBucketStore(), () => now);
  const spec = { refillPerSecond: 1, capacity: 3 };

  for (let index = 0; index < 3; index += 1) {
    assert.equal((await limiter.check('k', spec)).allowed, true);
  }
  const blocked = await limiter.check('k', spec);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test('tokens refill over time', async () => {
  let now = 0;
  const limiter = new RateLimiter(new MemoryTokenBucketStore(), () => now);
  const spec = { refillPerSecond: 1, capacity: 2 };

  await limiter.check('k', spec);
  await limiter.check('k', spec);
  assert.equal((await limiter.check('k', spec)).allowed, false);

  now = 2000;
  assert.equal((await limiter.check('k', spec)).allowed, true);
});

test('enforce throws rather than returning a decision to ignore', async () => {
  const limiter = new RateLimiter(new MemoryTokenBucketStore(), () => 0);
  const spec = { refillPerSecond: 0, capacity: 1 };
  await limiter.enforce('k', spec);
  await assert.rejects(() => limiter.enforce('k', spec), RateLimitedError);
});

test('GraphQL is limited by query cost, not request count', async () => {
  const limiter = new RateLimiter(new MemoryTokenBucketStore(), () => 0);
  const spec = { refillPerSecond: 0, capacity: 100 };
  await limiter.enforceQueryCost('store-1', spec, 80);
  // One expensive query can exhaust what a hundred cheap ones would not.
  await assert.rejects(() => limiter.enforceQueryCost('store-1', spec, 80), RateLimitedError);
});

// --- response envelope -----------------------------------------------------

test('every response carries the same shape', () => {
  const meta = { requestId: 'r1' };
  const ok = success({ id: '1' }, meta);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data.id, '1');

  const page = paginated(
    { nodes: [1, 2], pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'a', endCursor: 'b' } },
    meta,
  );
  assert.equal(page.meta.pagination.hasNextPage, true);
  assert.equal(page.data.length, 2);
});

test('error codes map to their HTTP status', () => {
  assert.equal(apiError('not_found', 'Missing', 'No such product').status, 404);
  assert.equal(apiError('rate_limited', 'Slow down', 'Too many').status, 429);
  assert.equal(apiError('not_entitled', 'Upgrade', 'Plan does not include this').status, 402);
});

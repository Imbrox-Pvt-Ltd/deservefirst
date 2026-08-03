/**
 * Core · tests/tenant-context.test.mjs
 * The isolation guarantee, tested rather than asserted (§20.1). These cover the
 * three ways the boundary can fail: context missing, context mismatched, and
 * context not reaching the database layer.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MissingStoreContextError,
  TenantMismatchError,
  assertTenantMatches,
  getRequestContext,
  installPostgresRlsContext,
  requireStoreContext,
  withRequestContext,
  __testing,
} from '../dist/core/tenant-context/index.js';

const context = (overrides = {}) => ({
  requestId: 'req-1',
  correlationId: 'corr-1',
  actorType: 'user',
  userId: 'user-1',
  organizationId: 'org-1',
  businessEntityId: null,
  storeId: 'store-1',
  partnerId: null,
  accessType: 'member',
  roleKeys: ['owner'],
  permissions: ['catalog.read'],
  supportSessionId: null,
  entitlementsHash: 'hash',
  locale: 'en-US',
  timeZone: 'UTC',
  shardKey: 'shard-0',
  ...overrides,
});

test('store-scoped work without a context fails loudly', () => {
  assert.throws(() => requireStoreContext('listProducts'), MissingStoreContextError);
});

test('a platform context without a store is still rejected for store-scoped work', () => {
  withRequestContext(context({ storeId: null }), () => {
    assert.throws(() => requireStoreContext('listProducts'), /store-scoped but ran without an active store context/);
  });
});

test('context is available throughout the async subtree', async () => {
  await withRequestContext(context(), async () => {
    assert.equal(getRequestContext().storeId, 'store-1');
    await new Promise((resolve) => setTimeout(resolve, 1));
    // Still bound after an await — this is the property the database layer relies on.
    assert.equal(requireStoreContext('afterAwait').storeId, 'store-1');
  });
});

test('context does not leak outside its scope', () => {
  withRequestContext(context(), () => {
    assert.equal(getRequestContext().storeId, 'store-1');
  });
  assert.equal(getRequestContext(), undefined);
});

test('concurrent requests do not see each other\'s context', async () => {
  const observed = await Promise.all([
    withRequestContext(context({ storeId: 'store-a' }), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getRequestContext().storeId;
    }),
    withRequestContext(context({ storeId: 'store-b' }), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getRequestContext().storeId;
    }),
  ]);
  assert.deepEqual(observed, ['store-a', 'store-b']);
});

test('a tenant mismatch throws a 403 carrying both sides', () => {
  try {
    assertTenantMatches('tenant', 'store-resolved', 'store-claimed', {
      requestId: 'req-1',
      userId: 'user-1',
      organizationId: 'org-1',
      storeId: 'store-resolved',
    });
    assert.fail('expected a mismatch to throw');
  } catch (error) {
    assert.ok(error instanceof TenantMismatchError);
    assert.equal(error.status, 403);
    assert.equal(error.details.resolved, 'store-resolved');
    assert.equal(error.details.claimed, 'store-claimed');
  }
});

test('matching tenants pass, and both-absent is a valid platform request', () => {
  const base = { requestId: 'r', userId: null, organizationId: null, storeId: null };
  assert.doesNotThrow(() => assertTenantMatches('tenant', 'store-1', 'store-1', base));
  assert.doesNotThrow(() => assertTenantMatches('tenant', null, null, base));
  assert.throws(() => assertTenantMatches('tenant', 'store-1', null, base), TenantMismatchError);
});

test('the database snapshot fails closed when no context is bound', () => {
  const snapshot = __testing.snapshotContext();
  // Empty strings match no policy, so a missing context sees nothing rather than everything.
  assert.deepEqual(snapshot, {
    organizationId: '',
    storeId: '',
    actorUserId: '',
    actorType: '',
    accessType: '',
    requestId: '',
  });
});

// --- the RLS query-runner patch, against a fake driver -----------------------

function fakeDataSource() {
  const executed = [];
  const runner = {
    query: async (sql, params) => {
      executed.push({ sql, params });
      return [];
    },
    release: async () => {},
  };
  const dataSource = {
    options: { type: 'postgres' },
    createQueryRunner: () => runner,
  };
  return { dataSource, runner, executed };
}

test('context is pushed into the session before the first real statement', async () => {
  const { dataSource, executed } = fakeDataSource();
  installPostgresRlsContext(dataSource);

  await withRequestContext(context(), async () => {
    const runner = dataSource.createQueryRunner();
    await runner.query('SELECT 1');
  });

  assert.equal(executed.length, 2);
  assert.match(executed[0].sql, /set_config\('app\.current_store_id'/);
  assert.deepEqual(executed[0].params, ['org-1', 'store-1', 'user-1', 'user', 'member', 'req-1']);
  assert.equal(executed[1].sql, 'SELECT 1');
});

test('the context statement is not re-sent while the context is unchanged', async () => {
  const { dataSource, executed } = fakeDataSource();
  installPostgresRlsContext(dataSource);

  await withRequestContext(context(), async () => {
    const runner = dataSource.createQueryRunner();
    await runner.query('SELECT 1');
    await runner.query('SELECT 2');
    await runner.query('SELECT 3');
  });

  const contextStatements = executed.filter((entry) => entry.sql.includes('set_config'));
  assert.equal(contextStatements.length, 1, 'context should be applied once per signature');
  assert.equal(executed.length, 4);
});

test('a released connection re-applies context for the next borrower', async () => {
  const { dataSource, executed } = fakeDataSource();
  installPostgresRlsContext(dataSource);
  const runner = dataSource.createQueryRunner();

  await withRequestContext(context({ storeId: 'store-a' }), async () => {
    await runner.query('SELECT 1');
  });
  await runner.release();
  await withRequestContext(context({ storeId: 'store-b' }), async () => {
    await runner.query('SELECT 2');
  });

  const applied = executed.filter((entry) => entry.sql.includes('set_config'));
  assert.equal(applied.length, 2, 'a pooled connection must not inherit the previous store');
  assert.equal(applied[0].params[1], 'store-a');
  assert.equal(applied[1].params[1], 'store-b');
});

test('switching context on a live connection re-applies it', async () => {
  const { dataSource, executed } = fakeDataSource();
  installPostgresRlsContext(dataSource);
  const runner = dataSource.createQueryRunner();

  await withRequestContext(context({ storeId: 'store-a' }), () => runner.query('SELECT 1'));
  await withRequestContext(context({ storeId: 'store-b' }), () => runner.query('SELECT 2'));

  const applied = executed.filter((entry) => entry.sql.includes('set_config'));
  assert.equal(applied.length, 2);
  assert.equal(applied[1].params[1], 'store-b');
});

test('installing the patch twice does not double-wrap', async () => {
  const { dataSource, executed } = fakeDataSource();
  installPostgresRlsContext(dataSource);
  installPostgresRlsContext(dataSource);

  await withRequestContext(context(), async () => {
    const runner = dataSource.createQueryRunner();
    await runner.query('SELECT 1');
  });

  assert.equal(executed.filter((entry) => entry.sql.includes('set_config')).length, 1);
});

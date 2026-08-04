/**
 * Auth · tests/identity-isolation.e2e.test.mjs
 * The Phase 2 exit criterion, against a real database.
 *
 * A single user holds memberships in two stores, under two business entities, in
 * one organization. They log in once, switch between stores, and store A's data
 * must be unreachable from store B — through the repository, through the list
 * engine, and at the guard.
 *
 * Skips cleanly when no database is reachable.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { parseListQuery } from '@deservefirst/contracts';

import { createMysqlPool, MysqlExecutor } from '../dist/core/database/mysql-executor.js';
import { mysqlDialect } from '../dist/core/list-engine/dialect.js';
import { ListEngine } from '../dist/core/list-engine/index.js';
import {
  QueryGuard,
  UnscopedQueryError,
  guardExecutor,
  withRequestContext,
} from '../dist/core/tenant-context/index.js';
import { AccessEvaluator } from '../dist/auth/application/index.js';
import { hashPassword, SYSTEM_ROLES, verifyPassword } from '../dist/auth/domain/index.js';
import { SqlIdentityRepository } from '../dist/auth/infrastructure/index.js';
import { productResource } from '../dist/modules/catalog/contracts/index.js';
import { ProductRepositoryImpl } from '../dist/modules/catalog/infrastructure/index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3306/deservefirst_db';

const suffix = randomUUID().slice(0, 8);
const ids = {
  org: `org-${suffix}`,
  entityUs: `be-us-${suffix}`,
  entityIn: `be-in-${suffix}`,
  storeA: `store-a-${suffix}`,
  storeB: `store-b-${suffix}`,
  user: `user-${suffix}`,
  outsider: `outsider-${suffix}`,
  roleOwner: `role-owner-${suffix}`,
  roleStaff: `role-staff-${suffix}`,
};

const usd = (minor) => ({ amountMinor: BigInt(minor), currency: 'USD' });

const contextFor = (storeId, permissions = []) => ({
  requestId: 'e2e',
  correlationId: 'e2e',
  actorType: 'user',
  userId: ids.user,
  organizationId: ids.org,
  businessEntityId: null,
  storeId,
  partnerId: null,
  accessType: 'member',
  roleKeys: [],
  permissions,
  supportSessionId: null,
  entitlementsHash: null,
  locale: 'en-US',
  timeZone: 'UTC',
  shardKey: null,
});

let pool;
let executor;
let identity;
let available = false;

describe('identity isolation (e2e)', { concurrency: 1 }, () => {
  before(async () => {
    try {
      pool = await createMysqlPool(DATABASE_URL);
      await pool.query('SELECT 1');
      available = true;
    } catch {
      return;
    }

    executor = new MysqlExecutor({ pool });
    identity = new SqlIdentityRepository(executor, mysqlDialect);

    // One organization, two legal entities in different countries, two stores.
    await identity.createOrganization({
      id: ids.org,
      name: `Acme ${suffix}`,
      requireSecureSignIn: false,
      createdAt: new Date(),
    });
    await identity.createBusinessEntity({
      id: ids.entityUs, organizationId: ids.org, name: 'Acme Inc.',
      countryCode: 'US', companyType: 'Corporation', taxRegistrationId: null, archivedAt: null,
    });
    await identity.createBusinessEntity({
      id: ids.entityIn, organizationId: ids.org, name: 'Acme India Pvt. Ltd.',
      countryCode: 'IN', companyType: 'Private company', taxRegistrationId: null, archivedAt: null,
    });

    const storeBase = {
      organizationId: ids.org, type: 'live', status: 'active',
      defaultLocale: 'en-US', timeZone: 'UTC', featurePreviews: [], createdAt: new Date(),
    };
    await identity.createStore({
      ...storeBase, id: ids.storeA, handle: `acme-us-${suffix}`, name: 'Acme US',
      businessEntityId: ids.entityUs, baseCurrency: 'USD',
    });
    await identity.createStore({
      ...storeBase, id: ids.storeB, handle: `acme-in-${suffix}`, name: 'Acme India',
      businessEntityId: ids.entityIn, baseCurrency: 'INR',
    });

    // One user with access to both; one outsider with access to neither.
    for (const [id, email] of [[ids.user, `owner+${suffix}@example.test`], [ids.outsider, `outsider+${suffix}@example.test`]]) {
      await identity.createUser(
        {
          id, email, emailVerifiedAt: null, secondaryEmail: null,
          firstName: 'Test', lastName: 'User', status: 'active', mfaEnabled: false,
          providerRef: null, locale: 'en-US', timeZone: 'UTC', createdAt: new Date(),
        },
        await hashPassword('a-perfectly-fine-passphrase'),
      );
    }

    for (const storeId of [ids.storeA, ids.storeB]) {
      await identity.createMembership({
        id: `m-${storeId}`, userId: ids.user, storeId,
        organizationId: ids.org, status: 'active', invitedBy: null, createdAt: new Date(),
      });
    }

    // Owner everywhere in the org; staff only on store A.
    const owner = SYSTEM_ROLES.find((role) => role.key === 'owner');
    const staff = SYSTEM_ROLES.find((role) => role.key === 'staff');

    await identity.createRole({
      id: ids.roleOwner, organizationId: ids.org, storeId: null, category: 'organization',
      name: owner.name, description: '', permissions: owner.permissions, system: true, grantsApproval: true,
    });
    await identity.createRole({
      id: ids.roleStaff, organizationId: ids.org, storeId: ids.storeA, category: 'store',
      name: staff.name, description: '', permissions: staff.permissions, system: true, grantsApproval: false,
    });

    await identity.assignRole({ id: `ra-org-${suffix}`, organizationId: ids.org, userId: ids.user, roleId: ids.roleOwner, storeId: null });
    await identity.assignRole({ id: `ra-a-${suffix}`, organizationId: ids.org, userId: ids.user, roleId: ids.roleStaff, storeId: ids.storeA });

    // One product in each store, same handle — that must be allowed.
    for (const [storeId, title] of [[ids.storeA, 'US Widget'], [ids.storeB, 'India Widget']]) {
      await withRequestContext(contextFor(storeId), async () => {
        const products = new ProductRepositoryImpl(executor, mysqlDialect);
        await products.insert({
          id: `p-${storeId}`, handle: 'shared-handle', title, description: '',
          status: 'active', vendor: 'Acme', productType: null, price: usd(1000),
          compareAtPrice: null, costPerItem: null, variants: [], optionNames: [],
          publishedChannels: [], version: 1,
        });
      });
    }
  });

  after(async () => {
    if (!available) return;
    const cleanup = [
      ['products', 'store_id', [ids.storeA, ids.storeB]],
      ['role_assignments', 'organization_id', [ids.org]],
      ['roles', 'organization_id', [ids.org]],
      ['memberships', 'organization_id', [ids.org]],
      ['stores', 'organization_id', [ids.org]],
      ['business_entities', 'organization_id', [ids.org]],
      ['users', 'id', [ids.user, ids.outsider]],
      ['organizations', 'id', [ids.org]],
    ];
    for (const [table, column, values] of cleanup) {
      await executor.query(
        `DELETE FROM \`${table}\` WHERE \`${column}\` IN (${values.map(() => '?').join(', ')})`,
        values,
      );
    }
    await pool.end();
  });

  test('one user reaches two stores under two business entities in one org', async (t) => {
    if (!available) return t.skip('no database');

    const memberships = await identity.membershipsFor(ids.user);
    assert.equal(memberships.length, 2);

    const byHandle = new Map(memberships.map((membership) => [membership.store.name, membership]));
    assert.equal(byHandle.get('Acme US').store.businessEntityId, ids.entityUs);
    assert.equal(byHandle.get('Acme India').store.businessEntityId, ids.entityIn);
    // Different legal entities means different currencies and tax identity.
    assert.equal(byHandle.get('Acme US').store.baseCurrency, 'USD');
    assert.equal(byHandle.get('Acme India').store.baseCurrency, 'INR');
    assert.equal(new Set(memberships.map((m) => m.organizationId)).size, 1);
  });

  test('an outsider has no memberships at all', async (t) => {
    if (!available) return t.skip('no database');
    assert.deepEqual(await identity.membershipsFor(ids.outsider), []);
  });

  test('the stored password verifies and is not recoverable', async (t) => {
    if (!available) return t.skip('no database');

    const stored = await identity.findUserByEmail(`owner+${suffix}@example.test`);
    assert.equal(await verifyPassword('a-perfectly-fine-passphrase', stored.passwordHash), true);
    assert.equal(await verifyPassword('wrong', stored.passwordHash), false);
    assert.ok(!stored.passwordHash.includes('a-perfectly-fine-passphrase'));
  });

  test('permissions differ per store, from org-wide and store-scoped roles', async (t) => {
    if (!available) return t.skip('no database');

    const onA = await identity.permissionsFor(ids.user, ids.storeA);
    const onB = await identity.permissionsFor(ids.user, ids.storeB);

    // The org-wide role applies to both stores.
    assert.ok(onA.includes('organization.users.manage'));
    assert.ok(onB.includes('organization.users.manage'));

    // The staff role was assigned only to store A.
    assert.ok(onA.includes('orders.read'), 'store A should carry the staff permissions');
    assert.ok(!onB.includes('orders.read'), 'a store-scoped role must not leak to another store');
  });

  test('THE EXIT CRITERION: store A data is unreachable from store B', async (t) => {
    if (!available) return t.skip('no database');

    // Same handle in both stores — allowed, and each store sees only its own.
    await withRequestContext(contextFor(ids.storeA), async () => {
      const products = new ProductRepositoryImpl(executor, mysqlDialect);
      assert.equal((await products.findByHandle('shared-handle')).title, 'US Widget');
      assert.equal(await products.findById(`p-${ids.storeB}`), null, 'store A reached store B by id');
    });

    await withRequestContext(contextFor(ids.storeB), async () => {
      const products = new ProductRepositoryImpl(executor, mysqlDialect);
      assert.equal((await products.findByHandle('shared-handle')).title, 'India Widget');
      assert.equal(await products.findById(`p-${ids.storeA}`), null, 'store B reached store A by id');
    });

    // And through the list engine, which is what every screen actually uses.
    for (const [storeId, expected] of [[ids.storeA, 'US Widget'], [ids.storeB, 'India Widget']]) {
      await withRequestContext(contextFor(storeId), async () => {
        const engine = new ListEngine(executor);
        const connection = await engine.list({
          resource: productResource,
          tableName: 'products',
          dialect: mysqlDialect,
          query: parseListQuery(new URLSearchParams('query=vendor%3AAcme')),
        });
        const titles = connection.nodes.map((row) => row.title);
        assert.deepEqual(titles, [expected], `store ${storeId} saw ${titles.join(', ')}`);
      });
    }
  });

  test('switching store rescopes what is visible, with no re-authentication', async (t) => {
    if (!available) return t.skip('no database');

    const seen = [];
    // The same session, moving between stores — exactly what the store switcher does.
    for (const storeId of [ids.storeA, ids.storeB, ids.storeA]) {
      await withRequestContext(contextFor(storeId), async () => {
        const products = new ProductRepositoryImpl(executor, mysqlDialect);
        seen.push((await products.findByHandle('shared-handle')).title);
      });
    }
    assert.deepEqual(seen, ['US Widget', 'India Widget', 'US Widget']);
  });

  test('the guard blocks an unscoped read of merchant data but allows identity lookups', async (t) => {
    if (!available) return t.skip('no database');

    const guarded = guardExecutor(
      new MysqlExecutor({ pool }),
      // Only products is store-scoped; users and stores are not, per the manifest.
      new QueryGuard({ storeScopedTables: ['products'], enforce: true }),
    );

    await withRequestContext(contextFor(ids.storeA), async () => {
      await assert.rejects(() => guarded.query('SELECT id FROM products', []), UnscopedQueryError);

      // A login must still be able to find a user before any store exists.
      const rows = await guarded.query('SELECT id FROM users WHERE email = ?', [
        `owner+${suffix}@example.test`,
      ]);
      assert.equal(rows.length, 1);
    });
  });

  test('the access evaluator refuses a cross-store action', async (t) => {
    if (!available) return t.skip('no database');

    const evaluator = new AccessEvaluator({
      isModuleEnabledGlobally: () => true,
      isModuleEnabledForStore: async () => true,
      isEntitled: async () => true,
      permissionRequiresApproval: () => false,
      supportSessionValid: async () => true,
    });

    const onA = contextFor(ids.storeA, await identity.permissionsFor(ids.user, ids.storeA));

    const sameStore = await evaluator.evaluate({ context: onA, permission: 'orders.read' });
    assert.equal(sameStore.allowed, true);

    // Holding the permission in store A does not authorise acting on store B.
    const crossStore = await evaluator.evaluate({
      context: onA,
      permission: 'orders.read',
      targetStoreId: ids.storeB,
    });
    assert.equal(crossStore.allowed, false);
    assert.equal(crossStore.reason, 'store-mismatch');
  });

  test('a permission the user does not hold is refused', async (t) => {
    if (!available) return t.skip('no database');

    const evaluator = new AccessEvaluator({
      isModuleEnabledGlobally: () => true,
      isModuleEnabledForStore: async () => true,
      isEntitled: async () => true,
      permissionRequiresApproval: () => false,
      supportSessionValid: async () => true,
    });

    const onB = contextFor(ids.storeB, await identity.permissionsFor(ids.user, ids.storeB));
    const decision = await evaluator.evaluate({ context: onB, permission: 'orders.read' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'permission-missing');
  });
});

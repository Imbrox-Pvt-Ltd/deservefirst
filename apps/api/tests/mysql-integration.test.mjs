/**
 * Core · tests/mysql-integration.test.mjs
 * The first tests that touch a real database. Everything before this verified
 * SQL by shape; these verify it by execution — which is where dialect bugs,
 * column drift and type coercion actually surface.
 *
 * The isolation tests matter most: MySQL has no row-level security, so the
 * query guard is the only thing preventing a forgotten predicate from reading
 * another tenant's rows. If these fail, the interim database is not safe to use.
 *
 * Skips cleanly when DATABASE_URL is unset, so CI without a database stays green.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { parseListQuery } from '@deservefirst/contracts';

import { mysqlDialect } from '../dist/core/list-engine/dialect.js';
import { ListEngine } from '../dist/core/list-engine/index.js';
import { createMysqlPool, MysqlExecutor } from '../dist/core/database/mysql-executor.js';
import {
  QueryGuard,
  UnscopedQueryError,
  guardExecutor,
  withRequestContext,
} from '../dist/core/tenant-context/index.js';
import { productResource } from '../dist/modules/catalog/contracts/index.js';
import { ProductRepositoryImpl } from '../dist/modules/catalog/infrastructure/index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3306/deservefirst_db';

const STORE_A = 'store-alpha';
const STORE_B = 'store-beta';

const context = (storeId) => ({
  requestId: 'test-req',
  correlationId: 'test-corr',
  actorType: 'user',
  userId: 'user-1',
  organizationId: 'org-1',
  businessEntityId: null,
  storeId,
  partnerId: null,
  accessType: 'member',
  roleKeys: ['owner'],
  permissions: ['catalog.read', 'catalog.write'],
  supportSessionId: null,
  entitlementsHash: null,
  locale: 'en-US',
  timeZone: 'UTC',
  shardKey: null,
});

const usd = (minor) => ({ amountMinor: BigInt(minor), currency: 'USD' });

let pool;
let executor;
let guarded;
let available = false;

describe('MySQL integration', { concurrency: 1 }, () => {
  before(async () => {
    try {
      pool = await createMysqlPool(DATABASE_URL);
      await pool.query('SELECT 1');
      available = true;
    } catch {
      // No database in this environment — the suite reports skipped, not failed.
      return;
    }

    executor = new MysqlExecutor({ pool });
    guarded = guardExecutor(
      new MysqlExecutor({ pool }),
      new QueryGuard({ storeScopedTables: ['products'], enforce: true }),
    );

    await executor.query('DELETE FROM products WHERE store_id IN (?, ?)', [STORE_A, STORE_B]);
  });

  after(async () => {
    if (!available) return;
    await executor.query('DELETE FROM products WHERE store_id IN (?, ?)', [STORE_A, STORE_B]);
    await pool.end();
  });

  test('writes and reads a product through the repository', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      await repository.insert({
        id: 'p-1',
        handle: 'blue-shirt',
        title: 'Blue Shirt',
        description: 'A shirt.',
        status: 'active',
        vendor: 'Acme',
        productType: 'Shirt',
        price: usd(1999),
        compareAtPrice: usd(2999),
        costPerItem: usd(800),
        variants: [],
        optionNames: [],
        publishedChannels: ['online-store'],
        version: 1,
      });

      const found = await repository.findById('p-1');
      assert.equal(found.title, 'Blue Shirt');
      // Money must survive the round trip exactly — no float, no precision loss.
      assert.equal(found.price.amountMinor, 1999n);
      assert.equal(found.price.currency, 'USD');
      assert.equal(found.compareAtPrice.amountMinor, 2999n);
      assert.equal(found.costPerItem.amountMinor, 800n);
      assert.deepEqual(found.publishedChannels, ['online-store']);
    });
  });

  test('a large money amount survives BIGINT without precision loss', async (t) => {
    if (!available) return t.skip('no database');

    // Above 2^53 — a driver coercing BIGINT to a JS number would corrupt this.
    const huge = 9007199254740993n;
    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      await repository.insert({
        id: 'p-big',
        handle: 'expensive',
        title: 'Expensive',
        description: '',
        status: 'draft',
        vendor: null,
        productType: null,
        price: { amountMinor: huge, currency: 'USD' },
        compareAtPrice: null,
        costPerItem: null,
        variants: [],
        optionNames: [],
        publishedChannels: [],
        version: 1,
      });
      const found = await repository.findById('p-big');
      assert.equal(found.price.amountMinor, huge);
    });
  });

  test('one store cannot see another store\'s rows', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_B), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      await repository.insert({
        id: 'p-2',
        handle: 'blue-shirt',
        title: 'Beta Shirt',
        description: '',
        status: 'active',
        vendor: 'Beta',
        productType: null,
        price: usd(500),
        compareAtPrice: null,
        costPerItem: null,
        variants: [],
        optionNames: [],
        publishedChannels: [],
        version: 1,
      });
    });

    // The same handle exists in both stores — that must be allowed, and each
    // store must see only its own.
    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      assert.equal(await repository.findById('p-2'), null, 'store A must not read store B');
      const byHandle = await repository.findByHandle('blue-shirt');
      assert.equal(byHandle.title, 'Blue Shirt');
    });

    await withRequestContext(context(STORE_B), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      const byHandle = await repository.findByHandle('blue-shirt');
      assert.equal(byHandle.title, 'Beta Shirt');
    });
  });

  test('the list engine returns only the active store, with real SQL', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const engine = new ListEngine(executor);
      const connection = await engine.list({
        resource: productResource,
        tableName: 'products',
        dialect: mysqlDialect,
        query: parseListQuery(new URLSearchParams('order=title+asc')),
      });

      const titles = connection.nodes.map((row) => row.title);
      assert.ok(titles.includes('Blue Shirt'));
      assert.ok(!titles.includes('Beta Shirt'), 'cross-tenant row leaked into the list');
    });
  });

  test('filter tokens compile and execute against MariaDB', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const engine = new ListEngine(executor);
      const connection = await engine.list({
        resource: productResource,
        tableName: 'products',
        dialect: mysqlDialect,
        query: parseListQuery(
          new URLSearchParams('query=' + encodeURIComponent('vendor:acme status:active')),
        ),
      });
      assert.equal(connection.nodes.length, 1);
      assert.equal(connection.nodes[0].title, 'Blue Shirt');
    });
  });

  test('free-text search executes and is case-insensitive', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const engine = new ListEngine(executor);
      const connection = await engine.list({
        resource: productResource,
        tableName: 'products',
        dialect: mysqlDialect,
        query: parseListQuery(new URLSearchParams('query=BLUE')),
      });
      assert.equal(connection.nodes.length, 1);
    });
  });

  test('cursor pagination walks the whole set without repeats or gaps', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      for (let index = 0; index < 5; index += 1) {
        await repository.insert({
          id: `page-${index}`,
          handle: `page-${index}`,
          title: `Page ${index}`,
          description: '',
          status: 'active',
          vendor: 'Pager',
          productType: null,
          price: usd(100 + index),
          compareAtPrice: null,
          costPerItem: null,
          variants: [],
          optionNames: [],
          publishedChannels: [],
          version: 1,
        });
      }

      const engine = new ListEngine(executor);
      const seen = [];
      let cursor = null;

      for (let page = 0; page < 10; page += 1) {
        const search = new URLSearchParams('query=vendor%3APager&order=title+asc&limit=2');
        if (cursor) search.set('after', cursor);

        const connection = await engine.list({
          resource: productResource,
          tableName: 'products',
          dialect: mysqlDialect,
          query: parseListQuery(search),
        });

        seen.push(...connection.nodes.map((row) => row.title));
        if (!connection.pageInfo.hasNextPage) break;
        cursor = connection.pageInfo.endCursor;
      }

      assert.deepEqual(seen, ['Page 0', 'Page 1', 'Page 2', 'Page 3', 'Page 4']);
      assert.equal(new Set(seen).size, seen.length, 'a row was returned on two pages');
    });
  });

  test('optimistic concurrency rejects a stale write', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      const product = await repository.findById('p-1');

      await repository.update({ ...product, title: 'First writer', version: product.version + 1 }, product.version);

      await assert.rejects(
        () =>
          repository.update(
            { ...product, title: 'Second writer', version: product.version + 1 },
            product.version,
          ),
        /was modified by someone else/,
      );

      const current = await repository.findById('p-1');
      assert.equal(current.title, 'First writer', 'the losing write must not have applied');
    });
  });

  test('soft delete hides the row but keeps it', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const repository = new ProductRepositoryImpl(executor, mysqlDialect);
      await repository.softDelete('p-big');
      assert.equal(await repository.findById('p-big'), null);
    });

    const rows = await executor.query('SELECT id, deleted_at FROM products WHERE id = ?', ['p-big']);
    assert.equal(rows.length, 1, 'the row must still exist for restore');
    assert.notEqual(rows[0].deleted_at, null);
  });

  // --- the compensating control -------------------------------------------

  test('the query guard blocks an unscoped read of a store-scoped table', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      // This is precisely what RLS would have caught on Postgres.
      await assert.rejects(
        () => guarded.query('SELECT id, title FROM products', []),
        UnscopedQueryError,
      );
      await assert.rejects(
        () => guarded.query('UPDATE products SET title = ?', ['hacked']),
        UnscopedQueryError,
      );
      await assert.rejects(() => guarded.query('DELETE FROM products', []), UnscopedQueryError);
    });
  });

  test('the guard allows a properly scoped statement', async (t) => {
    if (!available) return t.skip('no database');

    await withRequestContext(context(STORE_A), async () => {
      const rows = await guarded.query('SELECT id FROM products WHERE store_id = ?', [STORE_A]);
      assert.ok(Array.isArray(rows));
    });
  });

  test('an unscoped read really would have leaked — proving the guard earns its place', async (t) => {
    if (!available) return t.skip('no database');

    // Same statement, unguarded executor. It returns both stores' rows, which is
    // the exact behaviour MySQL permits and Postgres RLS would not.
    const leaked = await executor.query('SELECT store_id FROM products', []);
    const stores = new Set(leaked.map((row) => row.store_id));
    assert.ok(stores.has(STORE_A) && stores.has(STORE_B), 'expected the unguarded query to cross tenants');
  });
});

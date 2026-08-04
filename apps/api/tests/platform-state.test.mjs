/**
 * Tests · platform-state.test.mjs
 * The two layered controls, and the fact that they layer in OPPOSITE directions.
 *
 * Module availability: the platform is absolute — off means off everywhere.
 * Settings: the store is authoritative — the platform only moves the default.
 *
 * Getting either backwards is the kind of mistake that looks fine in review and
 * is discovered during an incident, so both directions are pinned here.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  CacheService,
  MemoryCacheStore,
  ModuleStateService,
  SettingsService,
  envNameFor,
} from '../dist/core/index.js';
import { mysqlDialect } from '../dist/core/list-engine/dialect.js';

/**
 * An executor over in-memory tables.
 *
 * Enough SQL to answer what these services ask: SELECT with equality filters,
 * INSERT, and DELETE. It parses the statements the services actually emit
 * rather than pretending to be a database.
 */
function makeExecutor() {
  const tables = new Map();
  const rowsOf = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  const tableOf = (sql) =>
    /(?:FROM|INTO|UPDATE)\s+`([a-z_]+)`/i.exec(sql)?.[1] ?? '';

  return {
    tables,
    async query(sql, parameters = []) {
      const table = tableOf(sql);
      const rows = rowsOf(table);

      if (/^\s*INSERT/i.test(sql)) {
        const columns = [...sql.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).slice(1);
        const row = {};
        columns.forEach((column, index) => {
          row[column] = parameters[index];
        });
        row.deleted_at = null;
        rows.push(row);
        return [];
      }

      // Both SELECT and DELETE filter on the same equality predicates.
      const predicates = [...sql.matchAll(/`([a-z_]+)`\s*=\s*(?:\?|\$\d+)/g)].map((m) => m[1]);
      const matches = (row) =>
        predicates.every((column, index) => String(row[column]) === String(parameters[index]));

      if (/^\s*DELETE/i.test(sql)) {
        const keep = rows.filter((row) => !matches(row));
        tables.set(table, keep);
        return [];
      }

      return rows.filter((row) => matches(row) && row.deleted_at === null);
    },
  };
}

const KNOWN = ['catalog', 'inventory', 'content'];
const STORE = 'store-1';
const OTHER_STORE = 'store-2';

let executor;
let modules;

beforeEach(() => {
  executor = makeExecutor();
  modules = new ModuleStateService({
    executor,
    dialect: mysqlDialect,
    cache: new CacheService(new MemoryCacheStore()),
    known: () => KNOWN,
  });
});

// --- module availability: the platform is absolute ---------------------------

test('a module with no decision recorded is available', async () => {
  assert.equal(await modules.isEnabledPlatformWide('catalog'), true);
  assert.equal(await modules.isEnabledForStore(STORE, 'catalog'), true);
});

test('disabling platform-wide removes it from every store', async () => {
  await modules.setPlatformState('inventory', false, 'Corrupting stock counts');

  assert.equal(await modules.isEnabledForStore(STORE, 'inventory'), false);
  assert.equal(await modules.isEnabledForStore(OTHER_STORE, 'inventory'), false);
  // Other modules are untouched — the switch is per module, not a mode.
  assert.equal(await modules.isEnabledForStore(STORE, 'catalog'), true);
});

test('a store cannot enable what the platform has disabled', async () => {
  await modules.setPlatformState('inventory', false, 'Corrupting stock counts');

  await assert.rejects(
    () => modules.setStoreState(STORE, 'inventory', true),
    /disabled platform-wide/,
  );
  assert.equal(await modules.isEnabledForStore(STORE, 'inventory'), false);
});

test('a store enabling it first does not survive a platform disable', async () => {
  await modules.setStoreState(STORE, 'inventory', true);
  assert.equal(await modules.isEnabledForStore(STORE, 'inventory'), true);

  await modules.setPlatformState('inventory', false, 'Incident 4021');

  // The store's row still says true; the platform's answer is what counts.
  assert.equal(await modules.isEnabledForStore(STORE, 'inventory'), false);
});

test('a store may turn off something the platform permits', async () => {
  await modules.setStoreState(STORE, 'content', false);

  assert.equal(await modules.isEnabledForStore(STORE, 'content'), false);
  // ...for that store only.
  assert.equal(await modules.isEnabledForStore(OTHER_STORE, 'content'), true);
});

test('re-enabling platform-wide restores stores that never opted out', async () => {
  await modules.setPlatformState('inventory', false, 'Incident 4021');
  await modules.setPlatformState('inventory', true);

  assert.equal(await modules.isEnabledForStore(STORE, 'inventory'), true);
});

test('availability names the level that said no', async () => {
  await modules.setPlatformState('inventory', false, 'Incident 4021');
  const platformBlocked = await modules.availability(STORE, 'inventory');
  assert.equal(platformBlocked.available, false);
  assert.equal(platformBlocked.blockedBy, 'platform');
  assert.match(platformBlocked.reason, /Incident 4021/);

  await modules.setStoreState(STORE, 'content', false);
  const storeBlocked = await modules.availability(STORE, 'content');
  assert.equal(storeBlocked.blockedBy, 'store');
});

test('disabling platform-wide requires a reason', async () => {
  await assert.rejects(() => modules.setPlatformState('catalog', false), /needs a reason/);
  await assert.rejects(() => modules.setPlatformState('catalog', false, '  '), /needs a reason/);
  // Enabling does not: there is nothing to explain.
  await assert.doesNotReject(() => modules.setPlatformState('catalog', true));
});

test('an unknown module is refused rather than recorded', async () => {
  await assert.rejects(() => modules.setPlatformState('nope', false, 'x'), /No module "nope"/);
  await assert.rejects(() => modules.setStoreState(STORE, 'nope', true), /No module "nope"/);
});

test('a platform decision takes effect immediately, not when a cache expires', async () => {
  // Warms the cache.
  assert.equal(await modules.isEnabledPlatformWide('catalog'), true);

  await modules.setPlatformState('catalog', false, 'Incident 4021');

  assert.equal(await modules.isEnabledPlatformWide('catalog'), false);
});

// --- settings: the store is authoritative ------------------------------------

const DEFAULTS = new Map([
  ['requestPrefix', 'RFQ-'],
  ['allowNegativeStock', true],
  ['weightUnit', 'kg'],
]);

const settingsWith = (env = {}) =>
  new SettingsService({ executor, dialect: mysqlDialect, defaults: () => DEFAULTS, env });

test('with nothing set, the declared default wins', async () => {
  const resolved = await settingsWith().get('requestPrefix', STORE);
  assert.equal(resolved.value, 'RFQ-');
  assert.equal(resolved.source, 'default');
});

test('the environment overrides the declared default', async () => {
  const settings = settingsWith({ [envNameFor('requestPrefix')]: 'QUOTE-' });
  const resolved = await settings.get('requestPrefix', STORE);

  assert.equal(resolved.value, 'QUOTE-');
  assert.equal(resolved.source, 'environment');
});

test('the platform overrides the environment', async () => {
  const settings = settingsWith({ [envNameFor('requestPrefix')]: 'QUOTE-' });
  await settings.setForPlatform('requestPrefix', 'PLAT-');

  const resolved = await settings.get('requestPrefix', STORE);
  assert.equal(resolved.value, 'PLAT-');
  assert.equal(resolved.source, 'platform');
});

test('the store overrides the platform — the opposite of module availability', async () => {
  const settings = settingsWith();
  await settings.setForPlatform('requestPrefix', 'PLAT-');
  await settings.setForStore(STORE, 'requestPrefix', 'MINE-');

  const resolved = await settings.get('requestPrefix', STORE);
  assert.equal(resolved.value, 'MINE-');
  assert.equal(resolved.source, 'store');
  // And it reports what it would fall back to, so a screen can offer "reset".
  assert.equal(resolved.inherited, 'PLAT-');
});

test('one store\'s choice does not leak into another', async () => {
  const settings = settingsWith();
  await settings.setForStore(STORE, 'requestPrefix', 'MINE-');

  assert.equal((await settings.get('requestPrefix', OTHER_STORE)).value, 'RFQ-');
});

test('clearing a store value inherits again rather than storing nothing', async () => {
  const settings = settingsWith();
  await settings.setForPlatform('requestPrefix', 'PLAT-');
  await settings.setForStore(STORE, 'requestPrefix', 'MINE-');

  await settings.clearForStore(STORE, 'requestPrefix');

  const resolved = await settings.get('requestPrefix', STORE);
  assert.equal(resolved.value, 'PLAT-');
  assert.equal(resolved.source, 'platform');
});

test('a stored false is a value, not an absence', async () => {
  const settings = settingsWith();
  await settings.setForStore(STORE, 'allowNegativeStock', false);

  const resolved = await settings.get('allowNegativeStock', STORE);
  assert.equal(resolved.value, false);
  assert.equal(resolved.source, 'store');
});

test('environment values arrive typed, not as strings', async () => {
  const settings = settingsWith({ [envNameFor('allowNegativeStock')]: 'false' });
  assert.equal((await settings.get('allowNegativeStock', STORE)).value, false);

  const plain = settingsWith({ [envNameFor('weightUnit')]: 'lb' });
  assert.equal((await plain.get('weightUnit', STORE)).value, 'lb');
});

test('a setting nothing declares is refused rather than written', async () => {
  const settings = settingsWith();
  await assert.rejects(() => settings.setForStore(STORE, 'madeUp', 1), /No module declares/);
  await assert.rejects(() => settings.setForPlatform('madeUp', 1), /No module declares/);
});

test('every declared setting is reported with where its value came from', async () => {
  const settings = settingsWith({ [envNameFor('weightUnit')]: 'lb' });
  await settings.setForPlatform('allowNegativeStock', false);
  await settings.setForStore(STORE, 'requestPrefix', 'MINE-');

  const all = await settings.all(STORE);
  const by = new Map(all.map((entry) => [entry.key, entry]));

  assert.equal(by.get('requestPrefix').source, 'store');
  assert.equal(by.get('allowNegativeStock').source, 'platform');
  assert.equal(by.get('weightUnit').source, 'environment');
  assert.equal(all.length, DEFAULTS.size);
});

test('the environment variable name is derived, not invented per setting', () => {
  assert.equal(envNameFor('requestPrefix'), 'DF_SETTING_REQUEST_PREFIX');
  assert.equal(envNameFor('allowNegativeStock'), 'DF_SETTING_ALLOW_NEGATIVE_STOCK');
});

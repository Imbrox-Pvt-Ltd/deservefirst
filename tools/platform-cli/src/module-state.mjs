/**
 * Platform CLI · module-state.mjs
 * `platform module:enable|disable` — the operator's switch from a terminal.
 *
 * Deliberately talks to the database rather than the API. This is the control
 * you reach for when a module is misbehaving badly enough that you would rather
 * not route a request through it, and a kill switch that depends on the thing
 * it is killing is not one.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** Module ids the build actually contains, so a typo cannot be recorded. */
function knownModules(root) {
  const ids = ['platform', 'auth'];
  const modulesDir = join(root, 'apps/api/dist/modules');
  if (existsSync(modulesDir)) ids.push(...readdirSync(modulesDir));
  return ids;
}

export async function setModuleState(root, { moduleId, enabled, reason, storeHandle, url }) {
  const distCore = join(root, 'apps/api/dist/core');
  if (!existsSync(distCore)) throw new Error('Build first — `pnpm -r run build`.');

  const known = knownModules(root);
  if (!known.includes(moduleId)) {
    throw new Error(`No module "${moduleId}". Known: ${known.join(', ')}`);
  }
  if (!enabled && !storeHandle && !reason) {
    throw new Error('Disabling platform-wide needs --reason="…".');
  }

  const databaseUrl = url ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL (or pass --url=).');

  const { createMysqlPool } = require(join(distCore, 'database/mysql-executor.js'));
  const pool = await createMysqlPool(databaseUrl);

  try {
    if (storeHandle) {
      const [stores] = await pool.query('SELECT `id` FROM `stores` WHERE `handle` = ? LIMIT 1', [
        storeHandle,
      ]);
      const storeId = stores[0]?.id ?? storeHandle;

      await pool.query(
        'DELETE FROM `store_module_states` WHERE `store_id` = ? AND `handle` = ?',
        [storeId, moduleId],
      );
      await pool.query(
        'INSERT INTO `store_module_states` (`id`,`store_id`,`handle`,`module_id`,`enabled`,`version`) VALUES (?,?,?,?,?,1)',
        [randomUUID(), storeId, moduleId, moduleId, enabled ? 1 : 0],
      );
      return { scope: `store ${storeHandle}`, moduleId, enabled };
    }

    await pool.query('DELETE FROM `platform_module_states` WHERE `handle` = ?', [moduleId]);
    await pool.query(
      'INSERT INTO `platform_module_states` (`id`,`handle`,`module_id`,`enabled`,`reason`,`version`) VALUES (?,?,?,?,?,1)',
      [randomUUID(), moduleId, moduleId, enabled ? 1 : 0, reason ?? null],
    );
    return { scope: 'every store', moduleId, enabled, reason };
  } finally {
    await pool.end();
  }
}

export async function listModuleStates(root, { url } = {}) {
  const distCore = join(root, 'apps/api/dist/core');
  const databaseUrl = url ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL (or pass --url=).');

  const { createMysqlPool } = require(join(distCore, 'database/mysql-executor.js'));
  const pool = await createMysqlPool(databaseUrl);

  try {
    const [rows] = await pool.query(
      'SELECT `handle`, `enabled`, `reason` FROM `platform_module_states` WHERE `deleted_at` IS NULL',
    );
    const decided = new Map(rows.map((row) => [row.handle, row]));

    // A module with no row has had no decision made about it, which resolves to
    // available — shown as "default on" rather than silently omitted.
    return knownModules(root).map((moduleId) => {
      const row = decided.get(moduleId);
      return {
        moduleId,
        enabled: row ? Boolean(row.enabled) : true,
        decided: Boolean(row),
        reason: row?.reason ?? null,
      };
    });
  } finally {
    await pool.end();
  }
}

/**
 * Platform CLI · db-sync.mjs
 * Applies the schema derived from every module's manifest (§35.1). The author
 * declares an entity; this creates its table, the toolkit's satellite tables and
 * the indexes every store-scoped table must have.
 *
 * DEVELOPMENT ONLY. Production uses `platform migrate` — versioned, ordered,
 * recorded, expand → migrate → contract (§17.2).
 *
 * The difference is not convenience, it is capability: this command derives the
 * schema from the manifests and applies it additively, which cannot express a
 * CHANGE. Renaming a column, altering a type, backfilling data — none of those
 * are "create if not exists", and all of them need to happen once, in a known
 * order, with a record that they did.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { manifestsOf, syntheticResource } from './manifests.mjs';

const require = createRequire(import.meta.url);

export async function dbSync(root, options = {}) {
  const distCore = join(root, 'apps/api/dist/core');
  if (!existsSync(distCore)) {
    throw new Error('Build first — `pnpm --filter @deservefirst/api run build`.');
  }

  const { dialectFor } = require(join(distCore, 'list-engine/dialect.js'));
  const { buildEntityDdl, buildToolkitDdl } = require(join(distCore, 'database/schema-builder.js'));
  const { createMysqlPool } = require(join(distCore, 'database/mysql-executor.js'));

  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (or pass --url).');

  const dialectName = url.startsWith('postgres') ? 'postgres' : 'mysql';
  const dialect = dialectFor(dialectName);

  // Discovered from the built module tree — the same source the runtime reads,
  // so the schema cannot drift from what the platform loads.
  const manifests = manifestsOf(root);

  const statements = [];
  for (const manifest of manifests) {
    for (const entity of manifest.entities ?? []) {
      // An entity with an admin resource takes its columns from it; one without
      // declares them itself. Skipping the latter silently left sessions,
      // memberships and roles with no table at all.
      const resource =
        (manifest.resources ?? []).find((item) => item.entity === entity.name) ??
        syntheticResource(entity);

      const main = buildEntityDdl(dialect, entity, resource);
      statements.push(main);
      statements.push(...buildToolkitDdl(dialect, entity));
    }
  }

  if (statements.length === 0) {
    return { applied: 0, tables: [], dialect: dialectName };
  }

  if (dialectName !== 'mysql') {
    throw new Error('db:sync currently applies only to MySQL/MariaDB; use migrations for Postgres.');
  }

  const pool = await createMysqlPool(url);
  const tables = [];
  const addedColumns = [];
  let applied = 0;

  try {
    for (const ddl of statements) {
      await pool.query(ddl.createTable);
      tables.push(ddl.table);
      applied += 1;

      // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists,
      // so declaring a new field used to change nothing at all — the failure
      // surfaced later as "unknown column" on the first write. Missing columns
      // are added; existing ones are never altered or dropped, because a type
      // change needs an expand → migrate → contract migration (§17.2), not a
      // convenience command.
      for (const column of await missingColumns(pool, ddl)) {
        await pool.query(`ALTER TABLE \`${ddl.table}\` ADD COLUMN ${column.definition}`);
        addedColumns.push(`${ddl.table}.${column.name}`);
        applied += 1;
      }

      for (const index of ddl.indexes) {
        try {
          await pool.query(index.sql);
          applied += 1;
        } catch (error) {
          // Re-running db:sync must be safe; MySQL has no
          // CREATE INDEX IF NOT EXISTS, so an existing index is expected.
          if (!/Duplicate key name/i.test(String(error?.message ?? ''))) throw error;
        }
      }
    }
  } finally {
    await pool.end();
  }

  return { applied, tables, addedColumns, dialect: dialectName };
}

/**
 * Declared columns the live table does not have.
 *
 * Compared by name only. A column whose TYPE has changed is deliberately left
 * alone: narrowing one silently truncates data, and choosing whether that is
 * acceptable is a migration decision, not something a development helper should
 * make on someone's behalf.
 */
async function missingColumns(pool, ddl) {
  if (!ddl.columns || ddl.columns.length === 0) return [];

  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${ddl.table}\``);
  const present = new Set(rows.map((row) => String(row.Field)));
  return ddl.columns.filter((column) => !present.has(column.name));
}

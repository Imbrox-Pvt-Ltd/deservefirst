/**
 * Platform CLI · db-sync.mjs
 * Applies the schema derived from every module's manifest (§35.1). The author
 * declares an entity; this creates its table, the toolkit's satellite tables and
 * the indexes every store-scoped table must have.
 *
 * Development convenience only. Production uses versioned, expand → migrate →
 * contract migrations (§17.2); this command is deliberately additive
 * (CREATE TABLE IF NOT EXISTS) and never drops or alters anything.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** A resource-shaped wrapper around an entity that declares its own fields. */
function syntheticResource(entity) {
  return {
    name: entity.name,
    entity: entity.name,
    pluralName: `${entity.name}s`,
    urlSegment: entity.tableName,
    fields: entity.fields ?? [],
    api: { graphql: false, rest: false, visibility: 'internal' },
    screens: [],
    permissions: { read: 'internal', write: 'internal' },
  };
}

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

  // Discover manifests from the built module tree — the same source the runtime
  // reads, so the schema cannot drift from what the platform loads.
  const manifests = [];

  // Auth is a first-class sibling of modules/ (§3), so it is discovered
  // explicitly rather than by scanning the module tree.
  const authManifestPath = join(root, 'apps/api/dist/auth/auth.manifest.js');
  if (existsSync(authManifestPath)) {
    const loaded = require(authManifestPath);
    const manifest = loaded.default ?? loaded.authManifest;
    if (manifest) manifests.push(manifest);
  }

  const modulesDir = join(root, 'apps/api/dist/modules');
  if (existsSync(modulesDir)) {
    const { readdirSync } = await import('node:fs');
    for (const moduleName of readdirSync(modulesDir)) {
      const manifestPath = join(modulesDir, moduleName, `${moduleName}.manifest.js`);
      if (existsSync(manifestPath)) {
        const loaded = require(manifestPath);
        const manifest = loaded.default ?? loaded[`${moduleName}Manifest`];
        if (manifest) manifests.push(manifest);
      }
    }
  }

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
  let applied = 0;

  try {
    for (const ddl of statements) {
      await pool.query(ddl.createTable);
      tables.push(ddl.table);
      applied += 1;

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

  return { applied, tables, dialect: dialectName };
}

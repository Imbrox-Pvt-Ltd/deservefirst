/**
 * Platform CLI · migrate.mjs
 * Versioned, ordered schema migrations — the production path (§17.2).
 *
 * `db:sync` derives the schema from the manifests and applies it additively.
 * That is right for development and wrong for production, because it cannot
 * express the one thing production needs: a CHANGE. Renaming a column, changing
 * a type, backfilling data — none of those are "create if not exists", and all
 * of them need to happen in a known order, once, with a record that they did.
 *
 * Three guarantees, and the third is the one people skip:
 *
 *   1. Ordered   — filenames carry a version; they run in that order.
 *   2. Once      — a ledger records what ran, so re-running is safe.
 *   3. Immutable — every applied file's checksum is stored and re-verified.
 *
 * The third catches editing a migration that has already run somewhere. It is
 * the classic way to end up with two databases that both claim to be at version
 * 12 and disagree about what that means, and it is silent without a checksum.
 *
 * Generation is deliberately ADDITIVE ONLY. A generator that emits DROP COLUMN
 * from a manifest diff will eventually emit it for a field somebody merely
 * renamed, and the data is gone before anyone reads the file. Expand and migrate
 * can be generated; contract is written by a human who has decided.
 * Layer: tooling.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export const MIGRATIONS_DIR = 'migrations';
const LEDGER = 'schema_migrations';

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS \`${LEDGER}\` (
  \`version\` VARCHAR(32) NOT NULL,
  \`name\` VARCHAR(255) NOT NULL,
  \`checksum\` CHAR(64) NOT NULL,
  \`applied_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`version\`)
)`;

const checksumOf = (sql) => createHash('sha256').update(sql).digest('hex');

/** `0003_add_option_names.sql` → `{ version: '0003', name: 'add option names' }`. */
function parseFilename(filename) {
  const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(filename);
  if (!match) return null;
  return { version: match[1], name: match[2].replace(/_/g, ' '), filename };
}

export function readMigrations(root) {
  const dir = join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .map(parseFilename)
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version))
    .map((entry) => {
      const sql = readFileSync(join(dir, entry.filename), 'utf8');
      return { ...entry, sql, checksum: checksumOf(sql) };
    });
}

/**
 * Splits a file into statements.
 *
 * Migrations are DDL and simple DML, so splitting on a semicolon at end of line
 * is enough — and being strict about the position keeps a semicolon inside a
 * string literal from tearing a statement in half.
 */
function statementsOf(sql) {
  return sql
    .split(/;\s*$/m)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

async function connect(root, url) {
  const distCore = join(root, 'apps/api/dist/core');
  if (!existsSync(distCore)) throw new Error('Build first — `pnpm -r run build`.');

  const databaseUrl = url ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL (or pass --url=).');

  const { createMysqlPool } = require(join(distCore, 'database/mysql-executor.js'));
  const pool = await createMysqlPool(databaseUrl);
  await pool.query(LEDGER_DDL);
  return pool;
}

async function appliedRows(pool) {
  const [rows] = await pool.query(
    `SELECT \`version\`, \`name\`, \`checksum\`, \`applied_at\` FROM \`${LEDGER}\` ORDER BY \`version\``,
  );
  return rows;
}

export async function migrateStatus(root, { url } = {}) {
  const pool = await connect(root, url);
  try {
    const applied = new Map((await appliedRows(pool)).map((row) => [row.version, row]));
    const files = readMigrations(root);

    const entries = files.map((file) => {
      const record = applied.get(file.version);
      if (!record) return { ...file, state: 'pending' };
      // An applied migration whose file has since changed is the dangerous case:
      // two databases at "version 12" that mean different things.
      return record.checksum === file.checksum
        ? { ...file, state: 'applied', appliedAt: record.applied_at }
        : { ...file, state: 'changed', appliedAt: record.applied_at };
    });

    // A ledger row with no file is equally wrong — usually a branch switch.
    for (const [version, record] of applied) {
      if (!files.some((file) => file.version === version)) {
        entries.push({ version, name: record.name, state: 'missing', appliedAt: record.applied_at });
      }
    }

    return entries.sort((a, b) => a.version.localeCompare(b.version));
  } finally {
    await pool.end();
  }
}

export async function migrate(root, { url, dryRun = false } = {}) {
  const status = await migrateStatus(root, { url });

  const changed = status.filter((entry) => entry.state === 'changed');
  if (changed.length > 0) {
    throw new Error(
      `Already-applied migration(s) have been edited: ${changed
        .map((entry) => entry.version)
        .join(', ')}. Add a new migration instead — history is not editable.`,
    );
  }

  const missing = status.filter((entry) => entry.state === 'missing');
  if (missing.length > 0) {
    throw new Error(
      `The database has migration(s) this checkout does not: ${missing
        .map((entry) => entry.version)
        .join(', ')}. Wrong branch, or the file was deleted.`,
    );
  }

  const pending = status.filter((entry) => entry.state === 'pending');
  if (pending.length === 0 || dryRun) {
    return { applied: [], pending: pending.map((entry) => entry.version), dryRun };
  }

  const pool = await connect(root, url);
  const done = [];

  try {
    for (const entry of pending) {
      // Each migration is its own transaction where the engine allows it. MySQL
      // commits DDL implicitly, so this bounds the damage rather than preventing
      // it — which is why generated migrations are additive.
      const connection = await pool.getConnection();
      const statements = statementsOf(entry.sql);
      let reached = 0;

      try {
        await connection.beginTransaction();
        for (const [index, statement] of statements.entries()) {
          reached = index;
          await connection.query(statement);
        }
        await connection.query(
          `INSERT INTO \`${LEDGER}\` (\`version\`, \`name\`, \`checksum\`) VALUES (?, ?, ?)`,
          [entry.version, entry.name, entry.checksum],
        );
        await connection.commit();
        done.push(entry.version);
      } catch (error) {
        await connection.rollback();

        // MySQL commits DDL implicitly, so the rollback above cannot undo the
        // statements that already ran. Saying exactly how far it got turns a
        // confusing half-applied database into something an operator can act
        // on — the alternative is a re-run that fails on "duplicate column"
        // and gives no hint why.
        const partial =
          reached > 0
            ? ` Statements 1–${reached} of ${statements.length} already ran and are NOT recorded ` +
              `(DDL does not roll back). Make the file re-runnable from the start, or finish it by hand and ` +
              `\`platform migrate:mark ${entry.version}\`.`
            : '';

        throw new Error(
          `${entry.filename} failed at statement ${reached + 1} of ${statements.length}: ${error.message}.${partial}`,
        );
      } finally {
        connection.release();
      }
    }
  } finally {
    await pool.end();
  }

  return { applied: done, pending: [], dryRun: false };
}

/**
 * Records a migration as applied without running it.
 *
 * The case this exists for is adopting a database that already has the schema —
 * every environment built with `db:sync` before migrations existed. The
 * alternative is running a baseline against tables that are already there and
 * reading through a wall of "duplicate key name" to see whether it worked.
 */
export async function markApplied(root, version, { url } = {}) {
  const file = readMigrations(root).find((entry) => entry.version === version);
  if (!file) throw new Error(`No migration ${version} in ${MIGRATIONS_DIR}/.`);

  const pool = await connect(root, url);
  try {
    const applied = await appliedRows(pool);
    if (applied.some((row) => row.version === version)) {
      return { version, alreadyRecorded: true };
    }

    await pool.query(
      `INSERT INTO \`${LEDGER}\` (\`version\`, \`name\`, \`checksum\`) VALUES (?, ?, ?)`,
      [file.version, file.name, file.checksum],
    );
    return { version, alreadyRecorded: false };
  } finally {
    await pool.end();
  }
}

/** The next free version number, zero-padded so files sort correctly. */
function nextVersion(root) {
  const existing = readMigrations(root);
  const highest = existing.length === 0 ? 0 : Number(existing.at(-1).version);
  return String(highest + 1).padStart(4, '0');
}

export function createMigration(root, name, body) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('A migration needs a name, e.g. `platform migrate:new add_variants`.');

  const version = nextVersion(root);
  const filename = `${version}_${slug}.sql`;
  const dir = join(root, MIGRATIONS_DIR);
  mkdirSync(dir, { recursive: true });

  const header = `-- ${version} · ${name}
--
-- Applied once, in order, and never edited afterwards: the runner stores this
-- file's checksum and refuses to continue if it changes.
--
-- Destructive changes (DROP, MODIFY, RENAME) belong here, written deliberately,
-- and follow expand → migrate → contract (§17.2): add the new shape, move the
-- data while both exist, and remove the old one in a LATER migration once
-- nothing reads it.

`;

  writeFileSync(join(dir, filename), header + (body ?? '') , 'utf8');
  return { version, filename, path: `${MIGRATIONS_DIR}/${filename}` };
}

/**
 * Writes a migration for everything the manifests declare and the database does
 * not yet have.
 *
 * Additive only, and that is a design decision rather than a limitation. A
 * generator that emitted DROP COLUMN from a manifest diff would eventually emit
 * it for a field somebody had merely renamed, and the data would be gone before
 * anybody read the file.
 */
export async function generateMigration(root, { url, name } = {}) {
  const distCore = join(root, 'apps/api/dist/core');
  const { dialectFor } = require(join(distCore, 'list-engine/dialect.js'));
  const { buildEntityDdl, buildToolkitDdl } = require(join(distCore, 'database/schema-builder.js'));

  const dialect = dialectFor('mysql');
  const { manifestsOf, syntheticResource } = await import('./manifests.mjs');

  const pool = await connect(root, url);
  const statements = [];

  try {
    const [tableRows] = await pool.query('SHOW TABLES');
    const existing = new Set(tableRows.map((row) => String(Object.values(row)[0])));

    const ddls = [];
    for (const manifest of manifestsOf(root)) {
      for (const entity of manifest.entities ?? []) {
        const resource =
          (manifest.resources ?? []).find((item) => item.entity === entity.name) ??
          syntheticResource(entity);
        ddls.push(buildEntityDdl(dialect, entity, resource), ...buildToolkitDdl(dialect, entity));
      }
    }

    for (const ddl of ddls) {
      if (!existing.has(ddl.table)) {
        statements.push(`${ddl.createTable};`);
        for (const index of ddl.indexes) statements.push(`${index.sql};`);
        continue;
      }

      const [columnRows] = await pool.query(`SHOW COLUMNS FROM \`${ddl.table}\``);
      const present = new Set(columnRows.map((row) => String(row.Field)));
      for (const column of ddl.columns ?? []) {
        if (present.has(column.name)) continue;
        statements.push(`ALTER TABLE \`${ddl.table}\` ADD COLUMN ${column.definition};`);
      }
    }
  } finally {
    await pool.end();
  }

  if (statements.length === 0) return { statements: 0 };

  const created = createMigration(root, name ?? 'sync_manifests', `${statements.join('\n')}\n`);
  return { ...created, statements: statements.length };
}

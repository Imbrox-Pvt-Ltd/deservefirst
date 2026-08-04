/**
 * Platform CLI · timestamps.mjs
 * Finding rows written before the connection was pinned to UTC.
 *
 * The driver writes and reads every Date as UTC, but columns defaulted to
 * CURRENT_TIMESTAMP are filled in by the SERVER, in the server's own zone. On
 * any host that is not UTC those two disagreed by the offset, and keyset
 * pagination compares exactly those two kinds of value — so a page boundary
 * could skip or repeat rows. The connection is pinned now; rows written before
 * that are still wrong.
 *
 * This reports and does not repair. The repair is a rewrite of historical data
 * whose correct offset cannot be recovered from the data itself — it depends on
 * what the server's zone was at the time, which nothing recorded. Guessing it
 * is worse than leaving it, so the decision is a person's.
 * Layer: tooling.
 */

/**
 * How a stale row is recognised.
 *
 * A timestamp written in a zone AHEAD of UTC reads as being in the future. That
 * is a reliable signal here and a poor one in general: it cannot see rows from
 * a host BEHIND UTC, and it stops working once enough time passes that the
 * offset no longer puts them ahead of now. Both limits are stated in the output
 * rather than hidden, because a number presented without them invites being
 * read as "and the rest are fine".
 */
const AHEAD_OF_NOW = 'created_at > UTC_TIMESTAMP(3)';

/** Opens a connection the same way db:sync does, runs the report, closes it. */
export async function reportTimestamps(root, options = {}) {
  const { createRequire } = await import('node:module');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const require = createRequire(import.meta.url);

  const distCore = join(root, 'apps/api/dist/core');
  if (!existsSync(distCore)) {
    throw new Error('Build first — `pnpm --filter @deservefirst/api run build`.');
  }

  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (or pass --url).');
  if (url.startsWith('postgres')) {
    throw new Error('This check is MySQL-specific; Postgres stores timestamps with a zone.');
  }

  const { createMysqlPool } = require(join(distCore, 'database/mysql-executor.js'));
  const pool = await createMysqlPool(url);

  const executor = {
    async query(sql, parameters) {
      const [rows] = await pool.query(sql, parameters);
      return rows;
    },
  };

  try {
    return await inspectTimestamps(executor, { quote: (name) => `\`${name}\`` });
  } finally {
    await pool.end();
  }
}

export async function inspectTimestamps(executor, { quote }) {
  const tables = await executor.query(
    `SELECT DISTINCT TABLE_NAME AS name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'created_at'
      ORDER BY TABLE_NAME`,
    [],
  );

  const findings = [];
  let total = 0;
  let suspect = 0;

  for (const { name } of tables) {
    const [row] = await executor.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ${AHEAD_OF_NOW} THEN 1 ELSE 0 END) AS suspect,
              MAX(created_at) AS latest
         FROM ${quote(name)}`,
      [],
    );

    const rows = Number(row?.total ?? 0);
    const bad = Number(row?.suspect ?? 0);
    total += rows;
    suspect += bad;
    if (bad > 0) findings.push({ table: name, rows, suspect: bad, latest: row?.latest ?? null });
  }

  return { findings, total, suspect, tables: tables.length };
}

export function formatTimestampReport({ findings, total, suspect, tables }) {
  const lines = [];

  if (suspect === 0) {
    lines.push(`No rows carry a pre-fix timestamp (${total} rows across ${tables} tables).`);
    return lines.join('\n');
  }

  lines.push(`${suspect} of ${total} rows carry a timestamp written before the UTC fix.`);
  lines.push('');
  for (const finding of findings) {
    lines.push(`  ${finding.table.padEnd(34)} ${String(finding.suspect).padStart(5)} of ${finding.rows}`);
  }
  lines.push('');
  lines.push('These sort ahead of anything written since, so a list ordered by');
  lines.push('created_at shows them first and keyset pagination can skip a page');
  lines.push('boundary between the two kinds.');
  lines.push('');
  lines.push('Nothing has been changed. Two ways forward, both yours to pick:');
  lines.push('');
  lines.push('  `platform seed`   recreates the seed data correctly. It also deletes');
  lines.push('                    anything created by hand in the seeded stores.');
  lines.push('');
  lines.push('  leave it          the rows are dev data; production has never run');
  lines.push('                    with the old connection settings.');
  lines.push('');
  lines.push('This detects rows written in a zone AHEAD of UTC, and only while the');
  lines.push('offset still puts them in the future. It cannot see rows from a host');
  lines.push('behind UTC, so treat the count as a floor rather than a total.');

  return lines.join('\n');
}

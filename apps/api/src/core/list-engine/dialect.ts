/**
 * Core · list-engine/dialect.ts
 * SQL dialect abstraction. The platform targets Postgres (ADR 0001 D7); MySQL /
 * MariaDB is a supported interim so development can proceed against the
 * available database. Everything dialect-specific lives here so the move back to
 * Postgres is a config change rather than a rewrite.
 *
 * IMPORTANT: dialects are not equivalent on security. Postgres enforces the
 * tenant boundary in the database through row-level security; MySQL has no such
 * mechanism, so on MySQL the boundary is enforced by the query guard in
 * core/tenant-context/query-guard.ts instead. See docs/adr/0002.
 * Layer: core.
 */

export type SqlDialectName = 'postgres' | 'mysql';

export interface SqlDialect {
  readonly name: SqlDialectName;
  /** True when the database itself can enforce tenant isolation. */
  readonly enforcesRowLevelSecurity: boolean;
  /** Renders the placeholder for the nth bound parameter (1-based). */
  placeholder(index: number): string;
  quoteIdentifier(name: string): string;
  /** Case-insensitive containment match. */
  caseInsensitiveLike(column: string, placeholder: string): string;
  /** Case-insensitive equality. */
  caseInsensitiveEquals(column: string, placeholder: string): string;
  countExpression(): string;
}

export const postgresDialect: SqlDialect = {
  name: 'postgres',
  enforcesRowLevelSecurity: true,
  placeholder: (index) => `$${index}`,
  quoteIdentifier: (name) => `"${name}"`,
  caseInsensitiveLike: (column, placeholder) => `${column} ILIKE ${placeholder}`,
  caseInsensitiveEquals: (column, placeholder) => `lower(${column}) = lower(${placeholder})`,
  countExpression: () => 'COUNT(*)::int',
};

export const mysqlDialect: SqlDialect = {
  name: 'mysql',
  enforcesRowLevelSecurity: false,
  placeholder: () => '?',
  quoteIdentifier: (name) => `\`${name}\``,
  /**
   * The default utf8mb4_general_ci collation is already case-insensitive, so a
   * plain comparison is both correct AND index-usable here. Wrapping the column
   * in lower() would silently disable every index on it.
   */
  caseInsensitiveLike: (column, placeholder) => `${column} LIKE ${placeholder}`,
  caseInsensitiveEquals: (column, placeholder) => `${column} = ${placeholder}`,
  countExpression: () => 'COUNT(*)',
};

const DIALECTS: Record<SqlDialectName, SqlDialect> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
};

export function dialectFor(name: SqlDialectName): SqlDialect {
  const dialect = DIALECTS[name];
  if (!dialect) throw new Error(`Unsupported SQL dialect "${name}"`);
  return dialect;
}

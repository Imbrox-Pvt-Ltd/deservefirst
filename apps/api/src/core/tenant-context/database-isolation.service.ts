/**
 * Core · tenant-context/database-isolation.service.ts
 * Startup validation that the isolation guarantee actually holds: the database
 * role must not be able to bypass RLS, and every store-scoped table must have
 * row security enabled with at least one policy. Refusing to boot is the correct
 * response — a platform that starts without isolation is worse than one that
 * does not start (§20.1).
 *
 * Ported from the donor codebase; generalised so the table list comes from the
 * module registry rather than a hardcoded array, which is what stops it drifting
 * as modules are added.
 * Layer: core/infrastructure (type-only dependency on TypeORM).
 */

import type { DataSource } from 'typeorm';

import { isPostgresDataSource } from './postgres-rls-context';

export interface IsolationReadiness {
  readonly ok: boolean;
  readonly currentUser: string;
  /** True means the role can read every tenant's rows — a hard failure. */
  readonly roleCanBypassRls: boolean;
  readonly missingTables: readonly string[];
  readonly tablesWithoutRowSecurity: readonly string[];
  readonly tablesWithoutPolicies: readonly string[];
  readonly tableCount: number;
}

interface RoleRow {
  current_user: string;
  can_bypass_rls: boolean;
}

interface TableRow {
  table_name: string;
  row_security_enabled: boolean;
}

interface PolicyRow {
  table_name: string;
  policy_count: number;
}

export class DatabaseIsolationService {
  constructor(
    private readonly dataSource: DataSource,
    /**
     * Every store-scoped table, collected from the manifests of the loaded
     * modules. Passing it in keeps this service honest as the platform grows.
     */
    private readonly storeScopedTables: readonly string[],
  ) {}

  async validate(): Promise<IsolationReadiness> {
    if (!isPostgresDataSource(this.dataSource)) {
      throw new Error(
        'Tenant isolation requires Postgres — row-level security is the guarantee, ' +
          'and a driver without it is a hole rather than a fallback (decision D7).',
      );
    }

    const tables = [...this.storeScopedTables];
    if (tables.length === 0) {
      return {
        ok: true,
        currentUser: '',
        roleCanBypassRls: false,
        missingTables: [],
        tablesWithoutRowSecurity: [],
        tablesWithoutPolicies: [],
        tableCount: 0,
      };
    }

    const [roleRows, tableRows, policyRows] = (await Promise.all([
      this.dataSource.query(`
        SELECT current_user AS current_user,
               COALESCE(
                 (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user),
                 false
               ) AS can_bypass_rls
      `),
      this.dataSource.query(
        `
        SELECT c.relname AS table_name,
               c.relrowsecurity AS row_security_enabled
        FROM pg_class c
        INNER JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
      `,
        [tables],
      ),
      this.dataSource.query(
        `
        SELECT tablename AS table_name,
               COUNT(*)::int AS policy_count
        FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename = ANY($1::text[])
        GROUP BY tablename
      `,
        [tables],
      ),
    ])) as [RoleRow[], TableRow[], PolicyRow[]];

    const currentUser = roleRows[0]?.current_user ?? '';
    const roleCanBypassRls = Boolean(roleRows[0]?.can_bypass_rls);

    const byName = new Map(tableRows.map((row) => [row.table_name, row]));
    const policyCounts = new Map(policyRows.map((row) => [row.table_name, Number(row.policy_count ?? 0)]));

    const missingTables = tables.filter((name) => !byName.has(name));
    const tablesWithoutRowSecurity = tables.filter(
      (name) => byName.has(name) && !byName.get(name)?.row_security_enabled,
    );
    const tablesWithoutPolicies = tables.filter(
      (name) => byName.has(name) && (policyCounts.get(name) ?? 0) < 1,
    );

    return {
      ok:
        !roleCanBypassRls &&
        missingTables.length === 0 &&
        tablesWithoutRowSecurity.length === 0 &&
        tablesWithoutPolicies.length === 0,
      currentUser,
      roleCanBypassRls,
      missingTables,
      tablesWithoutRowSecurity,
      tablesWithoutPolicies,
      tableCount: tables.length,
    };
  }

  /** Called during startup validation; throws with an actionable message. */
  async assertReady(): Promise<void> {
    const readiness = await this.validate();
    if (readiness.ok) return;

    const problems: string[] = [];
    if (readiness.roleCanBypassRls) {
      problems.push(
        `database role "${readiness.currentUser}" has BYPASSRLS — it can read every tenant's data. ` +
          'Revoke it: ALTER ROLE ... NOBYPASSRLS.',
      );
    }
    if (readiness.missingTables.length) {
      problems.push(`tables declared store-scoped but absent: ${readiness.missingTables.join(', ')}`);
    }
    if (readiness.tablesWithoutRowSecurity.length) {
      problems.push(
        `tables without row security enabled: ${readiness.tablesWithoutRowSecurity.join(', ')}`,
      );
    }
    if (readiness.tablesWithoutPolicies.length) {
      problems.push(`tables with row security but no policy: ${readiness.tablesWithoutPolicies.join(', ')}`);
    }

    throw new Error(
      'Refusing to start — tenant isolation is not in place:\n' +
        problems.map((problem) => `  · ${problem}`).join('\n'),
    );
  }
}

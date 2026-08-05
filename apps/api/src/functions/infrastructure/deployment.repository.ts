/**
 * Functions · infrastructure/deployment.repository.ts
 * Storage for deployed functions.
 * Layer: infrastructure.
 */

import type { QueryExecutor } from '../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../core/list-engine/dialect';
import type { FunctionDeployment } from '../application/registry';

interface DeploymentRow extends Record<string, unknown> {
  id: string;
  app_id: string;
  point: string;
  name: string;
  wasm_base64: string;
  timeout_ms: number;
  memory_pages: number;
  status: string;
  disabled_reason: string | null;
}

export class SqlDeploymentRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private toDomain(row: DeploymentRow): FunctionDeployment {
    return {
      id: row.id,
      appId: row.app_id,
      point: row.point,
      name: row.name,
      wasmBase64: row.wasm_base64,
      timeoutMs: Number(row.timeout_ms),
      memoryPages: Number(row.memory_pages),
      status: row.status as FunctionDeployment['status'],
      disabledReason: row.disabled_reason,
    };
  }

  async forPoint(point: string): Promise<readonly FunctionDeployment[]> {
    const rows = await this.executor.query<DeploymentRow>(
      `SELECT * FROM ${this.q('function_deployments')}
        WHERE ${this.q('point')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('created_at')} ASC`,
      [point],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async forApp(appId: string): Promise<readonly FunctionDeployment[]> {
    const rows = await this.executor.query<DeploymentRow>(
      `SELECT * FROM ${this.q('function_deployments')}
        WHERE ${this.q('app_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('created_at')} DESC`,
      [appId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async insert(deployment: FunctionDeployment): Promise<void> {
    const columns = [
      'id', 'handle', 'app_id', 'point', 'name', 'wasm_base64',
      'timeout_ms', 'memory_pages', 'status', 'disabled_reason',
    ];
    await this.executor.query(
      `INSERT INTO ${this.q('function_deployments')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, index) => this.p(index + 1)).join(', ')})`,
      [
        deployment.id, deployment.id, deployment.appId, deployment.point, deployment.name,
        deployment.wasmBase64, deployment.timeoutMs, deployment.memoryPages,
        deployment.status, deployment.disabledReason,
      ],
    );
  }

  async save(deployment: FunctionDeployment): Promise<void> {
    const writable = this.executor as unknown as {
      execute?: (sql: string, parameters: readonly unknown[]) => Promise<{ affectedRows: number }>;
    };
    const sql = `UPDATE ${this.q('function_deployments')} SET
         ${this.q('status')} = ${this.p(1)},
         ${this.q('disabled_reason')} = ${this.p(2)}
       WHERE ${this.q('id')} = ${this.p(3)}`;
    const parameters = [deployment.status, deployment.disabledReason, deployment.id];

    if (this.dialect.name === 'postgres') {
      await this.executor.query(sql, parameters);
      return;
    }
    await writable.execute?.(sql, parameters);
  }
}

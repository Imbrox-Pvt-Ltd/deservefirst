/**
 * Core · database/index.ts
 * Database access: the dialect-aware schema builder and the executors. Postgres
 * is the target (ADR 0001 D7); MySQL is the supported interim (ADR 0002).
 * Layer: core/infrastructure.
 */

export * from './aggregate-repository';
export * from './mysql-executor';
export * from './schema-builder';

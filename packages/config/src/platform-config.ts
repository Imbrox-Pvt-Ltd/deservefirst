/**
 * Config · platform-config.ts
 * Platform-wide runtime configuration schema and loader. Every adapter choice
 * (§5.5) and scale lever (§7) is selected here, so swapping an implementation is
 * configuration rather than a call-site change.
 * Layer: config (no framework; reads process.env only).
 */

export type DatabaseDriver = 'postgres';

export interface PlatformConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly database: {
    /**
     * Postgres only in production (decision D7). Row-level security is the
     * isolation guarantee; a driver without RLS would be a hole, not a fallback.
     */
    readonly driver: DatabaseDriver;
    readonly url: string;
    /** Shard directory is resolved at runtime; a single shard is Stage 1 (§11.3). */
    readonly shardCount: number;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly adapters: {
    readonly storage: 'local' | 's3';
    readonly email: 'log' | 'smtp' | 'ses';
    readonly queue: 'memory' | 'bullmq';
    readonly search: 'postgres' | 'opensearch';
    readonly auth: 'internal' | 'managed';
  };
  readonly observability: {
    readonly serviceName: string;
    readonly otlpEndpoint?: string;
  };
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export function loadPlatformConfig(): PlatformConfig {
  const env = (process.env.NODE_ENV ?? 'development') as PlatformConfig['env'];

  return {
    env,
    database: {
      driver: 'postgres',
      url: required('DATABASE_URL', 'postgres://localhost:5432/deservefirst'),
      shardCount: integer('DATABASE_SHARD_COUNT', 1),
    },
    redis: {
      url: required('REDIS_URL', 'redis://localhost:6379'),
    },
    adapters: {
      storage: (process.env.STORAGE_ADAPTER ?? 'local') as PlatformConfig['adapters']['storage'],
      email: (process.env.EMAIL_ADAPTER ?? 'log') as PlatformConfig['adapters']['email'],
      queue: (process.env.QUEUE_ADAPTER ?? 'memory') as PlatformConfig['adapters']['queue'],
      search: (process.env.SEARCH_ADAPTER ?? 'postgres') as PlatformConfig['adapters']['search'],
      auth: (process.env.AUTH_ADAPTER ?? 'internal') as PlatformConfig['adapters']['auth'],
    },
    observability: {
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'deservefirst-api',
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
  };
}

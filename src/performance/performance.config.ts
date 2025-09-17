export interface PerformanceConfig {
  // Caching Configuration
  cache: {
    enabled: boolean;
    defaultTtl: number; // seconds
    maxSize: number; // items
    strategies: {
      redis: {
        enabled: boolean;
        host: string;
        port: number;
        password?: string;
        db: number;
        keyPrefix: string;
        ttl: number;
      };
      memory: {
        enabled: boolean;
        maxSize: number;
        ttl: number;
      };
      cdn: {
        enabled: boolean;
        provider: 'cloudflare' | 'aws-cloudfront' | 'azure-cdn';
        ttl: number;
        purgeOnUpdate: boolean;
      };
    };
    tags: {
      enabled: boolean;
      invalidation: 'immediate' | 'lazy' | 'scheduled';
    };
  };

  // Database Optimization
  database: {
    connectionPooling: {
      enabled: boolean;
      min: number;
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
    };
    queryOptimization: {
      enabled: boolean;
      slowQueryThreshold: number; // milliseconds
      explainQueries: boolean;
      queryCaching: boolean;
      indexHints: boolean;
    };
    readReplicas: {
      enabled: boolean;
      replicas: Array<{
        host: string;
        port: number;
        weight: number;
        healthCheck: boolean;
      }>;
      loadBalancing: 'round-robin' | 'weighted' | 'least-connections';
    };
    sharding: {
      enabled: boolean;
      strategy: 'hash' | 'range' | 'directory';
      shards: Array<{
        id: string;
        host: string;
        port: number;
        weight: number;
      }>;
    };
  };

  // API Performance
  api: {
    compression: {
      enabled: boolean;
      level: number; // 1-9
      threshold: number; // bytes
      types: string[];
    };
    pagination: {
      defaultLimit: number;
      maxLimit: number;
      cursorBased: boolean;
    };
    rateLimiting: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
      skipSuccessfulRequests: boolean;
      skipFailedRequests: boolean;
    };
    responseTime: {
      enabled: boolean;
      threshold: number; // milliseconds
      alerting: boolean;
    };
  };

  // Frontend Optimization
  frontend: {
    bundling: {
      enabled: boolean;
      minification: boolean;
      treeShaking: boolean;
      codeSplitting: boolean;
      lazyLoading: boolean;
    };
    cdn: {
      enabled: boolean;
      staticAssets: boolean;
      apiCaching: boolean;
      ttl: number;
    };
    preloading: {
      enabled: boolean;
      criticalResources: boolean;
      predictiveLoading: boolean;
    };
  };

  // Monitoring & Metrics
  monitoring: {
    enabled: boolean;
    metrics: {
      enabled: boolean;
      interval: number; // seconds
      retention: number; // days
    };
    profiling: {
      enabled: boolean;
      sampleRate: number; // 0-1
      duration: number; // seconds
    };
    alerting: {
      enabled: boolean;
      thresholds: {
        responseTime: number; // milliseconds
        errorRate: number; // percentage
        memoryUsage: number; // percentage
        cpuUsage: number; // percentage
      };
      channels: string[]; // email, slack, webhook
    };
  };

  // Background Jobs
  backgroundJobs: {
    enabled: boolean;
    queue: {
      provider: 'bull' | 'agenda' | 'bee-queue';
      redis: {
        host: string;
        port: number;
        password?: string;
        db: number;
      };
      concurrency: number;
      retryAttempts: number;
      retryDelay: number;
    };
    workers: {
      email: number;
      analytics: number;
      cleanup: number;
      reports: number;
    };
  };

  // CDN & Static Assets
  cdn: {
    enabled: boolean;
    provider: 'cloudflare' | 'aws-cloudfront' | 'azure-cdn' | 'custom';
    configuration: {
      staticAssets: boolean;
      apiCaching: boolean;
      ttl: number;
      compression: boolean;
      brotliCompression: boolean;
    };
    purging: {
      enabled: boolean;
      onUpdate: boolean;
      onDelete: boolean;
      batchSize: number;
    };
  };

  // Memory Management
  memory: {
    garbageCollection: {
      enabled: boolean;
      interval: number; // seconds
      threshold: number; // percentage
    };
    heapMonitoring: {
      enabled: boolean;
      threshold: number; // MB
      alerting: boolean;
    };
    memoryLeakDetection: {
      enabled: boolean;
      interval: number; // seconds
      threshold: number; // percentage growth
    };
  };

  // Network Optimization
  network: {
    keepAlive: {
      enabled: boolean;
      timeout: number; // milliseconds
    };
    compression: {
      enabled: boolean;
      level: number; // 1-9
      threshold: number; // bytes
    };
    http2: {
      enabled: boolean;
      push: boolean;
    };
  };

  // Search Optimization
  search: {
    enabled: boolean;
    provider: 'elasticsearch' | 'algolia' | 'meilisearch' | 'custom';
    configuration: {
      indexing: {
        batchSize: number;
        interval: number; // seconds
        realTime: boolean;
      };
      querying: {
        cache: boolean;
        ttl: number; // seconds
        maxResults: number;
      };
      performance: {
        shards: number;
        replicas: number;
        refreshInterval: number; // seconds
      };
    };
  };
}

export const defaultPerformanceConfig: PerformanceConfig = {
  cache: {
    enabled: true,
    defaultTtl: 3600, // 1 hour
    maxSize: 10000,
    strategies: {
      redis: {
        enabled: true,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: 0,
        keyPrefix: 'deservefirst:',
        ttl: 3600,
      },
      memory: {
        enabled: true,
        maxSize: 1000,
        ttl: 300, // 5 minutes
      },
      cdn: {
        enabled: false,
        provider: 'cloudflare',
        ttl: 86400, // 24 hours
        purgeOnUpdate: true,
      },
    },
    tags: {
      enabled: true,
      invalidation: 'immediate',
    },
  },

  database: {
    connectionPooling: {
      enabled: true,
      min: 5,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },
    queryOptimization: {
      enabled: true,
      slowQueryThreshold: 1000, // 1 second
      explainQueries: false,
      queryCaching: true,
      indexHints: true,
    },
    readReplicas: {
      enabled: false,
      replicas: [],
      loadBalancing: 'round-robin',
    },
    sharding: {
      enabled: false,
      strategy: 'hash',
      shards: [],
    },
  },

  api: {
    compression: {
      enabled: true,
      level: 6,
      threshold: 1024, // 1KB
      types: ['application/json', 'text/html', 'text/css', 'application/javascript'],
    },
    pagination: {
      defaultLimit: 20,
      maxLimit: 100,
      cursorBased: true,
    },
    rateLimiting: {
      enabled: true,
      windowMs: 60000, // 1 minute
      maxRequests: 100,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    },
    responseTime: {
      enabled: true,
      threshold: 2000, // 2 seconds
      alerting: true,
    },
  },

  frontend: {
    bundling: {
      enabled: true,
      minification: true,
      treeShaking: true,
      codeSplitting: true,
      lazyLoading: true,
    },
    cdn: {
      enabled: false,
      staticAssets: true,
      apiCaching: false,
      ttl: 3600,
    },
    preloading: {
      enabled: true,
      criticalResources: true,
      predictiveLoading: false,
    },
  },

  monitoring: {
    enabled: true,
    metrics: {
      enabled: true,
      interval: 60, // 1 minute
      retention: 30, // 30 days
    },
    profiling: {
      enabled: false,
      sampleRate: 0.1, // 10%
      duration: 300, // 5 minutes
    },
    alerting: {
      enabled: true,
      thresholds: {
        responseTime: 2000, // 2 seconds
        errorRate: 5, // 5%
        memoryUsage: 80, // 80%
        cpuUsage: 80, // 80%
      },
      channels: ['email'],
    },
  },

  backgroundJobs: {
    enabled: true,
    queue: {
      provider: 'bull',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: 1,
      },
      concurrency: 5,
      retryAttempts: 3,
      retryDelay: 5000,
    },
    workers: {
      email: 2,
      analytics: 1,
      cleanup: 1,
      reports: 1,
    },
  },

  cdn: {
    enabled: false,
    provider: 'cloudflare',
    configuration: {
      staticAssets: true,
      apiCaching: false,
      ttl: 3600,
      compression: true,
      brotliCompression: true,
    },
    purging: {
      enabled: false,
      onUpdate: true,
      onDelete: true,
      batchSize: 100,
    },
  },

  memory: {
    garbageCollection: {
      enabled: true,
      interval: 300, // 5 minutes
      threshold: 70, // 70%
    },
    heapMonitoring: {
      enabled: true,
      threshold: 512, // 512MB
      alerting: true,
    },
    memoryLeakDetection: {
      enabled: true,
      interval: 600, // 10 minutes
      threshold: 10, // 10% growth
    },
  },

  network: {
    keepAlive: {
      enabled: true,
      timeout: 5000, // 5 seconds
    },
    compression: {
      enabled: true,
      level: 6,
      threshold: 1024,
    },
    http2: {
      enabled: true,
      push: true,
    },
  },

  search: {
    enabled: false,
    provider: 'elasticsearch',
    configuration: {
      indexing: {
        batchSize: 100,
        interval: 60, // 1 minute
        realTime: false,
      },
      querying: {
        cache: true,
        ttl: 300, // 5 minutes
        maxResults: 1000,
      },
      performance: {
        shards: 1,
        replicas: 0,
        refreshInterval: 1, // 1 second
      },
    },
  },
};

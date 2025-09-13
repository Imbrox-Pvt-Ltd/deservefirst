import { ModuleConfig } from './ModuleRegistry';

// Performance metrics interface
interface PerformanceMetrics {
  moduleId: string;
  memoryUsage: number;
  cpuUsage: number;
  responseTime: number;
  requestCount: number;
  errorRate: number;
  lastUpdated: Date;
}

// Resource pool configuration
interface ResourcePoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
}

// Cache configuration
interface CacheConfig {
  ttl: number;
  maxSize: number;
  strategy: 'LRU' | 'LFU' | 'FIFO';
}

// Load balancing strategies
type LoadBalancingStrategy = 'round-robin' | 'least-connections' | 'weighted' | 'health-based';

// Performance optimizer class
export class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private resourcePools: Map<string, any[]> = new Map();
  private moduleCache: Map<string, any> = new Map();
  private lazyLoadedModules: Set<string> = new Set();
  private loadBalancer: LoadBalancer;
  private performanceThresholds: Map<string, number> = new Map();

  private eventListeners = new Map<string, Function[]>();

  private constructor() {
    this.loadBalancer = new LoadBalancer();
    this.initializeThresholds();
    this.startPerformanceMonitoring();
  }

  public static getInstance(): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer();
    }
    return PerformanceOptimizer.instance;
  }

  // Initialize performance thresholds
  private initializeThresholds(): void {
    this.performanceThresholds.set('memory', 500 * 1024 * 1024); // 500MB
    this.performanceThresholds.set('cpu', 80); // 80%
    this.performanceThresholds.set('responseTime', 5000); // 5 seconds
    this.performanceThresholds.set('errorRate', 0.05); // 5%
  }

  // Resource pooling for database connections, HTTP clients, etc.
  public createResourcePool(poolId: string, config: ResourcePoolConfig, factory: () => any): void {
    const pool: any[] = [];
    
    // Pre-populate with minimum connections
    for (let i = 0; i < config.minConnections; i++) {
      pool.push({
        resource: factory(),
        inUse: false,
        createdAt: new Date(),
        lastUsed: new Date()
      });
    }
    
    this.resourcePools.set(poolId, pool);
    
    // Cleanup idle resources
    setInterval(() => {
      this.cleanupIdleResources(poolId, config.idleTimeout);
    }, 60000); // Check every minute
  }

  // Acquire resource from pool
  public async acquireResource(poolId: string): Promise<any> {
    const pool = this.resourcePools.get(poolId);
    if (!pool) {
      throw new Error(`Resource pool ${poolId} not found`);
    }

    // Find available resource
    const available = pool.find(item => !item.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = new Date();
      return available.resource;
    }

    throw new Error(`No available resources in pool ${poolId}`);
  }

  // Release resource back to pool
  public releaseResource(poolId: string, resource: any): void {
    const pool = this.resourcePools.get(poolId);
    if (!pool) return;

    const poolItem = pool.find(item => item.resource === resource);
    if (poolItem) {
      poolItem.inUse = false;
      poolItem.lastUsed = new Date();
    }
  }

  // Lazy loading implementation
  public async lazyLoadModule(moduleId: string, loader: () => Promise<any>): Promise<any> {
    if (this.moduleCache.has(moduleId)) {
      return this.moduleCache.get(moduleId);
    }

    if (this.lazyLoadedModules.has(moduleId)) {
      // Module is currently being loaded, wait for it
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.moduleCache.has(moduleId)) {
            clearInterval(checkInterval);
            resolve(this.moduleCache.get(moduleId));
          }
        }, 100);
      });
    }

    this.lazyLoadedModules.add(moduleId);
    
    try {
      const module = await loader();
      this.moduleCache.set(moduleId, module);
      this.lazyLoadedModules.delete(moduleId);
      
      this.emitEvent('moduleLoaded', { moduleId, loadTime: Date.now() });
      return module;
    } catch (error) {
      this.lazyLoadedModules.delete(moduleId);
      throw error;
    }
  }

  // Caching with different strategies
  public setCache(key: string, value: any, config: CacheConfig): void {
    // Implement cache size limit
    if (this.moduleCache.size >= config.maxSize) {
      this.evictFromCache(config.strategy);
    }

    this.moduleCache.set(key, {
      value,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now()
    });

    // Set TTL
    setTimeout(() => {
      this.moduleCache.delete(key);
    }, config.ttl);
  }

  public getCache(key: string): any {
    const cached = this.moduleCache.get(key);
    if (cached) {
      cached.accessCount++;
      cached.lastAccessed = Date.now();
      return cached.value;
    }
    return null;
  }

  // Cache eviction strategies
  private evictFromCache(strategy: 'LRU' | 'LFU' | 'FIFO'): void {
    if (this.moduleCache.size === 0) return;

    let keyToEvict: string;
    const entries = Array.from(this.moduleCache.entries());

    switch (strategy) {
      case 'LRU': // Least Recently Used
        keyToEvict = entries.reduce((oldest, [key, value]) => 
          value.lastAccessed < this.moduleCache.get(oldest)?.lastAccessed ? key : oldest
        , entries[0][0]);
        break;
      
      case 'LFU': // Least Frequently Used
        keyToEvict = entries.reduce((least, [key, value]) => 
          value.accessCount < this.moduleCache.get(least)?.accessCount ? key : least
        , entries[0][0]);
        break;
      
      case 'FIFO': // First In, First Out
        keyToEvict = entries.reduce((oldest, [key, value]) => 
          value.createdAt < this.moduleCache.get(oldest)?.createdAt ? key : oldest
        , entries[0][0]);
        break;
    }

    this.moduleCache.delete(keyToEvict);
  }

  // Performance monitoring
  public recordMetrics(moduleId: string, metrics: Partial<PerformanceMetrics>): void {
    const existing = this.metrics.get(moduleId) || {
      moduleId,
      memoryUsage: 0,
      cpuUsage: 0,
      responseTime: 0,
      requestCount: 0,
      errorRate: 0,
      lastUpdated: new Date()
    };

    const updated = { ...existing, ...metrics, lastUpdated: new Date() };
    this.metrics.set(moduleId, updated);

    // Check thresholds and emit warnings
    this.checkPerformanceThresholds(updated);
  }

  // Load balancing
  public getOptimalModuleInstance(moduleId: string, strategy: LoadBalancingStrategy = 'health-based'): string {
    return this.loadBalancer.selectInstance(moduleId, strategy, this.metrics);
  }

  // Performance optimization recommendations
  public getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    
    for (const [moduleId, metrics] of this.metrics) {
      if (metrics.memoryUsage > this.performanceThresholds.get('memory')!) {
        recommendations.push(`Consider memory optimization for module ${moduleId}`);
      }
      
      if (metrics.responseTime > this.performanceThresholds.get('responseTime')!) {
        recommendations.push(`Optimize response time for module ${moduleId}`);
      }
      
      if (metrics.errorRate > this.performanceThresholds.get('errorRate')!) {
        recommendations.push(`Investigate error rate in module ${moduleId}`);
      }
    }
    
    return recommendations;
  }

  // Cleanup methods
  private cleanupIdleResources(poolId: string, idleTimeout: number): void {
    const pool = this.resourcePools.get(poolId);
    if (!pool) return;

    const now = Date.now();
    const toRemove = pool.filter(item => 
      !item.inUse && (now - item.lastUsed.getTime()) > idleTimeout
    );

    toRemove.forEach(item => {
      const index = pool.indexOf(item);
      if (index > -1) {
        pool.splice(index, 1);
      }
    });
  }

  private checkPerformanceThresholds(metrics: PerformanceMetrics): void {
    if (metrics.memoryUsage > this.performanceThresholds.get('memory')!) {
      this.emitEvent('performanceWarning', {
        moduleId: metrics.moduleId,
        type: 'memory',
        value: metrics.memoryUsage,
        threshold: this.performanceThresholds.get('memory')
      });
    }
  }

  private startPerformanceMonitoring(): void {
    setInterval(() => {
      this.emitEvent('performanceReport', {
        timestamp: new Date(),
        metrics: Array.from(this.metrics.values()),
        recommendations: this.getOptimizationRecommendations()
      });
    }, 30000); // Report every 30 seconds
  }

  // Event system methods
  on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emitEvent(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }
}

// Load balancer implementation
class LoadBalancer {
  private roundRobinCounters: Map<string, number> = new Map();

  public selectInstance(moduleId: string, strategy: LoadBalancingStrategy, metrics: Map<string, PerformanceMetrics>): string {
    // For simplicity, returning moduleId with strategy suffix
    // In real implementation, this would select from actual instances
    
    switch (strategy) {
      case 'round-robin':
        const counter = this.roundRobinCounters.get(moduleId) || 0;
        this.roundRobinCounters.set(moduleId, counter + 1);
        return `${moduleId}-instance-${counter % 3}`; // Assume 3 instances
      
      case 'health-based':
        // Select instance based on health metrics
        const moduleMetrics = metrics.get(moduleId);
        if (moduleMetrics && moduleMetrics.errorRate < 0.01) {
          return `${moduleId}-healthy-instance`;
        }
        return `${moduleId}-backup-instance`;
      
      default:
        return `${moduleId}-default-instance`;
    }
  }
}

// Export singleton instance
export const performanceOptimizer = PerformanceOptimizer.getInstance();

// Export types
export type { PerformanceMetrics, ResourcePoolConfig, CacheConfig, LoadBalancingStrategy };
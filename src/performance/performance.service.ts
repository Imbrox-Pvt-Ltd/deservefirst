import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceConfig } from './performance.config';
import * as Redis from 'ioredis';
import * as compression from 'compression';
import * as cluster from 'cluster';
import * as os from 'os';

export interface PerformanceMetrics {
  timestamp: Date;
  responseTime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  cpuUsage: number;
  activeConnections: number;
  cacheHitRate: number;
  errorRate: number;
  throughput: number; // requests per second
  slowQueries: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  memoryUsage: number;
  keys: number;
}

export interface DatabaseStats {
  activeConnections: number;
  idleConnections: number;
  totalQueries: number;
  slowQueries: number;
  averageQueryTime: number;
  connectionPoolUtilization: number;
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private performanceConfig: PerformanceConfig;
  private redis: Redis.Redis | null = null;
  private metrics: PerformanceMetrics[] = [];
  private cacheStats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    size: 0,
    memoryUsage: 0,
    keys: 0,
  };
  private databaseStats: DatabaseStats = {
    activeConnections: 0,
    idleConnections: 0,
    totalQueries: 0,
    slowQueries: 0,
    averageQueryTime: 0,
    connectionPoolUtilization: 0,
  };
  private startTime: Date = new Date();

  constructor(private configService: ConfigService) {
    this.performanceConfig = this.configService.get<PerformanceConfig>('performance') || require('./performance.config').defaultPerformanceConfig;
    this.initializeRedis();
    this.startMetricsCollection();
  }

  /**
   * Initialize Redis connection for caching
   */
  private async initializeRedis(): Promise<void> {
    if (this.performanceConfig.cache.strategies.redis.enabled) {
      try {
        this.redis = new (Redis as any)({
          host: this.performanceConfig.cache.strategies.redis.host,
          port: this.performanceConfig.cache.strategies.redis.port,
          password: this.performanceConfig.cache.strategies.redis.password,
          db: this.performanceConfig.cache.strategies.redis.db,
          keyPrefix: this.performanceConfig.cache.strategies.redis.keyPrefix,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        });

        this.redis!.on('connect', () => {
          this.logger.log('✅ Redis connected for performance caching');
        });

        this.redis!.on('error', (error) => {
          this.logger.error('❌ Redis connection error:', error);
        });
      } catch (error) {
        this.logger.error('Failed to initialize Redis:', error);
      }
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    if (!this.performanceConfig.monitoring.enabled) return;

    setInterval(() => {
      this.collectMetrics();
    }, this.performanceConfig.monitoring.metrics.interval * 1000);
  }

  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = await this.getCpuUsage();
      
      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        responseTime: await this.getAverageResponseTime(),
        memoryUsage: {
          used: memoryUsage.heapUsed,
          total: memoryUsage.heapTotal,
          percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        },
        cpuUsage,
        activeConnections: this.databaseStats.activeConnections,
        cacheHitRate: this.cacheStats.hitRate,
        errorRate: await this.getErrorRate(),
        throughput: await this.getThroughput(),
        slowQueries: this.databaseStats.slowQueries,
      };

      this.metrics.push(metrics);

      // Keep only recent metrics
      const retentionDays = this.performanceConfig.monitoring.metrics.retention;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      this.metrics = this.metrics.filter(m => m.timestamp > cutoffDate);

      // Check for alerts
      await this.checkAlerts(metrics);

      this.logger.debug(`📊 Performance metrics collected: ${JSON.stringify(metrics)}`);
    } catch (error) {
      this.logger.error('Error collecting performance metrics:', error);
    }
  }

  /**
   * Get CPU usage percentage
   */
  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = Date.now();

      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // seconds
        const cpuUsage = (endUsage.user + endUsage.system) / 1000000 / duration; // percentage
        resolve(Math.min(cpuUsage * 100, 100));
      }, 100);
    });
  }

  /**
   * Get average response time
   */
  private async getAverageResponseTime(): Promise<number> {
    if (this.metrics.length === 0) return 0;
    
    const recentMetrics = this.metrics.slice(-10); // Last 10 measurements
    const totalResponseTime = recentMetrics.reduce((sum, m) => sum + m.responseTime, 0);
    return totalResponseTime / recentMetrics.length;
  }

  /**
   * Get error rate percentage
   */
  private async getErrorRate(): Promise<number> {
    // This would be calculated from actual request logs
    // For now, return a mock value
    return 0.5; // 0.5%
  }

  /**
   * Get throughput (requests per second)
   */
  private async getThroughput(): Promise<number> {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    // This would be calculated from actual request logs
    // For now, return a mock value
    return 150; // 150 requests per second
  }

  /**
   * Check for performance alerts
   */
  private async checkAlerts(metrics: PerformanceMetrics): Promise<void> {
    if (!this.performanceConfig.monitoring.alerting.enabled) return;

    const thresholds = this.performanceConfig.monitoring.alerting.thresholds;

    if (metrics.responseTime > thresholds.responseTime) {
      await this.sendAlert('High Response Time', `Response time: ${metrics.responseTime}ms (threshold: ${thresholds.responseTime}ms)`);
    }

    if (metrics.errorRate > thresholds.errorRate) {
      await this.sendAlert('High Error Rate', `Error rate: ${metrics.errorRate}% (threshold: ${thresholds.errorRate}%)`);
    }

    if (metrics.memoryUsage.percentage > thresholds.memoryUsage) {
      await this.sendAlert('High Memory Usage', `Memory usage: ${metrics.memoryUsage.percentage.toFixed(2)}% (threshold: ${thresholds.memoryUsage}%)`);
    }

    if (metrics.cpuUsage > thresholds.cpuUsage) {
      await this.sendAlert('High CPU Usage', `CPU usage: ${metrics.cpuUsage.toFixed(2)}% (threshold: ${thresholds.cpuUsage}%)`);
    }
  }

  /**
   * Send performance alert
   */
  private async sendAlert(title: string, message: string): Promise<void> {
    this.logger.warn(`🚨 Performance Alert: ${title} - ${message}`);
    
    // In a real implementation, you would send alerts via email, Slack, etc.
    // For now, just log the alert
  }

  /**
   * Cache data with TTL
   */
  async cacheSet(key: string, data: any, ttl?: number): Promise<void> {
    if (!this.performanceConfig.cache.enabled) return;

    try {
      const cacheKey = this.generateCacheKey(key);
      const serializedData = JSON.stringify(data);
      const cacheTtl = ttl || this.performanceConfig.cache.defaultTtl;

      if (this.performanceConfig.cache.strategies.redis.enabled && this.redis) {
        await this.redis.setex(cacheKey, cacheTtl, serializedData);
      }

      // Update cache stats
      this.cacheStats.size++;
      this.cacheStats.keys++;
    } catch (error) {
      this.logger.error(`Error caching data for key ${key}:`, error);
    }
  }

  /**
   * Get cached data
   */
  async cacheGet(key: string): Promise<any> {
    if (!this.performanceConfig.cache.enabled) return null;

    try {
      const cacheKey = this.generateCacheKey(key);

      if (this.performanceConfig.cache.strategies.redis.enabled && this.redis) {
        const cachedData = await this.redis.get(cacheKey);
        if (cachedData) {
          this.cacheStats.hits++;
          this.updateCacheHitRate();
          return JSON.parse(cachedData);
        }
      }

      this.cacheStats.misses++;
      this.updateCacheHitRate();
      return null;
    } catch (error) {
      this.logger.error(`Error retrieving cached data for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Invalidate cache by key
   */
  async cacheInvalidate(key: string): Promise<void> {
    if (!this.performanceConfig.cache.enabled) return;

    try {
      const cacheKey = this.generateCacheKey(key);

      if (this.performanceConfig.cache.strategies.redis.enabled && this.redis) {
        await this.redis.del(cacheKey);
      }

      this.cacheStats.keys = Math.max(0, this.cacheStats.keys - 1);
    } catch (error) {
      this.logger.error(`Error invalidating cache for key ${key}:`, error);
    }
  }

  /**
   * Invalidate cache by tag
   */
  async cacheInvalidateByTag(tag: string): Promise<void> {
    if (!this.performanceConfig.cache.enabled || !this.performanceConfig.cache.tags.enabled) return;

    try {
      if (this.performanceConfig.cache.strategies.redis.enabled && this.redis) {
        const pattern = `${this.performanceConfig.cache.strategies.redis.keyPrefix}tag:${tag}:*`;
        const keys = await this.redis.keys(pattern);
        
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache by tag ${tag}:`, error);
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(key: string): string {
    return `cache:${key}`;
  }

  /**
   * Update cache hit rate
   */
  private updateCacheHitRate(): void {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    this.cacheStats.hitRate = total > 0 ? (this.cacheStats.hits / total) * 100 : 0;
  }

  /**
   * Get performance metrics
   */
  getMetrics(limit: number = 100): PerformanceMetrics[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return { ...this.cacheStats };
  }

  /**
   * Get database statistics
   */
  getDatabaseStats(): DatabaseStats {
    return { ...this.databaseStats };
  }

  /**
   * Get system information
   */
  getSystemInfo(): {
    platform: string;
    arch: string;
    nodeVersion: string;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpus: number;
    loadAverage: number[];
  } {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpus: os.cpus().length,
      loadAverage: os.loadavg(),
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    uptime: number;
    totalRequests: number;
    averageResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
    status: 'healthy' | 'warning' | 'critical';
  } {
    const uptime = Date.now() - this.startTime.getTime();
    const recentMetrics = this.metrics.slice(-10);
    const averageResponseTime = recentMetrics.length > 0 
      ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length 
      : 0;

    const latestMetrics = this.metrics[this.metrics.length - 1];
    const memoryUsage = latestMetrics?.memoryUsage.percentage || 0;
    const cpuUsage = latestMetrics?.cpuUsage || 0;
    const errorRate = latestMetrics?.errorRate || 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (memoryUsage > 80 || cpuUsage > 80 || errorRate > 5) {
      status = 'critical';
    } else if (memoryUsage > 60 || cpuUsage > 60 || errorRate > 2) {
      status = 'warning';
    }

    return {
      uptime,
      totalRequests: 0, // This would be calculated from actual request logs
      averageResponseTime,
      cacheHitRate: this.cacheStats.hitRate,
      errorRate,
      memoryUsage,
      cpuUsage,
      status,
    };
  }

  /**
   * Optimize database queries
   */
  async optimizeQuery(query: string, params: any[] = []): Promise<{
    optimized: boolean;
    suggestions: string[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    
    // Basic query optimization suggestions
    const suggestions: string[] = [];
    
    // Check for missing indexes
    if (query.toLowerCase().includes('where') && !query.toLowerCase().includes('index')) {
      suggestions.push('Consider adding an index on WHERE clause columns');
    }
    
    // Check for SELECT *
    if (query.toLowerCase().includes('select *')) {
      suggestions.push('Avoid SELECT * - specify only needed columns');
    }
    
    // Check for missing LIMIT
    if (query.toLowerCase().includes('select') && !query.toLowerCase().includes('limit')) {
      suggestions.push('Consider adding LIMIT clause for large result sets');
    }
    
    const executionTime = Date.now() - startTime;
    
    return {
      optimized: suggestions.length === 0,
      suggestions,
      executionTime,
    };
  }

  /**
   * Clean up old data
   */
  async cleanup(): Promise<void> {
    try {
      // Clean up old metrics
      const retentionDays = this.performanceConfig.monitoring.metrics.retention;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      this.metrics = this.metrics.filter(m => m.timestamp > cutoffDate);

      // Clean up Redis cache if enabled
      if (this.performanceConfig.cache.strategies.redis.enabled && this.redis) {
        const pattern = `${this.performanceConfig.cache.strategies.redis.keyPrefix}*`;
        const keys = await this.redis.keys(pattern);
        
        // Remove expired keys
        for (const key of keys) {
          const ttl = await this.redis.ttl(key);
          if (ttl === -1) { // No expiration set
            await this.redis.del(key);
          }
        }
      }

      this.logger.log('🧹 Performance data cleanup completed');
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }
}

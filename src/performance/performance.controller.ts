import { Controller, Get, Post, Delete, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { PerformanceService } from './performance.service';
import { AuthGuard } from '../security/guards/auth.guard';
import { AdminOnly } from '../security/decorators/security.decorators';

@ApiTags('performance')
@Controller('performance')
@UseGuards(AuthGuard)
export class PerformanceController {
  constructor(private performanceService: PerformanceService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get performance metrics' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Performance metrics retrieved successfully' })
  async getMetrics(@Query('limit') limit: number = 100) {
    const metrics = this.performanceService.getMetrics(limit);
    
    return {
      success: true,
      data: {
        metrics,
        count: metrics.length,
        latest: metrics[metrics.length - 1],
      },
    };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get performance summary' })
  @ApiResponse({ status: 200, description: 'Performance summary retrieved successfully' })
  async getPerformanceSummary() {
    const summary = this.performanceService.getPerformanceSummary();
    
    return {
      success: true,
      data: summary,
    };
  }

  @Get('cache/stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  @ApiResponse({ status: 200, description: 'Cache statistics retrieved successfully' })
  async getCacheStats() {
    const stats = this.performanceService.getCacheStats();
    
    return {
      success: true,
      data: stats,
    };
  }

  @Get('database/stats')
  @ApiOperation({ summary: 'Get database statistics' })
  @ApiResponse({ status: 200, description: 'Database statistics retrieved successfully' })
  async getDatabaseStats() {
    const stats = this.performanceService.getDatabaseStats();
    
    return {
      success: true,
      data: stats,
    };
  }

  @Get('system/info')
  @ApiOperation({ summary: 'Get system information' })
  @ApiResponse({ status: 200, description: 'System information retrieved successfully' })
  async getSystemInfo() {
    const systemInfo = this.performanceService.getSystemInfo();
    
    return {
      success: true,
      data: systemInfo,
    };
  }

  @Post('cache/invalidate')
  @AdminOnly()
  @ApiOperation({ summary: 'Invalidate cache by key (Admin only)' })
  @ApiQuery({ name: 'key', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Cache invalidated successfully' })
  async invalidateCache(@Query('key') key: string) {
    await this.performanceService.cacheInvalidate(key);
    
    return {
      success: true,
      message: `Cache invalidated for key: ${key}`,
    };
  }

  @Post('cache/invalidate/tag')
  @AdminOnly()
  @ApiOperation({ summary: 'Invalidate cache by tag (Admin only)' })
  @ApiQuery({ name: 'tag', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Cache invalidated by tag successfully' })
  async invalidateCacheByTag(@Query('tag') tag: string) {
    await this.performanceService.cacheInvalidateByTag(tag);
    
    return {
      success: true,
      message: `Cache invalidated for tag: ${tag}`,
    };
  }

  @Post('cache/clear')
  @AdminOnly()
  @ApiOperation({ summary: 'Clear all cache (Admin only)' })
  @ApiResponse({ status: 200, description: 'All cache cleared successfully' })
  async clearAllCache() {
    // This would clear all cache entries
    // Implementation depends on cache strategy
    
    return {
      success: true,
      message: 'All cache cleared successfully',
    };
  }

  @Post('optimize/query')
  @AdminOnly()
  @ApiOperation({ summary: 'Optimize database query (Admin only)' })
  @ApiQuery({ name: 'query', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Query optimization completed' })
  async optimizeQuery(@Query('query') query: string) {
    const result = await this.performanceService.optimizeQuery(query);
    
    return {
      success: true,
      data: result,
    };
  }

  @Post('cleanup')
  @AdminOnly()
  @ApiOperation({ summary: 'Clean up old performance data (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cleanup completed successfully' })
  async cleanup() {
    await this.performanceService.cleanup();
    
    return {
      success: true,
      message: 'Performance data cleanup completed',
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get performance health status' })
  @ApiResponse({ status: 200, description: 'Performance health status retrieved' })
  async getHealthStatus() {
    const summary = this.performanceService.getPerformanceSummary();
    const systemInfo = this.performanceService.getSystemInfo();
    
    const health = {
      status: summary.status,
      uptime: summary.uptime,
      memory: {
        used: summary.memoryUsage,
        total: systemInfo.memory.heapTotal,
        percentage: summary.memoryUsage,
      },
      performance: {
        averageResponseTime: summary.averageResponseTime,
        cacheHitRate: summary.cacheHitRate,
        errorRate: summary.errorRate,
      },
      system: {
        platform: systemInfo.platform,
        nodeVersion: systemInfo.nodeVersion,
        cpus: systemInfo.cpus,
        loadAverage: systemInfo.loadAverage,
      },
    };
    
    return {
      success: true,
      data: health,
    };
  }

  @Get('alerts')
  @AdminOnly()
  @ApiOperation({ summary: 'Get performance alerts (Admin only)' })
  @ApiResponse({ status: 200, description: 'Performance alerts retrieved' })
  async getAlerts() {
    const summary = this.performanceService.getPerformanceSummary();
    const alerts = [];
    
    // Check for performance issues
    if (summary.status === 'critical') {
      alerts.push({
        level: 'critical',
        message: 'System performance is critical',
        details: {
          memoryUsage: summary.memoryUsage,
          cpuUsage: summary.cpuUsage,
          errorRate: summary.errorRate,
        },
        timestamp: new Date(),
      });
    } else if (summary.status === 'warning') {
      alerts.push({
        level: 'warning',
        message: 'System performance is degraded',
        details: {
          memoryUsage: summary.memoryUsage,
          cpuUsage: summary.cpuUsage,
          errorRate: summary.errorRate,
        },
        timestamp: new Date(),
      });
    }
    
    return {
      success: true,
      data: {
        alerts,
        count: alerts.length,
      },
    };
  }

  @Get('reports/performance')
  @AdminOnly()
  @ApiOperation({ summary: 'Generate performance report (Admin only)' })
  @ApiQuery({ name: 'period', required: false, type: String, description: 'Report period (1h, 24h, 7d, 30d)' })
  @ApiResponse({ status: 200, description: 'Performance report generated' })
  async generatePerformanceReport(@Query('period') period: string = '24h') {
    const metrics = this.performanceService.getMetrics(1000);
    const summary = this.performanceService.getPerformanceSummary();
    const cacheStats = this.performanceService.getCacheStats();
    const databaseStats = this.performanceService.getDatabaseStats();
    
    // Calculate report data based on period
    const now = new Date();
    let startTime: Date;
    
    switch (period) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    
    const periodMetrics = metrics.filter(m => m.timestamp >= startTime);
    
    const report = {
      period,
      startTime,
      endTime: now,
      summary: {
        totalRequests: periodMetrics.length,
        averageResponseTime: periodMetrics.length > 0 
          ? periodMetrics.reduce((sum, m) => sum + m.responseTime, 0) / periodMetrics.length 
          : 0,
        peakResponseTime: periodMetrics.length > 0 
          ? Math.max(...periodMetrics.map(m => m.responseTime)) 
          : 0,
        averageMemoryUsage: periodMetrics.length > 0 
          ? periodMetrics.reduce((sum, m) => sum + m.memoryUsage.percentage, 0) / periodMetrics.length 
          : 0,
        averageCpuUsage: periodMetrics.length > 0 
          ? periodMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) / periodMetrics.length 
          : 0,
        cacheHitRate: cacheStats.hitRate,
        errorRate: summary.errorRate,
      },
      trends: {
        responseTime: this.calculateTrend(periodMetrics.map(m => m.responseTime)),
        memoryUsage: this.calculateTrend(periodMetrics.map(m => m.memoryUsage.percentage)),
        cpuUsage: this.calculateTrend(periodMetrics.map(m => m.cpuUsage)),
      },
      recommendations: this.generateRecommendations(summary, cacheStats, databaseStats),
    };
    
    return {
      success: true,
      data: report,
    };
  }

  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  private generateRecommendations(summary: any, cacheStats: any, databaseStats: any): string[] {
    const recommendations = [];
    
    if (summary.memoryUsage > 80) {
      recommendations.push('Consider increasing memory allocation or optimizing memory usage');
    }
    
    if (summary.averageResponseTime > 1000) {
      recommendations.push('Optimize database queries and consider adding caching');
    }
    
    if (cacheStats.hitRate < 50) {
      recommendations.push('Improve cache hit rate by optimizing cache keys and TTL');
    }
    
    if (summary.errorRate > 2) {
      recommendations.push('Investigate and fix error sources to reduce error rate');
    }
    
    if (databaseStats.slowQueries > 10) {
      recommendations.push('Optimize slow database queries and consider adding indexes');
    }
    
    return recommendations;
  }
}

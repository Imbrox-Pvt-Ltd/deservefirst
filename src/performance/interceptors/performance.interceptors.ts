import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { PerformanceService } from '../performance.service';
import { Request, Response } from 'express';

@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseTimeInterceptor.name);

  constructor(private performanceService: PerformanceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        response.setHeader('X-Response-Time', `${duration}ms`);
        
        // Log slow requests
        if (duration > 1000) { // 1 second
          this.logger.warn(`🐌 Slow request: ${request.method} ${request.url} - ${duration}ms`);
        }
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(`❌ Request failed: ${request.method} ${request.url} - ${duration}ms - ${error.message}`);
        throw error;
      })
    );
  }
}

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(private performanceService: PerformanceService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    // Only cache GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    // Generate cache key
    const cacheKey = this.generateCacheKey(request);
    
    // Try to get from cache
    const cachedData = await this.performanceService.cacheGet(cacheKey);
    if (cachedData) {
      response.setHeader('X-Cache', 'HIT');
      return new Observable(subscriber => {
        subscriber.next(cachedData);
        subscriber.complete();
      });
    }

    // Cache miss - proceed with request
    response.setHeader('X-Cache', 'MISS');
    
    return next.handle().pipe(
      tap(async (data) => {
        // Cache the response
        await this.performanceService.cacheSet(cacheKey, data);
      })
    );
  }

  private generateCacheKey(request: Request): string {
    const { method, url, query } = request;
    const queryString = query ? JSON.stringify(query) : '';
    return `${method}:${url}:${queryString}`;
  }
}

@Injectable()
export class CompressionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CompressionInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Set compression headers
    const acceptEncoding = request.get('Accept-Encoding') || '';
    
    if (acceptEncoding.includes('gzip')) {
      response.setHeader('Content-Encoding', 'gzip');
    } else if (acceptEncoding.includes('deflate')) {
      response.setHeader('Content-Encoding', 'deflate');
    } else if (acceptEncoding.includes('br')) {
      response.setHeader('Content-Encoding', 'br');
    }

    return next.handle();
  }
}

@Injectable()
export class DatabaseQueryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DatabaseQueryInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        
        // Log slow database operations
        if (duration > 500) { // 500ms
          this.logger.warn(`🐌 Slow database operation: ${request.method} ${request.url} - ${duration}ms`);
        }
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(`❌ Database error: ${request.method} ${request.url} - ${duration}ms - ${error.message}`);
        throw error;
      })
    );
  }
}

@Injectable()
export class MemoryUsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MemoryUsageInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const startMemory = process.memoryUsage();

    return next.handle().pipe(
      tap(() => {
        const endMemory = process.memoryUsage();
        const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
        
        // Log high memory usage
        if (memoryDelta > 10 * 1024 * 1024) { // 10MB
          this.logger.warn(`🧠 High memory usage: ${request.method} ${request.url} - ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
        }
      })
    );
  }
}

@Injectable()
export class RequestSizeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestSizeInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const contentLength = parseInt(request.get('Content-Length') || '0');

    // Check for large requests
    if (contentLength > 10 * 1024 * 1024) { // 10MB
      this.logger.warn(`📦 Large request: ${request.method} ${request.url} - ${(contentLength / 1024 / 1024).toFixed(2)}MB`);
    }

    return next.handle();
  }
}

@Injectable()
export class ConcurrencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ConcurrencyInterceptor.name);
  private activeRequests = 0;
  private maxConcurrency = 100;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Check concurrency limit
    if (this.activeRequests >= this.maxConcurrency) {
      this.logger.warn(`🚫 Concurrency limit reached: ${this.activeRequests}/${this.maxConcurrency}`);
      throw new Error('Service temporarily unavailable - too many concurrent requests');
    }

    this.activeRequests++;

    return next.handle().pipe(
      tap(() => {
        this.activeRequests--;
      }),
      catchError((error) => {
        this.activeRequests--;
        throw error;
      })
    );
  }
}

@Injectable()
export class ErrorTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorTrackingInterceptor.name);
  private errorCount = 0;
  private errorRate = 0;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      catchError((error) => {
        this.errorCount++;
        this.calculateErrorRate();
        
        // Log error details
        this.logger.error(`❌ Error in ${request.method} ${request.url}:`, {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          userAgent: request.get('User-Agent'),
          ip: request.ip,
        });

        // Alert if error rate is too high
        if (this.errorRate > 5) { // 5%
          this.logger.error(`🚨 High error rate detected: ${this.errorRate.toFixed(2)}%`);
        }

        throw error;
      })
    );
  }

  private calculateErrorRate(): void {
    // This would be calculated from actual request logs
    // For now, use a simple counter
    this.errorRate = Math.min(this.errorCount / 100, 100);
  }
}

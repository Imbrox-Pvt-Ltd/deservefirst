import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { SecurityService } from '../security.service';
import { Request, Response } from 'express';

@Injectable()
export class SecurityHeadersInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SecurityHeadersInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request>();

    // Set security headers
    this.setSecurityHeaders(response, request);

    return next.handle();
  }

  private setSecurityHeaders(response: Response, request: Request): void {
    // HSTS (HTTP Strict Transport Security)
    if (request.secure) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // X-Content-Type-Options
    response.setHeader('X-Content-Type-Options', 'nosniff');

    // X-Frame-Options
    response.setHeader('X-Frame-Options', 'DENY');

    // X-XSS-Protection
    response.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer-Policy
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content-Security-Policy
    const csp = this.buildCSPHeader();
    response.setHeader('Content-Security-Policy', csp);

    // Permissions-Policy
    const permissionsPolicy = this.buildPermissionsPolicyHeader();
    response.setHeader('Permissions-Policy', permissionsPolicy);

    // Remove X-Powered-By header
    response.removeHeader('X-Powered-By');

    // Add custom security headers
    response.setHeader('X-Request-ID', this.generateRequestId());
    response.setHeader('X-Response-Time', Date.now().toString());
  }

  private buildCSPHeader(): string {
    const directives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://api.deservefirst.com",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "object-src 'none'",
      "media-src 'self'",
      "frame-src 'none'",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
      "block-all-mixed-content"
    ];

    return directives.join('; ');
  }

  private buildPermissionsPolicyHeader(): string {
    const permissions = [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
      'gyroscope=()',
      'accelerometer=()'
    ];

    return permissions.join(', ');
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private securityService: SecurityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    const user = (request as any).user;
    const ipAddress = this.getClientIp(request);
    const userAgent = request.get('User-Agent') || '';

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logAuditEvent({
          method: request.method,
          url: request.url,
          statusCode: response.statusCode,
          duration,
          user: user?.id,
          ipAddress,
          userAgent,
          success: true,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logAuditEvent({
          method: request.method,
          url: request.url,
          statusCode: error.status || 500,
          duration,
          user: user?.id,
          ipAddress,
          userAgent,
          success: false,
          error: error.message,
        });
        throw error;
      })
    );
  }

  private logAuditEvent(event: {
    method: string;
    url: string;
    statusCode: number;
    duration: number;
    user?: string;
    ipAddress: string;
    userAgent: string;
    success: boolean;
    error?: string;
  }): void {
    const logMessage = `${event.method} ${event.url} - ${event.statusCode} - ${event.duration}ms - ${event.user || 'anonymous'} - ${event.ipAddress}`;
    
    if (event.success) {
      this.logger.log(logMessage);
    } else {
      this.logger.error(logMessage, event.error);
    }

    // Log to security service for audit trail
    this.securityService.logSecurityEvent({
      type: 'login', // This would be more specific in a real implementation
      userId: event.user || 'anonymous',
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      details: {
        method: event.method,
        url: event.url,
        statusCode: event.statusCode,
        duration: event.duration,
        success: event.success,
        error: event.error,
      },
      severity: event.success ? 'low' : 'medium',
    });
  }

  private getClientIp(request: Request): string {
    return (
      request.get('X-Forwarded-For') ||
      request.get('X-Real-IP') ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }
}

@Injectable()
export class DataSanitizationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DataSanitizationInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    // Sanitize request body
    if (request.body) {
      request.body = this.sanitizeObject(request.body);
    }

    // Sanitize query parameters (only if they exist and are mutable)
    if (request.query && typeof request.query === 'object') {
      try {
        Object.keys(request.query).forEach(key => {
          if (request.query[key] && typeof request.query[key] === 'string') {
            request.query[key] = this.sanitizeString(request.query[key]);
          }
        });
      } catch (error) {
        // Ignore read-only property errors
      }
    }

    // Sanitize route parameters (only if they exist and are mutable)
    if (request.params && typeof request.params === 'object') {
      try {
        Object.keys(request.params).forEach(key => {
          if (request.params[key] && typeof request.params[key] === 'string') {
            request.params[key] = this.sanitizeString(request.params[key]);
          }
        });
      } catch (error) {
        // Ignore read-only property errors
      }
    }

    return next.handle();
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  private sanitizeString(value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Remove potentially dangerous characters
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .replace(/&lt;script/gi, '') // Remove encoded script tags
      .replace(/&lt;iframe/gi, '') // Remove encoded iframe tags
      .trim();
  }
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Generate or use existing request ID
    const requestId = request.get('X-Request-ID') || this.generateRequestId();
    
    // Set request ID in response headers
    response.setHeader('X-Request-ID', requestId);
    
    // Add request ID to request object for logging
    (request as any).requestId = requestId;

    return next.handle();
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

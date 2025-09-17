import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PerformanceService } from './performance.service';
import { PerformanceController } from './performance.controller';
import { ResponseTimeInterceptor, CacheInterceptor, CompressionInterceptor, DatabaseQueryInterceptor, MemoryUsageInterceptor, RequestSizeInterceptor, ConcurrencyInterceptor, ErrorTrackingInterceptor } from './interceptors/performance.interceptors';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [PerformanceController],
  providers: [
    PerformanceService,
    ResponseTimeInterceptor,
    CacheInterceptor,
    CompressionInterceptor,
    DatabaseQueryInterceptor,
    MemoryUsageInterceptor,
    RequestSizeInterceptor,
    ConcurrencyInterceptor,
    ErrorTrackingInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTimeInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CompressionInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DatabaseQueryInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MemoryUsageInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestSizeInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ConcurrencyInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ErrorTrackingInterceptor,
    },
  ],
  exports: [
    PerformanceService,
    ResponseTimeInterceptor,
    CacheInterceptor,
    CompressionInterceptor,
    DatabaseQueryInterceptor,
    MemoryUsageInterceptor,
    RequestSizeInterceptor,
    ConcurrencyInterceptor,
    ErrorTrackingInterceptor,
  ],
})
export class PerformanceModule {}

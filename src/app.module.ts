import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Core modules
import { CoreModule } from './core/core.module';
import { RbacModule } from './rbac/rbac.module';
import { CmsModule } from './cms/cms.module';
import { ModulesModule } from './modules/modules.module';
import { MigrationsModule } from './migrations/migrations.module';
import { SecurityModule } from './security/security.module';
import { PerformanceModule } from './performance/performance.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database - MySQL configuration
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'deservefirst',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
      retryAttempts: 3,
      retryDelay: 3000,
    }),

    // Caching - Simplified for now
    CacheModule.register({
      ttl: 300, // 5 minutes
    }),

    // Event system
    EventEmitterModule.forRoot(),

    // Rate limiting - Simplified for now
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute
      limit: 100, // 100 requests per minute
    }]),

    // Application modules
    CoreModule,
    RbacModule,
    CmsModule,
    ModulesModule,
    MigrationsModule,
    SecurityModule,
    PerformanceModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

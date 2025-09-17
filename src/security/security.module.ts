import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';
import { AuthGuard, RolesGuard, PermissionsGuard, MfaGuard, ApiKeyGuard, RateLimitGuard } from './guards/auth.guard';
import { SecurityHeadersInterceptor, AuditLogInterceptor, DataSanitizationInterceptor, RequestIdInterceptor } from './interceptors/security.interceptors';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { defaultSecurityConfig } from './security.config';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || defaultSecurityConfig.jwt.secret,
        signOptions: {
          expiresIn: defaultSecurityConfig.jwt.expiresIn,
          issuer: defaultSecurityConfig.jwt.issuer,
          audience: defaultSecurityConfig.jwt.audience,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    MfaGuard,
    ApiKeyGuard,
    RateLimitGuard,
    SecurityHeadersInterceptor,
    AuditLogInterceptor,
    DataSanitizationInterceptor,
    RequestIdInterceptor,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SecurityHeadersInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DataSanitizationInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
  ],
  exports: [
    SecurityService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    MfaGuard,
    ApiKeyGuard,
    RateLimitGuard,
  ],
})
export class SecurityModule {}

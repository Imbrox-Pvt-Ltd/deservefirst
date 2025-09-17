import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantService } from './services/tenant.service';
import { TenantSettingsService } from './services/tenant-settings.service';
import { TenantController } from './controllers/tenant.controller';
import { TenantSettingsController } from './controllers/tenant-settings.controller';
import { Tenant } from './entities/tenant.entity';
import { TenantSettings } from './entities/tenant-settings.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      TenantSettings,
    ]),
  ],
  controllers: [
    TenantController,
    TenantSettingsController,
  ],
  providers: [
    TenantService,
    TenantSettingsService,
  ],
  exports: [
    TenantService,
    TenantSettingsService,
  ],
})
export class TenantModule {}

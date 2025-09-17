import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Services
import { CoreService } from './services/core.service';
import { DatabaseService } from './services/database.service';
import { CacheService } from './services/cache.service';
import { EventService } from './services/event.service';
import { HookService } from './services/hook.service';
import { I18nService } from './services/i18n.service';
import { ConfigService } from './services/config.service';

// Controllers
import { CoreController } from './controllers/core.controller';
import { HealthController } from './controllers/health.controller';
import { MetricsController } from './controllers/metrics.controller';

// Entities
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { Setting } from './entities/setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User, Setting]),
  ],
  controllers: [
    CoreController,
    HealthController,
    MetricsController,
  ],
  providers: [
    CoreService,
    DatabaseService,
    CacheService,
    EventService,
    HookService,
    I18nService,
    ConfigService,
  ],
  exports: [
    CoreService,
    DatabaseService,
    CacheService,
    EventService,
    HookService,
    I18nService,
    ConfigService,
  ],
})
export class CoreModule {}

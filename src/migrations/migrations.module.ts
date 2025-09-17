import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SimpleMigrationManagerService } from './simple-migration-manager.service';
import { ModuleVersionManagerService } from './module-version-manager.service';
import { SimpleMigrationsController } from './simple-migrations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Add migration entities here when created
    ]),
  ],
  controllers: [SimpleMigrationsController],
  providers: [
    SimpleMigrationManagerService,
    ModuleVersionManagerService,
  ],
  exports: [
    SimpleMigrationManagerService,
    ModuleVersionManagerService,
  ],
})
export class MigrationsModule {}

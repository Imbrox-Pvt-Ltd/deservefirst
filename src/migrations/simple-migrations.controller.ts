import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SimpleMigrationManagerService } from './simple-migration-manager.service';
import { ModuleVersionManagerService } from './module-version-manager.service';

@ApiTags('migrations')
@Controller('migrations')
export class SimpleMigrationsController {
  constructor(
    private migrationManager: SimpleMigrationManagerService,
    private versionManager: ModuleVersionManagerService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get migration status for all modules' })
  @ApiResponse({ status: 200, description: 'Migration status retrieved successfully' })
  async getMigrationStatus() {
    return this.migrationManager.getMigrationStatus();
  }

  @Get('versions')
  @ApiOperation({ summary: 'Get version information for all modules' })
  @ApiResponse({ status: 200, description: 'Version information retrieved successfully' })
  async getVersionStatus() {
    return this.versionManager.getVersionStatus();
  }

  @Get('versions/:moduleName')
  @ApiOperation({ summary: 'Get version information for a specific module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiResponse({ status: 200, description: 'Module version information retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Module not found' })
  async getModuleVersion(@Param('moduleName') moduleName: string) {
    const versionInfo = this.versionManager.getModuleVersion(moduleName);
    if (!versionInfo) {
      return { success: false, message: `Module ${moduleName} not found` };
    }
    return { success: true, versionInfo };
  }

  @Get('modules/:moduleName')
  @ApiOperation({ summary: 'Get migrations for a specific module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiResponse({ status: 200, description: 'Module migrations retrieved successfully' })
  async getModuleMigrations(@Param('moduleName') moduleName: string) {
    const migrations = this.migrationManager.getMigrationsForModule(moduleName);
    return {
      moduleName,
      migrations,
      count: migrations.length,
    };
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all migrations' })
  @ApiResponse({ status: 200, description: 'All migrations retrieved successfully' })
  async getAllMigrations() {
    const migrations = this.migrationManager.getAllMigrations();
    return {
      migrations,
      count: migrations.length,
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get migration system health' })
  @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
  async getMigrationHealth() {
    const migrationStatus = await this.migrationManager.getMigrationStatus();
    const versionStatus = this.versionManager.getVersionStatus();
    
    return {
      migrationSystem: {
        totalMigrations: migrationStatus.totalMigrations,
        completedMigrations: migrationStatus.completedMigrations,
        failedMigrations: migrationStatus.failedMigrations,
        pendingMigrations: migrationStatus.pendingMigrations,
        health: migrationStatus.failedMigrations === 0 ? 'healthy' : 'degraded',
      },
      versionSystem: {
        totalModules: versionStatus.totalModules,
        upToDate: versionStatus.upToDate,
        needsUpdate: versionStatus.needsUpdate,
        needsDowngrade: versionStatus.needsDowngrade,
        error: versionStatus.error,
        health: versionStatus.error === 0 ? 'healthy' : 'degraded',
      },
      overallHealth: migrationStatus.failedMigrations === 0 && versionStatus.error === 0 ? 'healthy' : 'degraded',
    };
  }
}

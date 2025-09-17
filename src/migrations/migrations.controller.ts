import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SimpleMigrationManagerService } from './simple-migration-manager.service';
import { ModuleVersionManagerService } from './module-version-manager.service';

@ApiTags('migrations')
@Controller('migrations')
export class MigrationsController {
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

  @Get('updates')
  @ApiOperation({ summary: 'Get modules that need updates' })
  @ApiResponse({ status: 200, description: 'Update information retrieved successfully' })
  async getModulesNeedingUpdate() {
    const modules = this.versionManager.getModulesNeedingUpdate();
    return {
      count: modules.length,
      modules: modules.map(m => ({
        moduleName: m.moduleName,
        currentVersion: m.currentVersion,
        latestVersion: m.latestVersion,
        breakingChanges: m.breakingChanges.length,
        newFeatures: m.newFeatures.length,
        bugFixes: m.bugFixes.length,
      })),
    };
  }

  @Get('downgrades')
  @ApiOperation({ summary: 'Get modules that need downgrades' })
  @ApiResponse({ status: 200, description: 'Downgrade information retrieved successfully' })
  async getModulesNeedingDowngrade() {
    const modules = this.versionManager.getModulesNeedingDowngrade();
    return {
      count: modules.length,
      modules: modules.map(m => ({
        moduleName: m.moduleName,
        currentVersion: m.currentVersion,
        latestVersion: m.latestVersion,
      })),
    };
  }

  @Get('plan/:moduleName')
  @ApiOperation({ summary: 'Get migration plan for a module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiQuery({ name: 'targetVersion', description: 'Target version' })
  @ApiResponse({ status: 200, description: 'Migration plan retrieved successfully' })
  async getMigrationPlan(
    @Param('moduleName') moduleName: string,
    @Query('targetVersion') targetVersion: string,
  ) {
    if (!targetVersion) {
      return { success: false, message: 'Target version is required' };
    }

    try {
      const plan = await this.migrationManager.getMigrationPlan(moduleName, targetVersion);
      return { success: true, plan };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  @Get('update-plan/:moduleName')
  @ApiOperation({ summary: 'Get update plan for a module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiQuery({ name: 'targetVersion', description: 'Target version' })
  @ApiResponse({ status: 200, description: 'Update plan retrieved successfully' })
  async getUpdatePlan(
    @Param('moduleName') moduleName: string,
    @Query('targetVersion') targetVersion: string,
  ) {
    if (!targetVersion) {
      return { success: false, message: 'Target version is required' };
    }

    try {
      const plan = this.versionManager.getUpdatePlan(moduleName, targetVersion);
      return { success: true, plan };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  @Post('execute/:moduleName')
  @ApiOperation({ summary: 'Execute migration for a module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        targetVersion: { type: 'string' },
        createBackup: { type: 'boolean', default: true },
        force: { type: 'boolean', default: false },
      },
      required: ['targetVersion'],
    },
  })
  @ApiResponse({ status: 200, description: 'Migration executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async executeMigration(
    @Param('moduleName') moduleName: string,
    @Body() body: { targetVersion: string; createBackup?: boolean; force?: boolean },
  ) {
    const { targetVersion, createBackup = true, force = false } = body;

    try {
      // Create backup if requested
      let backupName: string | undefined;
      if (createBackup) {
        backupName = await this.migrationManager.createBackup(moduleName);
      }

      // Get migration plan
      const plan = await this.migrationManager.getMigrationPlan(moduleName, targetVersion);
      
      if (plan.status === 'blocked' && !force) {
        return { 
          success: false, 
          message: 'Migration is blocked by dependencies. Use force=true to override.' 
        };
      }

      // Execute migration
      const result = await this.migrationManager.executeMigrationPlan(plan);
      
      if (result.success) {
        // Update module version
        await this.versionManager.updateModuleVersion(moduleName, targetVersion);
      }

      return {
        ...result,
        backupName,
        plan: {
          moduleName: plan.moduleName,
          fromVersion: plan.fromVersion,
          toVersion: plan.toVersion,
          migrationsCount: plan.migrations.length,
          estimatedTime: plan.estimatedTime,
        },
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  @Post('rollback/:moduleName')
  @ApiOperation({ summary: 'Rollback module to previous version' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        targetVersion: { type: 'string' },
        backupName: { type: 'string' },
      },
      required: ['targetVersion'],
    },
  })
  @ApiResponse({ status: 200, description: 'Rollback executed successfully' })
  async rollbackModule(
    @Param('moduleName') moduleName: string,
    @Body() body: { targetVersion: string; backupName?: string },
  ) {
    const { targetVersion, backupName } = body;

    try {
      // Restore from backup if provided
      if (backupName) {
        const restoreResult = await this.migrationManager.restoreFromBackup(backupName);
        if (!restoreResult.success) {
          return restoreResult;
        }
      }

      // Execute rollback
      const result = await this.migrationManager.rollbackModule(moduleName, targetVersion);
      
      if (result.success) {
        // Update module version
        await this.versionManager.updateModuleVersion(moduleName, targetVersion);
      }

      return result;

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  @Get('dependencies/:moduleName')
  @ApiOperation({ summary: 'Get version dependencies for a module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiResponse({ status: 200, description: 'Dependencies retrieved successfully' })
  async getVersionDependencies(@Param('moduleName') moduleName: string) {
    const dependencies = this.versionManager.getVersionDependencies(moduleName);
    return {
      moduleName,
      dependencies,
      count: dependencies.length,
    };
  }

  @Post('backup/:moduleName')
  @ApiOperation({ summary: 'Create backup for a module' })
  @ApiParam({ name: 'moduleName', description: 'Module name' })
  @ApiResponse({ status: 200, description: 'Backup created successfully' })
  async createBackup(@Param('moduleName') moduleName: string) {
    try {
      const backupName = await this.migrationManager.createBackup(moduleName);
      return { success: true, backupName, message: `Backup created: ${backupName}` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  @Post('restore/:backupName')
  @ApiOperation({ summary: 'Restore from backup' })
  @ApiParam({ name: 'backupName', description: 'Backup name' })
  @ApiResponse({ status: 200, description: 'Restore executed successfully' })
  async restoreFromBackup(@Param('backupName') backupName: string) {
    try {
      const result = await this.migrationManager.restoreFromBackup(backupName);
      return result;
    } catch (error) {
      return { success: false, message: error.message };
    }
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

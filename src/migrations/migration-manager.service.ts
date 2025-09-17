import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface Migration {
  id: string;
  moduleName: string;
  version: string;
  name: string;
  description: string;
  type: 'up' | 'down';
  sql: string;
  dependencies: string[];
  executedAt?: Date;
  executionTime?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  error?: string;
}

export interface ModuleVersion {
  moduleName: string;
  currentVersion: string;
  targetVersion: string;
  migrations: Migration[];
  dependencies: string[];
  status: 'up_to_date' | 'needs_update' | 'needs_downgrade' | 'error';
}

export interface MigrationPlan {
  moduleName: string;
  fromVersion: string;
  toVersion: string;
  migrations: Migration[];
  estimatedTime: number;
  rollbackPlan: Migration[];
  dependencies: string[];
  status: 'ready' | 'blocked' | 'error';
}

@Injectable()
export class MigrationManagerService {
  private readonly logger = new Logger(MigrationManagerService.name);
  private migrations = new Map<string, Migration[]>();
  private moduleVersions = new Map<string, ModuleVersion>();

  constructor(
    private dataSource: DataSource,
    // @InjectRepository(Migration)
    // private migrationRepository: Repository<Migration>,
  ) {}

  /**
   * Initialize migration system
   */
  async initialize(): Promise<void> {
    this.logger.log('🔄 Initializing migration system...');
    
    // Create migrations table if it doesn't exist
    await this.createMigrationsTable();
    
    // Load existing migrations
    await this.loadExistingMigrationsFromDB();
    
    // Discover module migrations
    await this.discoverModuleMigrationsFromFS();
    
    this.logger.log('✅ Migration system initialized');
  }

  /**
   * Create migrations table
   */
  private async createMigrationsTable(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      
      const tableExists = await queryRunner.hasTable('migrations');
      if (!tableExists) {
        await queryRunner.query(`
          CREATE TABLE migrations (
            id VARCHAR(255) PRIMARY KEY,
            module_name VARCHAR(255) NOT NULL,
            version VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            type ENUM('up', 'down') NOT NULL,
            sql TEXT NOT NULL,
            dependencies JSON,
            executed_at TIMESTAMP NULL,
            execution_time INT NULL,
            status ENUM('pending', 'running', 'completed', 'failed', 'rolled_back') DEFAULT 'pending',
            error TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);
        
        this.logger.log('📊 Created migrations table');
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Load existing migrations from database
   */
  private async loadExistingMigrationsFromDB(): Promise<void> {
    try {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      
      const migrations = await queryRunner.query(`
        SELECT * FROM migrations 
        ORDER BY module_name, version, type
      `);
      
      for (const migration of migrations) {
        const key = `${migration.module_name}-${migration.version}`;
        if (!this.migrations.has(key)) {
          this.migrations.set(key, []);
        }
        
        this.migrations.get(key)!.push({
          id: migration.id,
          moduleName: migration.module_name,
          version: migration.version,
          name: migration.name,
          description: migration.description,
          type: migration.type as 'up' | 'down',
          sql: migration.sql,
          dependencies: JSON.parse(migration.dependencies || '[]'),
          executedAt: migration.executed_at,
          executionTime: migration.execution_time,
          status: migration.status,
          error: migration.error,
        });
      }
      
      await queryRunner.release();
      this.logger.log(`📦 Loaded ${migrations.length} existing migrations`);
      
    } catch (error) {
      this.logger.warn('Could not load existing migrations:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Discover module migrations
   */
  private async discoverModuleMigrationsFromFS(): Promise<void> {
    const modulesPath = path.join(process.cwd(), 'modules', '@deservefirst');
    
    if (!fs.existsSync(modulesPath)) {
      this.logger.warn('Modules directory not found');
      return;
    }

    const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const moduleName of moduleDirs) {
      await this.discoverModuleMigrationsFromFS(moduleName);
    }
  }

  /**
   * Discover migrations for a specific module
   */
  private async discoverModuleMigrationsFromFS(moduleName: string): Promise<void> {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', moduleName);
    const migrationsPath = path.join(modulePath, 'migrations');
    
    if (!fs.existsSync(migrationsPath)) {
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      await this.loadMigrationFile(moduleName, file);
    }
  }

  /**
   * Load migration file
   */
  private async loadMigrationFile(moduleName: string, filename: string): Promise<void> {
    try {
      const filePath = path.join(process.cwd(), 'modules', '@deservefirst', moduleName, 'migrations', filename);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Parse migration file (format: V{version}__{name}.sql)
      const match = filename.match(/^V(\d+(?:\.\d+)*)__(.+)\.sql$/);
      if (!match) {
        this.logger.warn(`Invalid migration filename format: ${filename}`);
        return;
      }

      const version = match[1];
      const name = match[2].replace(/_/g, ' ');
      
      // Split content into up and down migrations
      const sections = content.split('-- DOWN');
      const upSql = sections[0].replace(/^-- UP\s*/, '').trim();
      const downSql = sections[1] ? sections[1].trim() : '';

      const migrationId = `${moduleName}-${version}`;
      
      // Create up migration
      const upMigration: Migration = {
        id: `${migrationId}-up`,
        moduleName,
        version,
        name: `${name} (Up)`,
        description: `Up migration for ${name}`,
        type: 'up',
        sql: upSql,
        dependencies: [],
        status: 'pending',
      };

      // Create down migration
      const downMigration: Migration = {
        id: `${migrationId}-down`,
        moduleName,
        version,
        name: `${name} (Down)`,
        description: `Down migration for ${name}`,
        type: 'down',
        sql: downSql,
        dependencies: [],
        status: 'pending',
      };

      // Store migrations
      if (!this.migrations.has(migrationId)) {
        this.migrations.set(migrationId, []);
      }
      
      this.migrations.get(migrationId)!.push(upMigration, downMigration);
      
      this.logger.log(`📄 Loaded migration: ${moduleName}@${version} - ${name}`);
      
    } catch (error) {
      this.logger.error(`Error loading migration file ${filename}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get migration plan for a module
   */
  async getMigrationPlan(moduleName: string, targetVersion: string): Promise<MigrationPlan> {
    const currentVersion = await this.getCurrentModuleVersion(moduleName);
    const migrations = this.getMigrationsForModule(moduleName);
    
    const plan: MigrationPlan = {
      moduleName,
      fromVersion: currentVersion,
      toVersion: targetVersion,
      migrations: [],
      estimatedTime: 0,
      rollbackPlan: [],
      dependencies: [],
      status: 'ready',
    };

    if (currentVersion === targetVersion) {
      return plan;
    }

    // Determine if we need to upgrade or downgrade
    const needsUpgrade = this.compareVersions(targetVersion, currentVersion) > 0;
    
    if (needsUpgrade) {
      plan.migrations = this.getUpgradeMigrations(moduleName, currentVersion, targetVersion);
    } else {
      plan.migrations = this.getDowngradeMigrations(moduleName, currentVersion, targetVersion);
    }

    // Calculate estimated time
    plan.estimatedTime = plan.migrations.length * 1000; // 1 second per migration

    // Create rollback plan
    plan.rollbackPlan = this.createRollbackPlan(plan.migrations);

    return plan;
  }

  /**
   * Execute migration plan
   */
  async executeMigrationPlan(plan: MigrationPlan): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🚀 Executing migration plan for ${plan.moduleName}: ${plan.fromVersion} → ${plan.toVersion}`);

    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      for (const migration of plan.migrations) {
        await this.executeMigration(queryRunner, migration);
      }

      await queryRunner.commitTransaction();
      
      this.logger.log(`✅ Migration plan completed for ${plan.moduleName}`);
      return { success: true, message: `Successfully migrated ${plan.moduleName} to ${plan.toVersion}` };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Migration plan failed for ${plan.moduleName}:`, error);
      return { success: false, message: `Migration failed: ${error.message}` };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(queryRunner: QueryRunner, migration: Migration): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`🔄 Executing migration: ${migration.name}`);
      
      // Update migration status to running
      await this.updateMigrationStatus(queryRunner, migration.id, 'running');
      
      // Execute SQL
      await queryRunner.query(migration.sql);
      
      // Update migration status to completed
      const executionTime = Date.now() - startTime;
      await this.updateMigrationStatus(queryRunner, migration.id, 'completed', executionTime);
      
      this.logger.log(`✅ Migration completed: ${migration.name} (${executionTime}ms)`);
      
    } catch (error) {
      // Update migration status to failed
      await this.updateMigrationStatus(queryRunner, migration.id, 'failed', undefined, error.message);
      throw error;
    }
  }

  /**
   * Update migration status in database
   */
  private async updateMigrationStatus(
    queryRunner: QueryRunner, 
    migrationId: string, 
    status: string, 
    executionTime?: number, 
    error?: string
  ): Promise<void> {
    await queryRunner.query(`
      INSERT INTO migrations (id, module_name, version, name, description, type, sql, dependencies, executed_at, execution_time, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        executed_at = VALUES(executed_at),
        execution_time = VALUES(execution_time),
        status = VALUES(status),
        error = VALUES(error),
        updated_at = CURRENT_TIMESTAMP
    `, [
      migrationId,
      '', // module_name
      '', // version
      '', // name
      '', // description
      '', // type
      '', // sql
      '[]', // dependencies
      new Date(),
      executionTime,
      status,
      error,
    ]);
  }

  /**
   * Get current module version
   */
  private async getCurrentModuleVersion(moduleName: string): Promise<string> {
    // TODO: Implement actual version tracking
    return '1.0.0';
  }

  /**
   * Get migrations for a module
   */
  private getMigrationsForModule(moduleName: string): Migration[] {
    const migrations: Migration[] = [];
    
    for (const [key, moduleMigrations] of this.migrations) {
      if (key.startsWith(moduleName)) {
        migrations.push(...moduleMigrations);
      }
    }
    
    return migrations.sort((a, b) => this.compareVersions(a.version, b.version));
  }

  /**
   * Get upgrade migrations
   */
  private getUpgradeMigrations(moduleName: string, fromVersion: string, toVersion: string): Migration[] {
    const migrations = this.getMigrationsForModule(moduleName);
    return migrations.filter(m => 
      m.type === 'up' && 
      this.compareVersions(m.version, fromVersion) > 0 && 
      this.compareVersions(m.version, toVersion) <= 0
    );
  }

  /**
   * Get downgrade migrations
   */
  private getDowngradeMigrations(moduleName: string, fromVersion: string, toVersion: string): Migration[] {
    const migrations = this.getMigrationsForModule(moduleName);
    return migrations.filter(m => 
      m.type === 'down' && 
      this.compareVersions(m.version, fromVersion) <= 0 && 
      this.compareVersions(m.version, toVersion) > 0
    ).reverse();
  }

  /**
   * Create rollback plan
   */
  private createRollbackPlan(migrations: Migration[]): Migration[] {
    return migrations.map(m => ({
      ...m,
      type: m.type === 'up' ? 'down' : 'up',
    })).reverse();
  }

  /**
   * Compare version strings
   */
  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;
      
      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }
    
    return 0;
  }

  /**
   * Get migration status for all modules
   */
  async getMigrationStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {
      totalMigrations: 0,
      completedMigrations: 0,
      failedMigrations: 0,
      pendingMigrations: 0,
      modules: {},
    };

    for (const [key, migrations] of this.migrations) {
      const moduleName = key.split('-')[0];
      
      if (!status.modules[moduleName]) {
        status.modules[moduleName] = {
          total: 0,
          completed: 0,
          failed: 0,
          pending: 0,
          migrations: [],
        };
      }

      for (const migration of migrations) {
        status.totalMigrations++;
        status.modules[moduleName].total++;
        
        switch (migration.status) {
          case 'completed':
            status.completedMigrations++;
            status.modules[moduleName].completed++;
            break;
          case 'failed':
            status.failedMigrations++;
            status.modules[moduleName].failed++;
            break;
          case 'pending':
            status.pendingMigrations++;
            status.modules[moduleName].pending++;
            break;
        }

        status.modules[moduleName].migrations.push({
          id: migration.id,
          version: migration.version,
          name: migration.name,
          status: migration.status,
          executedAt: migration.executedAt,
          executionTime: migration.executionTime,
        });
      }
    }

    return status;
  }

  /**
   * Rollback module to previous version
   */
  async rollbackModule(moduleName: string, targetVersion: string): Promise<{ success: boolean; message: string }> {
    const plan = await this.getMigrationPlan(moduleName, targetVersion);
    return this.executeMigrationPlan(plan);
  }

  /**
   * Create backup before migration
   */
  async createBackup(moduleName: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${moduleName}-backup-${timestamp}`;
    
    // TODO: Implement actual database backup
    this.logger.log(`💾 Creating backup: ${backupName}`);
    
    return backupName;
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupName: string): Promise<{ success: boolean; message: string }> {
    // TODO: Implement actual database restore
    this.logger.log(`🔄 Restoring from backup: ${backupName}`);
    
    return { success: true, message: `Restored from backup: ${backupName}` };
  }
}

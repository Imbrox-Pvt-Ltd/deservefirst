import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface SimpleMigration {
  id: string;
  moduleName: string;
  version: string;
  name: string;
  description: string;
  type: 'up' | 'down';
  sql: string;
  status: 'pending' | 'completed' | 'failed';
  executedAt?: Date;
  error?: string;
}

@Injectable()
export class SimpleMigrationManagerService {
  private readonly logger = new Logger(SimpleMigrationManagerService.name);
  private migrations = new Map<string, SimpleMigration[]>();

  constructor(private dataSource: DataSource) {}

  /**
   * Initialize migration system
   */
  async initialize(): Promise<void> {
    this.logger.log('🔄 Initializing simple migration system...');
    
    // Create migrations table if it doesn't exist
    await this.createMigrationsTable();
    
    // Discover module migrations
    await this.discoverModuleMigrations();
    
    this.logger.log('✅ Simple migration system initialized');
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
            \`sql\` TEXT NOT NULL,
            status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
            executed_at TIMESTAMP NULL,
            error TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        this.logger.log('📊 Created migrations table');
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Discover module migrations
   */
  private async discoverModuleMigrations(): Promise<void> {
    const modulesPath = path.join(process.cwd(), 'modules', '@deservefirst');
    
    if (!fs.existsSync(modulesPath)) {
      this.logger.warn('Modules directory not found');
      return;
    }

    const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const moduleName of moduleDirs) {
      await this.discoverModuleMigrationsForModule(moduleName);
    }
  }

  /**
   * Discover migrations for a specific module
   */
  private async discoverModuleMigrationsForModule(moduleName: string): Promise<void> {
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
      const upMigration: SimpleMigration = {
        id: `${migrationId}-up`,
        moduleName,
        version,
        name: `${name} (Up)`,
        description: `Up migration for ${name}`,
        type: 'up',
        sql: upSql,
        status: 'pending',
      };

      // Create down migration
      const downMigration: SimpleMigration = {
        id: `${migrationId}-down`,
        moduleName,
        version,
        name: `${name} (Down)`,
        description: `Down migration for ${name}`,
        type: 'down',
        sql: downSql,
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
   * Get migration status
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
        });
      }
    }

    return status;
  }

  /**
   * Get migrations for a module
   */
  getMigrationsForModule(moduleName: string): SimpleMigration[] {
    const migrations: SimpleMigration[] = [];
    
    for (const [key, moduleMigrations] of this.migrations) {
      if (key.startsWith(moduleName)) {
        migrations.push(...moduleMigrations);
      }
    }
    
    return migrations.sort((a, b) => this.compareVersions(a.version, b.version));
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
   * Get all migrations
   */
  getAllMigrations(): SimpleMigration[] {
    const migrations: SimpleMigration[] = [];
    
    for (const [, moduleMigrations] of this.migrations) {
      migrations.push(...moduleMigrations);
    }
    
    return migrations;
  }
}

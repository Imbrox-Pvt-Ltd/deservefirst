# Database Migration & Module Versioning Strategy

## 🎯 Overview
**Zero-downtime database migrations** with **automatic module versioning** that allows upgrading/downgrading modules without manual database changes.

## 🏗️ **Migration System Architecture**

### **1. Versioned Schema Management**
```typescript
// src/core/migrations/versioned-schema.service.ts
@Injectable()
export class VersionedSchemaService {
  private schemaVersions = new Map<string, SchemaVersion>();
  private migrationHistory = new Map<string, MigrationRecord[]>();

  async upgradeModule(moduleName: string, fromVersion: string, toVersion: string) {
    // 1. Check if upgrade path exists
    const upgradePath = await this.getUpgradePath(moduleName, fromVersion, toVersion);
    if (!upgradePath) {
      throw new Error(`No upgrade path from ${fromVersion} to ${toVersion}`);
    }

    // 2. Execute migrations in order
    for (const migration of upgradePath) {
      await this.executeMigration(migration);
    }

    // 3. Update module version
    await this.updateModuleVersion(moduleName, toVersion);
  }

  async downgradeModule(moduleName: string, fromVersion: string, toVersion: string) {
    // 1. Check if downgrade path exists
    const downgradePath = await this.getDowngradePath(moduleName, fromVersion, toVersion);
    if (!downgradePath) {
      throw new Error(`No downgrade path from ${fromVersion} to ${toVersion}`);
    }

    // 2. Execute rollback migrations in reverse order
    for (const migration of downgradePath.reverse()) {
      await this.executeRollback(migration);
    }

    // 3. Update module version
    await this.updateModuleVersion(moduleName, toVersion);
  }
}
```

### **2. Module Version Registry**
```typescript
// src/core/migrations/module-version-registry.service.ts
@Injectable()
export class ModuleVersionRegistry {
  private moduleVersions = new Map<string, ModuleVersionInfo>();

  async registerModuleVersion(moduleName: string, version: string, schema: SchemaDefinition) {
    const versionInfo: ModuleVersionInfo = {
      moduleName,
      version,
      schema,
      migrations: [],
      rollbacks: [],
      dependencies: [],
      createdAt: new Date(),
      isActive: false
    };

    this.moduleVersions.set(`${moduleName}@${version}`, versionInfo);
  }

  async getModuleVersion(moduleName: string, version: string): Promise<ModuleVersionInfo> {
    return this.moduleVersions.get(`${moduleName}@${version}`);
  }

  async getInstalledVersion(moduleName: string): Promise<string> {
    const installed = await this.database.findOne('module_versions', { moduleName, isActive: true });
    return installed?.version;
  }

  async getAvailableVersions(moduleName: string): Promise<string[]> {
    const versions = Array.from(this.moduleVersions.keys())
      .filter(key => key.startsWith(`${moduleName}@`))
      .map(key => key.split('@')[1])
      .sort((a, b) => this.compareVersions(a, b));
    
    return versions;
  }
}
```

## 🔄 **Migration Types**

### **1. Forward Migrations (Upgrade)**
```typescript
// packages/deservefirst/cms-module/src/migrations/v1.0.0_to_v1.1.0.ts
export class CmsModuleV1_0_0_ToV1_1_0Migration implements Migration {
  version = '1.1.0';
  fromVersion = '1.0.0';
  moduleName = 'cms-module';

  async up(database: Database): Promise<void> {
    // Add new column
    await database.execute(`
      ALTER TABLE pages 
      ADD COLUMN seo_title VARCHAR(255) AFTER meta_title,
      ADD COLUMN seo_description TEXT AFTER meta_description
    `);

    // Create new table
    await database.execute(`
      CREATE TABLE page_versions (
        id VARCHAR(36) PRIMARY KEY,
        page_id VARCHAR(36) NOT NULL,
        version_number INT NOT NULL,
        content LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(36),
        tenant_id VARCHAR(36) NOT NULL,
        INDEX idx_page_versions_page_id (page_id),
        INDEX idx_page_versions_tenant_id (tenant_id)
      )
    `);

    // Migrate existing data
    await database.execute(`
      UPDATE pages 
      SET seo_title = meta_title, 
          seo_description = meta_description 
      WHERE seo_title IS NULL
    `);
  }

  async down(database: Database): Promise<void> {
    // Remove new column
    await database.execute(`
      ALTER TABLE pages 
      DROP COLUMN seo_title,
      DROP COLUMN seo_description
    `);

    // Drop new table
    await database.execute(`DROP TABLE page_versions`);
  }
}
```

### **2. Backward Migrations (Downgrade)**
```typescript
// packages/deservefirst/cms-module/src/migrations/v1.1.0_to_v1.0.0.ts
export class CmsModuleV1_1_0_ToV1_0_0Migration implements Migration {
  version = '1.0.0';
  fromVersion = '1.1.0';
  moduleName = 'cms-module';

  async up(database: Database): Promise<void> {
    // This is the rollback for the upgrade
    await database.execute(`
      ALTER TABLE pages 
      DROP COLUMN seo_title,
      DROP COLUMN seo_description
    `);

    await database.execute(`DROP TABLE page_versions`);
  }

  async down(database: Database): Promise<void> {
    // This is the forward migration
    await database.execute(`
      ALTER TABLE pages 
      ADD COLUMN seo_title VARCHAR(255) AFTER meta_title,
      ADD COLUMN seo_description TEXT AFTER meta_description
    `);

    await database.execute(`
      CREATE TABLE page_versions (
        id VARCHAR(36) PRIMARY KEY,
        page_id VARCHAR(36) NOT NULL,
        version_number INT NOT NULL,
        content LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(36),
        tenant_id VARCHAR(36) NOT NULL,
        INDEX idx_page_versions_page_id (page_id),
        INDEX idx_page_versions_tenant_id (tenant_id)
      )
    `);
  }
}
```

### **3. Zero-Downtime Migrations**
```typescript
// packages/deservefirst/cms-module/src/migrations/v1.2.0_to_v1.3.0.ts
export class CmsModuleV1_2_0_ToV1_3_0Migration implements ZeroDowntimeMigration {
  version = '1.3.0';
  fromVersion = '1.2.0';
  moduleName = 'cms-module';
  requiresDowntime = false;

  async up(database: Database): Promise<void> {
    // Step 1: Add new column as nullable
    await database.execute(`
      ALTER TABLE pages 
      ADD COLUMN new_field VARCHAR(255) NULL
    `);

    // Step 2: Populate new column in batches
    await this.populateNewFieldInBatches(database);

    // Step 3: Make column non-nullable
    await database.execute(`
      ALTER TABLE pages 
      MODIFY COLUMN new_field VARCHAR(255) NOT NULL
    `);

    // Step 4: Add index
    await database.execute(`
      CREATE INDEX idx_pages_new_field ON pages (new_field)
    `);
  }

  private async populateNewFieldInBatches(database: Database): Promise<void> {
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const pages = await database.execute(`
        SELECT id, old_field FROM pages 
        WHERE new_field IS NULL 
        LIMIT ${batchSize} OFFSET ${offset}
      `);

      if (pages.length === 0) {
        hasMore = false;
        break;
      }

      for (const page of pages) {
        await database.execute(`
          UPDATE pages 
          SET new_field = ? 
          WHERE id = ?
        `, [this.transformOldField(page.old_field), page.id]);
      }

      offset += batchSize;
    }
  }
}
```

## 🔧 **Module Version Management**

### **1. Module Version Definition**
```typescript
// packages/deservefirst/cms-module/src/versions/module-versions.ts
export const CmsModuleVersions = {
  '1.0.0': {
    schema: {
      tables: ['pages', 'blocks', 'url_rewrites'],
      columns: {
        pages: ['id', 'tenant_id', 'title', 'content', 'created_at'],
        blocks: ['id', 'tenant_id', 'identifier', 'content', 'created_at']
      }
    },
    migrations: ['v1.0.0_to_v1.1.0'],
    dependencies: ['core-module@^1.0.0'],
    breakingChanges: []
  },
  '1.1.0': {
    schema: {
      tables: ['pages', 'blocks', 'url_rewrites', 'page_versions'],
      columns: {
        pages: ['id', 'tenant_id', 'title', 'content', 'seo_title', 'seo_description', 'created_at'],
        blocks: ['id', 'tenant_id', 'identifier', 'content', 'created_at'],
        page_versions: ['id', 'page_id', 'version_number', 'content', 'created_at', 'created_by', 'tenant_id']
      }
    },
    migrations: ['v1.1.0_to_v1.2.0'],
    dependencies: ['core-module@^1.0.0'],
    breakingChanges: ['seo_title', 'seo_description']
  },
  '1.2.0': {
    schema: {
      tables: ['pages', 'blocks', 'url_rewrites', 'page_versions', 'custom_fields'],
      columns: {
        pages: ['id', 'tenant_id', 'title', 'content', 'seo_title', 'seo_description', 'created_at'],
        blocks: ['id', 'tenant_id', 'identifier', 'content', 'created_at'],
        page_versions: ['id', 'page_id', 'version_number', 'content', 'created_at', 'created_by', 'tenant_id'],
        custom_fields: ['id', 'tenant_id', 'store_id', 'entity_type', 'entity_id', 'fields', 'created_at']
      }
    },
    migrations: ['v1.2.0_to_v1.3.0'],
    dependencies: ['core-module@^1.0.0', 'rbac-module@^1.0.0'],
    breakingChanges: []
  }
};
```

### **2. Automatic Migration Detection**
```typescript
// src/core/migrations/auto-migration.service.ts
@Injectable()
export class AutoMigrationService {
  async checkAndRunMigrations(): Promise<void> {
    const installedModules = await this.getInstalledModules();
    
    for (const module of installedModules) {
      const currentVersion = await this.getCurrentVersion(module.name);
      const latestVersion = await this.getLatestVersion(module.name);
      
      if (this.shouldUpgrade(currentVersion, latestVersion)) {
        await this.upgradeModule(module.name, currentVersion, latestVersion);
      }
    }
  }

  async upgradeModule(moduleName: string, fromVersion: string, toVersion: string): Promise<void> {
    console.log(`🔄 Upgrading ${moduleName} from ${fromVersion} to ${toVersion}`);
    
    // 1. Check dependencies
    await this.checkDependencies(moduleName, toVersion);
    
    // 2. Run migrations
    await this.runMigrations(moduleName, fromVersion, toVersion);
    
    // 3. Update module version
    await this.updateModuleVersion(moduleName, toVersion);
    
    console.log(`✅ Successfully upgraded ${moduleName} to ${toVersion}`);
  }

  async downgradeModule(moduleName: string, fromVersion: string, toVersion: string): Promise<void> {
    console.log(`🔄 Downgrading ${moduleName} from ${fromVersion} to ${toVersion}`);
    
    // 1. Check if downgrade is safe
    await this.checkDowngradeSafety(moduleName, fromVersion, toVersion);
    
    // 2. Run rollback migrations
    await this.runRollbackMigrations(moduleName, fromVersion, toVersion);
    
    // 3. Update module version
    await this.updateModuleVersion(moduleName, toVersion);
    
    console.log(`✅ Successfully downgraded ${moduleName} to ${toVersion}`);
  }
}
```

## 🚀 **CLI Commands for Module Management**

### **1. Module Version Commands**
```bash
# Check module versions
npm run module:versions cms-module

# Upgrade module
npm run module:upgrade cms-module@1.2.0

# Downgrade module
npm run module:downgrade cms-module@1.1.0

# Check migration status
npm run module:migrate:status

# Run pending migrations
npm run module:migrate:run

# Rollback last migration
npm run module:migrate:rollback
```

### **2. Database Schema Commands**
```bash
# Generate migration for module
npm run module:migrate:generate cms-module

# Validate schema
npm run module:schema:validate

# Compare schemas
npm run module:schema:compare cms-module@1.1.0 cms-module@1.2.0

# Export schema
npm run module:schema:export cms-module@1.2.0
```

## 📊 **Migration Safety Features**

### **1. Pre-Migration Checks**
```typescript
// src/core/migrations/migration-safety.service.ts
@Injectable()
export class MigrationSafetyService {
  async validateMigration(moduleName: string, fromVersion: string, toVersion: string): Promise<ValidationResult> {
    const checks = [
      this.checkDependencies(moduleName, toVersion),
      this.checkBreakingChanges(moduleName, fromVersion, toVersion),
      this.checkDataIntegrity(moduleName, fromVersion, toVersion),
      this.checkDiskSpace(),
      this.checkBackupExists()
    ];

    const results = await Promise.all(checks);
    return this.aggregateResults(results);
  }

  async checkBreakingChanges(moduleName: string, fromVersion: string, toVersion: string): Promise<boolean> {
    const breakingChanges = await this.getBreakingChanges(moduleName, fromVersion, toVersion);
    
    if (breakingChanges.length > 0) {
      console.warn(`⚠️  Breaking changes detected:`, breakingChanges);
      return false;
    }
    
    return true;
  }
}
```

### **2. Automatic Backup**
```typescript
// src/core/migrations/backup.service.ts
@Injectable()
export class BackupService {
  async createBackup(moduleName: string, version: string): Promise<string> {
    const backupId = `backup_${moduleName}_${version}_${Date.now()}`;
    
    // Create database backup
    await this.createDatabaseBackup(backupId);
    
    // Create schema backup
    await this.createSchemaBackup(moduleName, version, backupId);
    
    // Store backup metadata
    await this.storeBackupMetadata(backupId, moduleName, version);
    
    return backupId;
  }

  async restoreBackup(backupId: string): Promise<void> {
    const backup = await this.getBackupMetadata(backupId);
    
    // Restore database
    await this.restoreDatabaseBackup(backupId);
    
    // Restore schema
    await this.restoreSchemaBackup(backup.moduleName, backup.version);
  }
}
```

## 🎯 **Benefits of This Approach**

### **1. Zero Manual Database Changes** ✅
- All schema changes handled automatically
- No need to manually run SQL scripts
- Version-controlled migrations

### **2. Safe Upgrades/Downgrades** ✅
- Pre-migration validation
- Automatic backups
- Rollback capabilities

### **3. Zero Downtime** ✅
- Online schema changes
- Batched data migrations
- Blue-green deployment support

### **4. Enterprise Grade** ✅
- Audit trail of all changes
- Compliance with data regulations
- Disaster recovery support

## 📝 **Example Usage**

```typescript
// Upgrade CMS module from 1.0.0 to 1.2.0
await migrationService.upgradeModule('cms-module', '1.0.0', '1.2.0');

// Downgrade if issues occur
await migrationService.downgradeModule('cms-module', '1.2.0', '1.1.0');

// Check what will change
const changes = await migrationService.previewChanges('cms-module', '1.0.0', '1.2.0');
console.log('Schema changes:', changes.schema);
console.log('Data migrations:', changes.migrations);
```

This system ensures **you never have to manually touch the database again** - everything is automated, versioned, and safe! 🚀

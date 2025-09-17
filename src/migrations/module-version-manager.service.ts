import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface ModuleVersionInfo {
  moduleName: string;
  currentVersion: string;
  installedVersion: string;
  latestVersion: string;
  isUpToDate: boolean;
  needsUpdate: boolean;
  needsDowngrade: boolean;
  dependencies: string[];
  dependents: string[];
  migrationPath: string[];
  status: 'active' | 'inactive' | 'error' | 'unknown';
  lastUpdated: Date;
  changelog: string[];
  breakingChanges: string[];
  newFeatures: string[];
  bugFixes: string[];
}

export interface VersionDependency {
  moduleName: string;
  requiredVersion: string;
  currentVersion: string;
  isCompatible: boolean;
  isRequired: boolean;
  isOptional: boolean;
}

@Injectable()
export class ModuleVersionManagerService {
  private readonly logger = new Logger(ModuleVersionManagerService.name);
  private moduleVersions = new Map<string, ModuleVersionInfo>();
  private versionDependencies = new Map<string, VersionDependency[]>();

  constructor(
    // @InjectRepository(ModuleVersionInfo)
    // private moduleVersionRepository: Repository<ModuleVersionInfo>,
  ) {}

  /**
   * Initialize version management
   */
  async initialize(): Promise<void> {
    this.logger.log('🔄 Initializing module version management...');
    
    await this.scanInstalledModules();
    await this.loadVersionDependencies();
    await this.checkForUpdates();
    
    this.logger.log('✅ Module version management initialized');
  }

  /**
   * Scan installed modules and their versions
   */
  private async scanInstalledModules(): Promise<void> {
    const modulesPath = path.join(process.cwd(), 'modules', '@deservefirst');
    
    if (!fs.existsSync(modulesPath)) {
      this.logger.warn('Modules directory not found');
      return;
    }

    const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const moduleName of moduleDirs) {
      await this.scanModuleVersion(moduleName);
    }
  }

  /**
   * Scan version information for a specific module
   */
  private async scanModuleVersion(moduleName: string): Promise<void> {
    try {
      const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', moduleName);
      const packageJsonPath = path.join(modulePath, 'package.json');
      
      if (!fs.existsSync(packageJsonPath)) {
        this.logger.warn(`Package.json not found for module: ${moduleName}`);
        return;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const deservefirstConfig = packageJson.deservefirst || {};
      
      const versionInfo: ModuleVersionInfo = {
        moduleName,
        currentVersion: packageJson.version || '0.0.0',
        installedVersion: packageJson.version || '0.0.0',
        latestVersion: await this.getLatestVersion(moduleName),
        isUpToDate: false,
        needsUpdate: false,
        needsDowngrade: false,
        dependencies: deservefirstConfig.dependencies || [],
        dependents: [],
        migrationPath: [],
        status: 'active',
        lastUpdated: new Date(),
        changelog: await this.getChangelog(moduleName),
        breakingChanges: [],
        newFeatures: [],
        bugFixes: [],
      };

      // Check if module is up to date
      versionInfo.isUpToDate = this.compareVersions(versionInfo.currentVersion, versionInfo.latestVersion) === 0;
      versionInfo.needsUpdate = this.compareVersions(versionInfo.latestVersion, versionInfo.currentVersion) > 0;
      versionInfo.needsDowngrade = this.compareVersions(versionInfo.latestVersion, versionInfo.currentVersion) < 0;

      // Parse changelog for breaking changes, new features, and bug fixes
      this.parseChangelog(versionInfo);

      this.moduleVersions.set(moduleName, versionInfo);
      
      this.logger.log(`📦 Scanned module: ${moduleName}@${versionInfo.currentVersion}`);
      
    } catch (error) {
      this.logger.error(`Error scanning module ${moduleName}:`, error);
    }
  }

  /**
   * Get latest version of a module
   */
  private async getLatestVersion(moduleName: string): Promise<string> {
    try {
      // TODO: Implement actual npm registry lookup
      // For now, return the current version
      const moduleInfo = this.moduleVersions.get(moduleName);
      return moduleInfo?.currentVersion || '0.0.0';
    } catch (error) {
      this.logger.warn(`Could not get latest version for ${moduleName}:`, error);
      return '0.0.0';
    }
  }

  /**
   * Get changelog for a module
   */
  private async getChangelog(moduleName: string): Promise<string[]> {
    try {
      const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', moduleName);
      const changelogPath = path.join(modulePath, 'CHANGELOG.md');
      
      if (!fs.existsSync(changelogPath)) {
        return [];
      }

      const changelogContent = fs.readFileSync(changelogPath, 'utf8');
      return changelogContent.split('\n').filter(line => line.trim().length > 0);
      
    } catch (error) {
      this.logger.warn(`Could not read changelog for ${moduleName}:`, error);
      return [];
    }
  }

  /**
   * Parse changelog for breaking changes, new features, and bug fixes
   */
  private parseChangelog(versionInfo: ModuleVersionInfo): void {
    const changelog = versionInfo.changelog;
    
    for (const line of changelog) {
      if (line.includes('BREAKING CHANGE') || line.includes('**BREAKING**')) {
        versionInfo.breakingChanges.push(line);
      } else if (line.includes('**Added**') || line.includes('**New**') || line.includes('✨')) {
        versionInfo.newFeatures.push(line);
      } else if (line.includes('**Fixed**') || line.includes('**Bug**') || line.includes('🐛')) {
        versionInfo.bugFixes.push(line);
      }
    }
  }

  /**
   * Load version dependencies
   */
  private async loadVersionDependencies(): Promise<void> {
    for (const [moduleName, versionInfo] of this.moduleVersions) {
      const dependencies: VersionDependency[] = [];
      
      for (const depName of versionInfo.dependencies) {
        const depVersionInfo = this.moduleVersions.get(depName);
        if (depVersionInfo) {
          dependencies.push({
            moduleName: depName,
            requiredVersion: '^' + depVersionInfo.currentVersion,
            currentVersion: depVersionInfo.currentVersion,
            isCompatible: this.isVersionCompatible(depVersionInfo.currentVersion, '^' + depVersionInfo.currentVersion),
            isRequired: true,
            isOptional: false,
          });
        }
      }
      
      this.versionDependencies.set(moduleName, dependencies);
    }
  }

  /**
   * Check for updates across all modules
   */
  private async checkForUpdates(): Promise<void> {
    for (const [moduleName, versionInfo] of this.moduleVersions) {
      if (versionInfo.needsUpdate) {
        this.logger.log(`🔄 Module ${moduleName} needs update: ${versionInfo.currentVersion} → ${versionInfo.latestVersion}`);
      }
    }
  }

  /**
   * Get version information for a module
   */
  getModuleVersion(moduleName: string): ModuleVersionInfo | undefined {
    return this.moduleVersions.get(moduleName);
  }

  /**
   * Get all module versions
   */
  getAllModuleVersions(): ModuleVersionInfo[] {
    return Array.from(this.moduleVersions.values());
  }

  /**
   * Get modules that need updates
   */
  getModulesNeedingUpdate(): ModuleVersionInfo[] {
    return Array.from(this.moduleVersions.values()).filter(m => m.needsUpdate);
  }

  /**
   * Get modules that need downgrades
   */
  getModulesNeedingDowngrade(): ModuleVersionInfo[] {
    return Array.from(this.moduleVersions.values()).filter(m => m.needsDowngrade);
  }

  /**
   * Get version dependencies for a module
   */
  getVersionDependencies(moduleName: string): VersionDependency[] {
    return this.versionDependencies.get(moduleName) || [];
  }

  /**
   * Check if a version is compatible with a requirement
   */
  private isVersionCompatible(version: string, requirement: string): boolean {
    // Simple version compatibility check
    // TODO: Implement proper semver parsing
    if (requirement.startsWith('^')) {
      const reqVersion = requirement.substring(1);
      return this.compareVersions(version, reqVersion) >= 0;
    }
    
    return version === requirement;
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
   * Get update plan for a module
   */
  getUpdatePlan(moduleName: string, targetVersion: string): {
    moduleName: string;
    currentVersion: string;
    targetVersion: string;
    migrationPath: string[];
    dependencies: VersionDependency[];
    breakingChanges: string[];
    newFeatures: string[];
    bugFixes: string[];
    estimatedTime: number;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const versionInfo = this.moduleVersions.get(moduleName);
    if (!versionInfo) {
      throw new Error(`Module ${moduleName} not found`);
    }

    const dependencies = this.versionDependencies.get(moduleName) || [];
    const breakingChanges = versionInfo.breakingChanges;
    const newFeatures = versionInfo.newFeatures;
    const bugFixes = versionInfo.bugFixes;

    // Calculate risk level based on breaking changes
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (breakingChanges.length > 0) {
      riskLevel = 'high';
    } else if (this.compareVersions(targetVersion, versionInfo.currentVersion) > 1) {
      riskLevel = 'medium';
    }

    // Estimate migration time
    const estimatedTime = breakingChanges.length * 30000 + // 30 seconds per breaking change
                         newFeatures.length * 10000 + // 10 seconds per new feature
                         bugFixes.length * 5000; // 5 seconds per bug fix

    return {
      moduleName,
      currentVersion: versionInfo.currentVersion,
      targetVersion,
      migrationPath: this.generateMigrationPath(versionInfo.currentVersion, targetVersion),
      dependencies,
      breakingChanges,
      newFeatures,
      bugFixes,
      estimatedTime,
      riskLevel,
    };
  }

  /**
   * Generate migration path between versions
   */
  private generateMigrationPath(fromVersion: string, toVersion: string): string[] {
    const path: string[] = [];
    
    // Simple path generation - in reality, this would be more complex
    const fromParts = fromVersion.split('.').map(Number);
    const toParts = toVersion.split('.').map(Number);
    
    // Generate intermediate versions
    for (let major = fromParts[0]; major <= toParts[0]; major++) {
      for (let minor = fromParts[1]; minor <= toParts[1]; minor++) {
        for (let patch = fromParts[2]; patch <= toParts[2]; patch++) {
          const version = `${major}.${minor}.${patch}`;
          if (this.compareVersions(version, fromVersion) > 0 && 
              this.compareVersions(version, toVersion) <= 0) {
            path.push(version);
          }
        }
      }
    }
    
    return path;
  }

  /**
   * Get version status summary
   */
  getVersionStatus(): {
    totalModules: number;
    upToDate: number;
    needsUpdate: number;
    needsDowngrade: number;
    error: number;
    modules: ModuleVersionInfo[];
  } {
    const modules = Array.from(this.moduleVersions.values());
    
    return {
      totalModules: modules.length,
      upToDate: modules.filter(m => m.isUpToDate).length,
      needsUpdate: modules.filter(m => m.needsUpdate).length,
      needsDowngrade: modules.filter(m => m.needsDowngrade).length,
      error: modules.filter(m => m.status === 'error').length,
      modules,
    };
  }

  /**
   * Update module version information
   */
  async updateModuleVersion(moduleName: string, newVersion: string): Promise<void> {
    const versionInfo = this.moduleVersions.get(moduleName);
    if (versionInfo) {
      versionInfo.currentVersion = newVersion;
      versionInfo.lastUpdated = new Date();
      versionInfo.isUpToDate = this.compareVersions(newVersion, versionInfo.latestVersion) === 0;
      versionInfo.needsUpdate = this.compareVersions(versionInfo.latestVersion, newVersion) > 0;
      versionInfo.needsDowngrade = this.compareVersions(versionInfo.latestVersion, newVersion) < 0;
      
      this.logger.log(`📦 Updated module version: ${moduleName}@${newVersion}`);
    }
  }
}

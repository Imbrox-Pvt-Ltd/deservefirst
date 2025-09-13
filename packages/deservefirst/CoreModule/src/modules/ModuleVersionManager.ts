// Module version information
interface ModuleVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

// Compatibility matrix entry
interface CompatibilityEntry {
  moduleId: string;
  version: ModuleVersion;
  compatibleWith: {
    [moduleId: string]: string; // version range
  };
  breakingChanges?: string[];
  deprecations?: string[];
}

// Migration script interface
interface MigrationScript {
  fromVersion: string;
  toVersion: string;
  script: (data: any) => Promise<any>;
  rollback?: (data: any) => Promise<any>;
}

// Version constraint types
type VersionConstraint = '^' | '~' | '=' | '>=' | '<=' | '>' | '<';

// Module versioning and compatibility manager
export class ModuleVersionManager {
  private static instance: ModuleVersionManager;
  private compatibilityMatrix: Map<string, CompatibilityEntry> = new Map();
  private migrations: Map<string, MigrationScript[]> = new Map();
  private installedVersions: Map<string, ModuleVersion> = new Map();
  private versionConstraints: Map<string, Map<string, string>> = new Map();

  private constructor() {
    this.loadCompatibilityMatrix();
  }

  public static getInstance(): ModuleVersionManager {
    if (!ModuleVersionManager.instance) {
      ModuleVersionManager.instance = new ModuleVersionManager();
    }
    return ModuleVersionManager.instance;
  }

  // Parse version string to ModuleVersion object
  public parseVersion(versionString: string): ModuleVersion {
    const regex = /^(\d+)\.(\d+)\.(\d+)(?:-(\w+(?:\.\w+)*))?(?:\+(\w+(?:\.\w+)*))?$/;
    const match = versionString.match(regex);
    
    if (!match) {
      throw new Error(`Invalid version format: ${versionString}`);
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4],
      build: match[5]
    };
  }

  // Convert ModuleVersion to string
  public versionToString(version: ModuleVersion): string {
    let versionStr = `${version.major}.${version.minor}.${version.patch}`;
    
    if (version.prerelease) {
      versionStr += `-${version.prerelease}`;
    }
    
    if (version.build) {
      versionStr += `+${version.build}`;
    }
    
    return versionStr;
  }

  // Compare two versions
  public compareVersions(v1: ModuleVersion, v2: ModuleVersion): number {
    // Compare major, minor, patch
    if (v1.major !== v2.major) return v1.major - v2.major;
    if (v1.minor !== v2.minor) return v1.minor - v2.minor;
    if (v1.patch !== v2.patch) return v1.patch - v2.patch;
    
    // Handle prerelease versions
    if (v1.prerelease && !v2.prerelease) return -1;
    if (!v1.prerelease && v2.prerelease) return 1;
    if (v1.prerelease && v2.prerelease) {
      return v1.prerelease.localeCompare(v2.prerelease);
    }
    
    return 0;
  }

  // Check if version satisfies constraint
  public satisfiesConstraint(version: ModuleVersion, constraint: string): boolean {
    const constraintRegex = /^([\^~>=<]*)(.+)$/;
    const match = constraint.match(constraintRegex);
    
    if (!match) return false;
    
    const operator = match[1] || '=';
    const targetVersion = this.parseVersion(match[2]);
    const comparison = this.compareVersions(version, targetVersion);

    switch (operator) {
      case '^': // Compatible within same major version
        return version.major === targetVersion.major && comparison >= 0;
      case '~': // Compatible within same minor version
        return version.major === targetVersion.major && 
               version.minor === targetVersion.minor && 
               comparison >= 0;
      case '>=': return comparison >= 0;
      case '<=': return comparison <= 0;
      case '>': return comparison > 0;
      case '<': return comparison < 0;
      case '=': 
      default: return comparison === 0;
    }
  }

  // Register module version and compatibility
  public registerModuleVersion(moduleId: string, version: string, compatibilityInfo: CompatibilityEntry): void {
    const parsedVersion = this.parseVersion(version);
    this.installedVersions.set(moduleId, parsedVersion);
    this.compatibilityMatrix.set(moduleId, compatibilityInfo);
    
    // Store version constraints for dependencies
    const constraints = new Map<string, string>();
    Object.entries(compatibilityInfo.compatibleWith).forEach(([depId, constraint]) => {
      constraints.set(depId, constraint);
    });
    this.versionConstraints.set(moduleId, constraints);
  }

  // Check compatibility between modules
  public checkCompatibility(moduleId: string, dependencyId: string): {
    compatible: boolean;
    reason?: string;
    suggestedVersion?: string;
  } {
    const moduleEntry = this.compatibilityMatrix.get(moduleId);
    const dependencyVersion = this.installedVersions.get(dependencyId);
    
    if (!moduleEntry) {
      return { compatible: false, reason: `Module ${moduleId} not found in compatibility matrix` };
    }
    
    if (!dependencyVersion) {
      return { compatible: false, reason: `Dependency ${dependencyId} not installed` };
    }
    
    const requiredConstraint = moduleEntry.compatibleWith[dependencyId];
    if (!requiredConstraint) {
      return { compatible: true }; // No specific constraint
    }
    
    const isCompatible = this.satisfiesConstraint(dependencyVersion, requiredConstraint);
    
    if (!isCompatible) {
      return {
        compatible: false,
        reason: `Version ${this.versionToString(dependencyVersion)} does not satisfy constraint ${requiredConstraint}`,
        suggestedVersion: requiredConstraint
      };
    }
    
    return { compatible: true };
  }

  // Resolve dependency conflicts
  public resolveDependencyConflicts(modules: string[]): {
    resolution: Map<string, string>;
    conflicts: string[];
    warnings: string[];
  } {
    const resolution = new Map<string, string>();
    const conflicts: string[] = [];
    const warnings: string[] = [];
    
    // Build dependency graph
    const dependencyGraph = new Map<string, Set<string>>();
    
    modules.forEach(moduleId => {
      const constraints = this.versionConstraints.get(moduleId);
      if (constraints) {
        dependencyGraph.set(moduleId, new Set(constraints.keys()));
      }
    });
    
    // Check for circular dependencies
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const hasCycle = (node: string): boolean => {
      if (recursionStack.has(node)) return true;
      if (visited.has(node)) return false;
      
      visited.add(node);
      recursionStack.add(node);
      
      const dependencies = dependencyGraph.get(node) || new Set();
      for (const dep of dependencies) {
        if (hasCycle(dep)) return true;
      }
      
      recursionStack.delete(node);
      return false;
    };
    
    // Check each module for cycles
    modules.forEach(moduleId => {
      if (hasCycle(moduleId)) {
        conflicts.push(`Circular dependency detected involving ${moduleId}`);
      }
    });
    
    // Resolve version constraints
    const allDependencies = new Set<string>();
    modules.forEach(moduleId => {
      const deps = dependencyGraph.get(moduleId);
      if (deps) {
        deps.forEach(dep => allDependencies.add(dep));
      }
    });
    
    allDependencies.forEach(depId => {
      const constraints: string[] = [];
      
      modules.forEach(moduleId => {
        const moduleConstraints = this.versionConstraints.get(moduleId);
        const constraint = moduleConstraints?.get(depId);
        if (constraint) {
          constraints.push(constraint);
        }
      });
      
      if (constraints.length > 1) {
        // Multiple constraints - need to find compatible version
        const currentVersion = this.installedVersions.get(depId);
        if (currentVersion) {
          const allSatisfied = constraints.every(constraint => 
            this.satisfiesConstraint(currentVersion, constraint)
          );
          
          if (allSatisfied) {
            resolution.set(depId, this.versionToString(currentVersion));
          } else {
            conflicts.push(`Cannot resolve version constraints for ${depId}: ${constraints.join(', ')}`);
          }
        }
      } else if (constraints.length === 1) {
        resolution.set(depId, constraints[0]);
      }
    });
    
    return { resolution, conflicts, warnings };
  }

  // Register migration script
  public registerMigration(moduleId: string, migration: MigrationScript): void {
    if (!this.migrations.has(moduleId)) {
      this.migrations.set(moduleId, []);
    }
    this.migrations.get(moduleId)!.push(migration);
  }

  // Execute migration path
  public async executeMigration(moduleId: string, fromVersion: string, toVersion: string, data: any): Promise<any> {
    const migrations = this.migrations.get(moduleId) || [];
    const migrationPath = this.findMigrationPath(migrations, fromVersion, toVersion);
    
    if (migrationPath.length === 0) {
      throw new Error(`No migration path found from ${fromVersion} to ${toVersion}`);
    }
    
    let currentData = data;
    
    for (const migration of migrationPath) {
      try {
        currentData = await migration.script(currentData);
      } catch (error) {
        // Attempt rollback if available
        if (migration.rollback) {
          await migration.rollback(currentData);
        }
        throw new Error(`Migration failed: ${error}`);
      }
    }
    
    return currentData;
  }

  // Find migration path between versions
  private findMigrationPath(migrations: MigrationScript[], fromVersion: string, toVersion: string): MigrationScript[] {
    // Simple implementation - in practice, this would use graph algorithms
    return migrations.filter(migration => {
      const from = this.parseVersion(migration.fromVersion);
      const to = this.parseVersion(migration.toVersion);
      const target = this.parseVersion(toVersion);
      const source = this.parseVersion(fromVersion);
      
      return this.compareVersions(from, source) >= 0 && this.compareVersions(to, target) <= 0;
    });
  }

  // Get breaking changes between versions
  public getBreakingChanges(moduleId: string, fromVersion: string, toVersion: string): string[] {
    const entry = this.compatibilityMatrix.get(moduleId);
    if (!entry || !entry.breakingChanges) {
      return [];
    }
    
    const from = this.parseVersion(fromVersion);
    const to = this.parseVersion(toVersion);
    
    // Return breaking changes if major version changed
    if (to.major > from.major) {
      return entry.breakingChanges;
    }
    
    return [];
  }

  // Load compatibility matrix from configuration
  private loadCompatibilityMatrix(): void {
    // In a real implementation, this would load from a configuration file or database
    // For now, we'll initialize with some example data
    
    this.registerModuleVersion('core-module', '1.0.0', {
      moduleId: 'core-module',
      version: { major: 1, minor: 0, patch: 0 },
      compatibleWith: {},
      breakingChanges: []
    });
    
    this.registerModuleVersion('rbac-module', '1.0.0', {
      moduleId: 'rbac-module',
      version: { major: 1, minor: 0, patch: 0 },
      compatibleWith: {
        'core-module': '^1.0.0'
      },
      breakingChanges: []
    });
    
    this.registerModuleVersion('cms-module', '1.0.0', {
      moduleId: 'cms-module',
      version: { major: 1, minor: 0, patch: 0 },
      compatibleWith: {
        'core-module': '^1.0.0',
        'rbac-module': '^1.0.0'
      },
      breakingChanges: []
    });
  }

  // Utility methods
  public getInstalledVersion(moduleId: string): ModuleVersion | undefined {
    return this.installedVersions.get(moduleId);
  }

  public getAllCompatibilityInfo(): CompatibilityEntry[] {
    return Array.from(this.compatibilityMatrix.values());
  }

  public validateModuleSet(modules: string[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check all modules are registered
    modules.forEach(moduleId => {
      if (!this.compatibilityMatrix.has(moduleId)) {
        errors.push(`Module ${moduleId} is not registered`);
      }
    });
    
    // Check compatibility between all modules
    modules.forEach(moduleId => {
      modules.forEach(otherId => {
        if (moduleId !== otherId) {
          const compatibility = this.checkCompatibility(moduleId, otherId);
          if (!compatibility.compatible && compatibility.reason) {
            errors.push(`${moduleId} -> ${otherId}: ${compatibility.reason}`);
          }
        }
      });
    });
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

// Export singleton instance
export const moduleVersionManager = ModuleVersionManager.getInstance();

// Export types
export type { ModuleVersion, CompatibilityEntry, MigrationScript, VersionConstraint };
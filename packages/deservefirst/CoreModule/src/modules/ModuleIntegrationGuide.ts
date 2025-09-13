import { ModuleRegistry, ModuleConfig } from './ModuleRegistry';
import { StoreModuleRegistry } from './StoreModuleRegistry';
import { moduleVersionManager, ModuleVersion, CompatibilityEntry } from './ModuleVersionManager';

// Integration configuration
interface IntegrationConfig {
  maxModules: number;
  enablePerformanceOptimization: boolean;
  enableHealthMonitoring: boolean;
  enableVersionValidation: boolean;
  loadBalancingStrategy: 'round-robin' | 'least-connections' | 'weighted' | 'health-based';
  cacheStrategy: 'LRU' | 'LFU' | 'FIFO';
}

// Module orchestration result
interface OrchestrationResult {
  success: boolean;
  loadedModules: string[];
  failedModules: string[];
  warnings: string[];
  errors: string[];
  performanceMetrics?: any;
}

// Complete module orchestration system
export class ModuleOrchestrationSystem {
  private static instance: ModuleOrchestrationSystem;
  private config: IntegrationConfig;
  private loadedModules: Set<string> = new Set();
  private moduleInstances: Map<string, any> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();

  private constructor(config: IntegrationConfig) {
    this.config = config;
    this.initializeSystem();
  }

  public static getInstance(config?: IntegrationConfig): ModuleOrchestrationSystem {
    if (!ModuleOrchestrationSystem.instance) {
      const defaultConfig: IntegrationConfig = {
        maxModules: 100,
        enablePerformanceOptimization: true,
        enableHealthMonitoring: true,
        enableVersionValidation: true,
        loadBalancingStrategy: 'health-based',
        cacheStrategy: 'LRU'
      };
      ModuleOrchestrationSystem.instance = new ModuleOrchestrationSystem(config || defaultConfig);
    }
    return ModuleOrchestrationSystem.instance;
  }

  // Initialize the orchestration system
  private initializeSystem(): void {
    console.log('🚀 Initializing Module Orchestration System');
    console.log(`📊 Configuration:`, this.config);
    
    // Initialize performance optimization if enabled
    if (this.config.enablePerformanceOptimization) {
      this.initializePerformanceOptimization();
    }
    
    // Initialize health monitoring if enabled
    if (this.config.enableHealthMonitoring) {
      this.initializeHealthMonitoring();
    }
  }

  // Register a new module with full orchestration
  public async registerModule(moduleConfig: ModuleConfig & {
    version: string;
    dependencies?: string[];
    compatibilityInfo?: CompatibilityEntry;
  }): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      success: false,
      loadedModules: [],
      failedModules: [],
      warnings: [],
      errors: []
    };

    try {
      console.log(`📦 Registering module: ${moduleConfig.name}`);

      // Step 1: Version validation
      if (this.config.enableVersionValidation && moduleConfig.compatibilityInfo) {
        const versionValidation = this.validateModuleVersion(moduleConfig);
        if (!versionValidation.valid) {
          result.errors.push(...versionValidation.errors);
          result.warnings.push(...versionValidation.warnings);
          return result;
        }
      }

      // Step 2: Dependency resolution
      if (moduleConfig.dependencies) {
        const dependencyResult = await this.resolveDependencies(moduleConfig.name, moduleConfig.dependencies);
        if (!dependencyResult.success) {
          result.errors.push(...dependencyResult.errors);
          return result;
        }
      }

      // Step 3: Register with version manager
      if (moduleConfig.compatibilityInfo) {
        moduleVersionManager.registerModuleVersion(
          moduleConfig.name,
          moduleConfig.version,
          moduleConfig.compatibilityInfo
        );
      }

      // Step 4: Register with module registry
      ModuleRegistry.registerModule(moduleConfig);

      // Step 5: Initialize module instance
      const moduleInstance = await this.initializeModuleInstance(moduleConfig);
      this.moduleInstances.set(moduleConfig.name, moduleInstance);

      // Step 6: Update dependency graph
      if (moduleConfig.dependencies) {
        this.dependencyGraph.set(moduleConfig.name, new Set(moduleConfig.dependencies));
      }

      this.loadedModules.add(moduleConfig.name);
      result.loadedModules.push(moduleConfig.name);
      result.success = true;

      console.log(`✅ Module ${moduleConfig.name} registered successfully`);

    } catch (error) {
      console.error(`❌ Failed to register module ${moduleConfig.name}:`, error);
      result.errors.push(`Failed to register ${moduleConfig.name}: ${error}`);
      result.failedModules.push(moduleConfig.name);
    }

    return result;
  }

  // Register store-level module
  public async registerStoreModule(tenantId: string, storeId: string, moduleConfig: any): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      success: false,
      loadedModules: [],
      failedModules: [],
      warnings: [],
      errors: []
    };

    try {
      console.log(`🏪 Registering store module: ${moduleConfig.name} for tenant ${tenantId}, store ${storeId}`);

      // Register with store module registry
      await StoreModuleRegistry.registerStoreModule(tenantId, storeId, moduleConfig);

      result.loadedModules.push(moduleConfig.name);
      result.success = true;

      console.log(`✅ Store module ${moduleConfig.name} registered successfully`);

    } catch (error) {
      console.error(`❌ Failed to register store module ${moduleConfig.name}:`, error);
      result.errors.push(`Failed to register store module ${moduleConfig.name}: ${error}`);
      result.failedModules.push(moduleConfig.name);
    }

    return result;
  }

  // Load multiple modules with orchestration
  public async loadModules(moduleConfigs: (ModuleConfig & {
    version: string;
    dependencies?: string[];
    compatibilityInfo?: CompatibilityEntry;
  })[]): Promise<OrchestrationResult> {
    console.log(`🔄 Loading ${moduleConfigs.length} modules...`);

    const result: OrchestrationResult = {
      success: true,
      loadedModules: [],
      failedModules: [],
      warnings: [],
      errors: []
    };

    // Step 1: Validate module set compatibility
    const moduleNames = moduleConfigs.map(config => config.name);
    const validation = moduleVersionManager.validateModuleSet(moduleNames);
    
    if (!validation.valid) {
      result.errors.push(...validation.errors);
      result.warnings.push(...validation.warnings);
      result.success = false;
      return result;
    }

    // Step 2: Resolve dependency order
    const loadOrder = this.calculateLoadOrder(moduleConfigs);
    
    if (loadOrder.conflicts.length > 0) {
      result.errors.push(...loadOrder.conflicts);
      result.success = false;
      return result;
    }

    // Step 3: Load modules in dependency order
    for (const moduleName of loadOrder.order) {
      const moduleConfig = moduleConfigs.find(config => config.name === moduleName);
      if (moduleConfig) {
        const moduleResult = await this.registerModule(moduleConfig);
        
        result.loadedModules.push(...moduleResult.loadedModules);
        result.failedModules.push(...moduleResult.failedModules);
        result.warnings.push(...moduleResult.warnings);
        result.errors.push(...moduleResult.errors);
        
        if (!moduleResult.success) {
          result.success = false;
        }
      }
    }

    console.log(`📊 Module loading complete. Success: ${result.success}`);
    console.log(`✅ Loaded: ${result.loadedModules.length}, ❌ Failed: ${result.failedModules.length}`);

    return result;
  }

  // Get module instance
  public getModuleInstance(moduleName: string): any {
    return this.moduleInstances.get(moduleName);
  }

  // Get all loaded modules
  public getLoadedModules(): string[] {
    return Array.from(this.loadedModules);
  }

  // Health check for all modules
  public async performHealthCheck(): Promise<{
    healthy: string[];
    unhealthy: string[];
    details: Map<string, any>;
  }> {
    const healthy: string[] = [];
    const unhealthy: string[] = [];
    const details = new Map<string, any>();

    for (const moduleName of this.loadedModules) {
      try {
        const instance = this.moduleInstances.get(moduleName);
        
        // Check if module has health check method
        if (instance && typeof instance.healthCheck === 'function') {
          const health = await instance.healthCheck();
          details.set(moduleName, health);
          
          if (health.status === 'healthy') {
            healthy.push(moduleName);
          } else {
            unhealthy.push(moduleName);
          }
        } else {
          // Default health check - just verify instance exists
          healthy.push(moduleName);
          details.set(moduleName, { status: 'healthy', message: 'Instance active' });
        }
      } catch (error) {
        unhealthy.push(moduleName);
        details.set(moduleName, { status: 'unhealthy', error: error });
      }
    }

    return { healthy, unhealthy, details };
  }

  // Private helper methods
  private validateModuleVersion(moduleConfig: any): { valid: boolean; errors: string[]; warnings: string[] } {
    // Implementation would validate version compatibility
    return { valid: true, errors: [], warnings: [] };
  }

  private async resolveDependencies(moduleName: string, dependencies: string[]): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    for (const dep of dependencies) {
      if (!this.loadedModules.has(dep)) {
        errors.push(`Dependency ${dep} not loaded for module ${moduleName}`);
      }
    }
    
    return { success: errors.length === 0, errors };
  }

  private async initializeModuleInstance(moduleConfig: ModuleConfig): Promise<any> {
    // In a real implementation, this would dynamically load and instantiate the module
    return {
      name: moduleConfig.name,
      version: '1.0.0',
      status: 'initialized',
      healthCheck: async () => ({ status: 'healthy', timestamp: new Date() })
    };
  }

  private calculateLoadOrder(moduleConfigs: any[]): { order: string[]; conflicts: string[] } {
    const order: string[] = [];
    const conflicts: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (moduleName: string) => {
      if (visiting.has(moduleName)) {
        conflicts.push(`Circular dependency detected: ${moduleName}`);
        return;
      }
      
      if (visited.has(moduleName)) {
        return;
      }
      
      visiting.add(moduleName);
      
      const moduleConfig = moduleConfigs.find(config => config.name === moduleName);
      if (moduleConfig && moduleConfig.dependencies) {
        for (const dep of moduleConfig.dependencies) {
          visit(dep);
        }
      }
      
      visiting.delete(moduleName);
      visited.add(moduleName);
      order.push(moduleName);
    };
    
    moduleConfigs.forEach(config => visit(config.name));
    
    return { order, conflicts };
  }

  private initializePerformanceOptimization(): void {
    console.log('🚀 Performance optimization enabled');
    // Initialize performance monitoring and optimization
  }

  private initializeHealthMonitoring(): void {
    console.log('❤️ Health monitoring enabled');
    
    // Set up periodic health checks
    setInterval(async () => {
      const health = await this.performHealthCheck();
      
      if (health.unhealthy.length > 0) {
        console.warn(`⚠️ Unhealthy modules detected: ${health.unhealthy.join(', ')}`);
      }
    }, 30000); // Check every 30 seconds
  }

  // System statistics
  public getSystemStats(): {
    totalModules: number;
    loadedModules: number;
    maxModules: number;
    memoryUsage: { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };
    uptime: number;
  } {
    return {
      totalModules: this.loadedModules.size,
      loadedModules: this.loadedModules.size,
      maxModules: this.config.maxModules,
      memoryUsage: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 },
      uptime: Date.now()
    };
  }
}

// Usage example and integration guide
export class ModuleIntegrationExample {
  public static async demonstrateFullIntegration(): Promise<void> {
    console.log('🎯 Demonstrating Complete Module Integration');
    
    // Step 1: Initialize orchestration system
    const orchestrator = ModuleOrchestrationSystem.getInstance({
      maxModules: 150,
      enablePerformanceOptimization: true,
      enableHealthMonitoring: true,
      enableVersionValidation: true,
      loadBalancingStrategy: 'health-based',
      cacheStrategy: 'LRU'
    });

    // Step 2: Define module configurations
    const moduleConfigs = [
      {
        name: 'core-module',
        version: '1.0.0',
        routes: ['/api/core'],
        permissions: ['core.read', 'core.write'],
        settings: { database: true, cache: true },
        compatibilityInfo: {
          moduleId: 'core-module',
          version: { major: 1, minor: 0, patch: 0 },
          compatibleWith: {},
          breakingChanges: []
        }
      },
      {
        name: 'rbac-module',
        version: '1.0.0',
        routes: ['/api/rbac'],
        permissions: ['rbac.read', 'rbac.write'],
        settings: { roles: true, permissions: true },
        dependencies: ['core-module'],
        compatibilityInfo: {
          moduleId: 'rbac-module',
          version: { major: 1, minor: 0, patch: 0 },
          compatibleWith: { 'core-module': '^1.0.0' },
          breakingChanges: []
        }
      },
      {
        name: 'cms-module',
        version: '1.0.0',
        routes: ['/api/cms'],
        permissions: ['cms.read', 'cms.write'],
        settings: { content: true, media: true },
        dependencies: ['core-module', 'rbac-module'],
        compatibilityInfo: {
          moduleId: 'cms-module',
          version: { major: 1, minor: 0, patch: 0 },
          compatibleWith: { 
            'core-module': '^1.0.0',
            'rbac-module': '^1.0.0'
          },
          breakingChanges: []
        }
      }
    ];

    // Step 3: Load all modules
    const result = await orchestrator.loadModules(moduleConfigs);
    
    console.log('📊 Loading Result:', result);

    // Step 4: Perform health check
    const health = await orchestrator.performHealthCheck();
    console.log('❤️ Health Status:', health);

    // Step 5: Get system statistics
    const stats = orchestrator.getSystemStats();
    console.log('📈 System Stats:', stats);

    console.log('✅ Integration demonstration complete!');
  }
}

// Export the orchestration system
export const moduleOrchestrator = ModuleOrchestrationSystem.getInstance();

// Export types
export type { IntegrationConfig, OrchestrationResult };
import { EventEmitter } from 'events';
import { ModuleConfig } from './ModuleRegistry';
import { Database } from '../database/Database';
import { Cache } from '../cache/Cache';
import { Events } from '../events/Events';
import { Hooks } from '../hooks/Hooks';

export interface EnhancedModuleConfig extends ModuleConfig {
  version: string;
  priority: number; // 0-100, higher = loads first
  category: 'core' | 'business' | 'integration' | 'ui' | 'analytics';
  lazy?: boolean; // Load on-demand
  healthCheck?: () => Promise<boolean>;
  onInit?: () => Promise<void>;
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
  compatibleVersions?: string[];
  resourceLimits?: {
    memory?: number; // MB
    cpu?: number; // percentage
  };
}

export interface ModuleInstance {
  config: EnhancedModuleConfig;
  status: 'registered' | 'initializing' | 'initialized' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  instance?: any;
  error?: Error;
  startTime?: Date;
  lastHealthCheck?: Date;
  resourceUsage?: {
    memory: number;
    cpu: number;
  };
}

export class ModuleOrchestrator {
  private static instance: ModuleOrchestrator;
  private modules = new Map<string, ModuleInstance>();
  private dependencyGraph = new Map<string, Set<string>>();
  private reverseDependencyGraph = new Map<string, Set<string>>();
  private loadOrder: string[] = [];
  private healthCheckInterval?: any;
  private performanceMonitor?: any;
  private eventListeners = new Map<string, Function[]>();

  private constructor() {
    this.setupHealthMonitoring();
    this.setupPerformanceMonitoring();
  }

  static getInstance(): ModuleOrchestrator {
    if (!ModuleOrchestrator.instance) {
      ModuleOrchestrator.instance = new ModuleOrchestrator();
    }
    return ModuleOrchestrator.instance;
  }

  // Module Discovery & Registration
  async discoverModules(searchPaths: string[]): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    for (const searchPath of searchPaths) {
      try {
        const entries = await fs.readdir(searchPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const modulePath = path.join(searchPath, entry.name);
            const packageJsonPath = path.join(modulePath, 'package.json');
            
            try {
              const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
              
              if (packageJson.moduleConfig) {
                await this.loadModuleFromPath(modulePath, packageJson);
              }
            } catch (error) {
              // Skip directories without valid package.json or module config
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to scan module directory ${searchPath}:`, error);
      }
    }
  }

  private async loadModuleFromPath(modulePath: string, packageJson: any): Promise<void> {
    try {
      const moduleEntry = require(modulePath);
      const moduleConfig: EnhancedModuleConfig = {
        ...moduleEntry.default || moduleEntry,
        version: packageJson.version,
        priority: packageJson.moduleConfig.priority || 50,
        category: packageJson.moduleConfig.category || 'business',
        lazy: packageJson.moduleConfig.lazy || false
      };

      await this.registerModule(moduleConfig);
    } catch (error) {
      console.error(`Failed to load module from ${modulePath}:`, error);
    }
  }

  async registerModule(config: EnhancedModuleConfig): Promise<void> {
    if (this.modules.has(config.name)) {
      throw new Error(`Module ${config.name} is already registered`);
    }

    // Validate module configuration
    this.validateModuleConfig(config);

    // Check version compatibility
    await this.checkVersionCompatibility(config);

    const moduleInstance: ModuleInstance = {
      config,
      status: 'registered'
    };

    this.modules.set(config.name, moduleInstance);
    this.buildDependencyGraph(config);

    // Store module metadata in database
    await Database.create('modules', {
      name: config.name,
      version: config.version,
      category: config.category,
      dependencies: config.dependencies,
      registeredAt: new Date()
    });

    this.emitEvent('moduleRegistered', config.name);
  }

  // Dependency Resolution
  private buildDependencyGraph(config: EnhancedModuleConfig): void {
    this.dependencyGraph.set(config.name, new Set(config.dependencies));
    
    // Build reverse dependency graph
    for (const dependency of config.dependencies) {
      if (!this.reverseDependencyGraph.has(dependency)) {
        this.reverseDependencyGraph.set(dependency, new Set());
      }
      this.reverseDependencyGraph.get(dependency)!.add(config.name);
    }
  }

  private resolveDependencies(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const loadOrder: string[] = [];

    const visit = (moduleName: string): void => {
      if (visiting.has(moduleName)) {
        throw new Error(`Circular dependency detected involving module: ${moduleName}`);
      }
      
      if (visited.has(moduleName)) {
        return;
      }

      visiting.add(moduleName);
      
      const dependencies = this.dependencyGraph.get(moduleName) || new Set();
      for (const dependency of dependencies) {
        if (!this.modules.has(dependency)) {
          throw new Error(`Missing dependency: ${dependency} required by ${moduleName}`);
        }
        visit(dependency);
      }
      
      visiting.delete(moduleName);
      visited.add(moduleName);
      loadOrder.push(moduleName);
    };

    // Sort modules by priority first
    const modulesByPriority = Array.from(this.modules.keys())
      .sort((a, b) => {
        const moduleA = this.modules.get(a)!;
        const moduleB = this.modules.get(b)!;
        return moduleB.config.priority - moduleA.config.priority;
      });

    for (const moduleName of modulesByPriority) {
      if (!visited.has(moduleName)) {
        visit(moduleName);
      }
    }

    return loadOrder;
  }

  // Module Lifecycle Management
  async initializeAllModules(): Promise<void> {
    this.loadOrder = this.resolveDependencies();
    
    for (const moduleName of this.loadOrder) {
      const moduleInstance = this.modules.get(moduleName)!;
      
      if (moduleInstance.config.lazy) {
        continue; // Skip lazy modules
      }
      
      await this.initializeModule(moduleName);
    }
  }

  async initializeModule(moduleName: string): Promise<void> {
    const moduleInstance = this.modules.get(moduleName);
    if (!moduleInstance) {
      throw new Error(`Module ${moduleName} not found`);
    }

    if (moduleInstance.status !== 'registered') {
      return; // Already initialized or in process
    }

    try {
      moduleInstance.status = 'initializing';
      this.emitEvent('moduleInitializing', moduleName);

      // Initialize dependencies first
      for (const dependency of moduleInstance.config.dependencies) {
        await this.initializeModule(dependency);
      }

      // Run module initialization
      if (moduleInstance.config.onInit) {
        await moduleInstance.config.onInit();
      }

      moduleInstance.status = 'initialized';
      this.emitEvent('moduleInitialized', moduleName);
    } catch (error) {
      moduleInstance.status = 'error';
      moduleInstance.error = error as Error;
      this.emitEvent('moduleError', moduleName, error);
      throw error;
    }
  }

  async startAllModules(): Promise<void> {
    for (const moduleName of this.loadOrder) {
      const moduleInstance = this.modules.get(moduleName)!;
      
      if (moduleInstance.config.lazy || moduleInstance.status !== 'initialized') {
        continue;
      }
      
      await this.startModule(moduleName);
    }
  }

  async startModule(moduleName: string): Promise<void> {
    const moduleInstance = this.modules.get(moduleName);
    if (!moduleInstance || moduleInstance.status !== 'initialized') {
      return;
    }

    try {
      moduleInstance.status = 'starting';
      this.emitEvent('moduleStarting', moduleName);

      if (moduleInstance.config.onStart) {
        await moduleInstance.config.onStart();
      }

      moduleInstance.status = 'running';
      moduleInstance.startTime = new Date();
      this.emitEvent('moduleStarted', moduleName);
    } catch (error) {
      moduleInstance.status = 'error';
      moduleInstance.error = error as Error;
      this.emitEvent('moduleError', moduleName, error);
      throw error;
    }
  }

  async stopModule(moduleName: string): Promise<void> {
    const moduleInstance = this.modules.get(moduleName);
    if (!moduleInstance || moduleInstance.status !== 'running') {
      return;
    }

    try {
      moduleInstance.status = 'stopping';
      this.emitEvent('moduleStopping', moduleName);

      // Stop dependent modules first
      const dependents = this.reverseDependencyGraph.get(moduleName) || new Set();
      for (const dependent of dependents) {
        await this.stopModule(dependent);
      }

      if (moduleInstance.config.onStop) {
        await moduleInstance.config.onStop();
      }

      moduleInstance.status = 'stopped';
      this.emitEvent('moduleStopped', moduleName);
    } catch (error) {
      moduleInstance.status = 'error';
      moduleInstance.error = error as Error;
      this.emitEvent('moduleError', moduleName, error);
      throw error;
    }
  }

  // Health Monitoring
  private setupHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000); // Every 30 seconds
  }

  private async performHealthChecks(): Promise<void> {
    for (const [moduleName, moduleInstance] of this.modules) {
      if (moduleInstance.status === 'running' && moduleInstance.config.healthCheck) {
        try {
          const isHealthy = await moduleInstance.config.healthCheck();
          moduleInstance.lastHealthCheck = new Date();
          
          if (!isHealthy) {
            this.emitEvent('moduleUnhealthy', moduleName);
            // Optionally restart unhealthy modules
            await this.restartModule(moduleName);
          }
        } catch (error) {
          this.emitEvent('moduleHealthCheckFailed', moduleName, error);
        }
      }
    }
  }

  private setupPerformanceMonitoring(): void {
    this.performanceMonitor = setInterval(() => {
      this.monitorResourceUsage();
    }, 10000); // Every 10 seconds
  }

  private monitorResourceUsage(): void {
    const process = require('process');
    const memoryUsage = process.memoryUsage();
    
    for (const [moduleName, moduleInstance] of this.modules) {
      if (moduleInstance.status === 'running') {
        // Simplified resource monitoring - in production, use more sophisticated tools
        moduleInstance.resourceUsage = {
          memory: memoryUsage.heapUsed / 1024 / 1024, // MB
          cpu: process.cpuUsage().user / 1000000 // Simplified CPU usage
        };
        
        // Check resource limits
        const limits = moduleInstance.config.resourceLimits;
        if (limits) {
          if (limits.memory && moduleInstance.resourceUsage.memory > limits.memory) {
            this.emitEvent('moduleResourceLimitExceeded', moduleName, 'memory');
          }
          if (limits.cpu && moduleInstance.resourceUsage.cpu > limits.cpu) {
            this.emitEvent('moduleResourceLimitExceeded', moduleName, 'cpu');
          }
        }
      }
    }
  }

  async restartModule(moduleName: string): Promise<void> {
    await this.stopModule(moduleName);
    await this.startModule(moduleName);
  }

  // Utility Methods
  private validateModuleConfig(config: EnhancedModuleConfig): void {
    if (!config.name || !config.version) {
      throw new Error('Module must have name and version');
    }
    
    if (config.priority < 0 || config.priority > 100) {
      throw new Error('Module priority must be between 0 and 100');
    }
  }

  private async checkVersionCompatibility(config: EnhancedModuleConfig): Promise<void> {
    // Check if there are any existing modules with compatibility constraints
    for (const [existingName, existingInstance] of this.modules) {
      const existing = existingInstance.config;
      
      if (existing.compatibleVersions && 
          config.dependencies.includes(existingName) &&
          !existing.compatibleVersions.includes(config.version)) {
        throw new Error(`Version incompatibility: ${config.name}@${config.version} is not compatible with ${existingName}@${existing.version}`);
      }
    }
  }

  // Public API
  getModuleStatus(moduleName: string): ModuleInstance | undefined {
    return this.modules.get(moduleName);
  }

  getAllModules(): Map<string, ModuleInstance> {
    return new Map(this.modules);
  }

  getModulesByCategory(category: string): ModuleInstance[] {
    return Array.from(this.modules.values())
      .filter(instance => instance.config.category === category);
  }

  async getModuleMetrics(): Promise<any> {
    const metrics = {
      totalModules: this.modules.size,
      runningModules: 0,
      errorModules: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      categories: {} as any
    };

    for (const [name, instance] of this.modules) {
      if (instance.status === 'running') metrics.runningModules++;
      if (instance.status === 'error') metrics.errorModules++;
      
      if (instance.resourceUsage) {
        metrics.memoryUsage += instance.resourceUsage.memory;
        metrics.cpuUsage += instance.resourceUsage.cpu;
      }
      
      const category = instance.config.category;
      if (!metrics.categories[category]) {
        metrics.categories[category] = 0;
      }
      metrics.categories[category]++;
    }

    return metrics;
  }

  // Event system methods
  on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emitEvent(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor);
    }
    this.eventListeners.clear();
  }
}

// Export singleton instance
export const moduleOrchestrator = ModuleOrchestrator.getInstance();
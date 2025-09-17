import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';

export interface ModuleMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  dependencies: string[];
  provides: string[];
  requires: string[];
  status: 'active' | 'inactive' | 'error';
  path: string;
  packageJson: any;
  moduleClass?: any;
  services?: string[];
  controllers?: string[];
  entities?: string[];
  events?: string[];
  hooks?: string[];
}

export interface StoreModuleConfig {
  storeId: string;
  moduleName: string;
  enabled: boolean;
  settings: Record<string, any>;
  customFields: Record<string, any>;
  version: string;
}

@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private modules = new Map<string, ModuleMetadata>();
  private storeModules = new Map<string, StoreModuleConfig[]>();
  private moduleDependencies = new Map<string, string[]>();
  private loadedModules = new Set<string>();

  constructor(private moduleRef: ModuleRef) {}

  /**
   * Discover and register all modules from node_modules
   */
  async discoverModules(): Promise<void> {
    this.logger.log('🔍 Discovering modules...');
    
    try {
      // Look for @deservefirst/* modules in node_modules
      const nodeModulesPath = path.join(process.cwd(), 'node_modules');
      const deservefirstModules = await this.findDeservefirstModules(nodeModulesPath);
      
      for (const modulePath of deservefirstModules) {
        await this.registerModule(modulePath);
      }
      
      this.logger.log(`✅ Discovered ${this.modules.size} modules`);
    } catch (error) {
      this.logger.error('❌ Error discovering modules:', error);
    }
  }

  /**
   * Find all @deservefirst/* modules in node_modules
   */
  private async findDeservefirstModules(nodeModulesPath: string): Promise<string[]> {
    const modules: string[] = [];
    
    try {
      const entries = await fs.promises.readdir(nodeModulesPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('@deservefirst')) {
          const deservefirstPath = path.join(nodeModulesPath, entry.name);
          const subEntries = await fs.promises.readdir(deservefirstPath, { withFileTypes: true });
          
          for (const subEntry of subEntries) {
            if (subEntry.isDirectory()) {
              const modulePath = path.join(deservefirstPath, subEntry.name);
              modules.push(modulePath);
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Could not read node_modules: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return modules;
  }

  /**
   * Register a single module
   */
  private async registerModule(modulePath: string): Promise<void> {
    try {
      const packageJsonPath = path.join(modulePath, 'package.json');
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
      
      // Check if it's a Deservefirst module
      if (!packageJson.deservefirst || !packageJson.deservefirst.module) {
        return;
      }

      const moduleMetadata: ModuleMetadata = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description || '',
        author: packageJson.author || '',
        dependencies: packageJson.deservefirst.dependencies || [],
        provides: packageJson.deservefirst.provides || [],
        requires: packageJson.deservefirst.requires || [],
        status: 'inactive',
        path: modulePath,
        packageJson,
        services: packageJson.deservefirst.services || [],
        controllers: packageJson.deservefirst.controllers || [],
        entities: packageJson.deservefirst.entities || [],
        events: packageJson.deservefirst.events || [],
        hooks: packageJson.deservefirst.hooks || [],
      };

      this.modules.set(moduleMetadata.name, moduleMetadata);
      this.logger.log(`📦 Registered module: ${moduleMetadata.name}@${moduleMetadata.version}`);
      
    } catch (error) {
      this.logger.error(`❌ Error registering module at ${modulePath}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Load a module and its dependencies
   */
  async loadModule(moduleName: string): Promise<boolean> {
    const module = this.modules.get(moduleName);
    if (!module) {
      this.logger.error(`Module ${moduleName} not found`);
      return false;
    }

    if (this.loadedModules.has(moduleName)) {
      this.logger.log(`Module ${moduleName} already loaded`);
      return true;
    }

    try {
      // Load dependencies first
      for (const dependency of module.dependencies) {
        if (!this.loadedModules.has(dependency)) {
          const loaded = await this.loadModule(dependency);
          if (!loaded) {
            this.logger.error(`Failed to load dependency ${dependency} for ${moduleName}`);
            return false;
          }
        }
      }

      // Load the module
      await this.initializeModule(module);
      this.loadedModules.add(moduleName);
      module.status = 'active';
      
      this.logger.log(`✅ Loaded module: ${moduleName}`);
      return true;
      
    } catch (error) {
      this.logger.error(`❌ Error loading module ${moduleName}:`, error instanceof Error ? error.message : String(error));
      module.status = 'error';
      return false;
    }
  }

  /**
   * Initialize a module
   */
  private async initializeModule(module: ModuleMetadata): Promise<void> {
    // Load module class if exists
    if (module.packageJson.deservefirst.moduleClass) {
      const moduleClassPath = path.join(module.path, module.packageJson.deservefirst.moduleClass);
      const moduleClass = require(moduleClassPath);
      module.moduleClass = moduleClass;
    }

    // Register services, controllers, entities, etc.
    // This would integrate with NestJS module system
    this.logger.log(`🔧 Initializing module: ${module.name}`);
  }

  /**
   * Get all registered modules
   */
  getModules(): ModuleMetadata[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get module by name
   */
  getModule(name: string): ModuleMetadata | undefined {
    return this.modules.get(name);
  }

  /**
   * Get loaded modules
   */
  getLoadedModules(): string[] {
    return Array.from(this.loadedModules);
  }

  /**
   * Check if module is loaded
   */
  isModuleLoaded(name: string): boolean {
    return this.loadedModules.has(name);
  }

  /**
   * Store-level module management
   */
  async enableStoreModule(storeId: string, moduleName: string, settings: Record<string, any> = {}): Promise<boolean> {
    const module = this.getModule(moduleName);
    if (!module) {
      this.logger.error(`Module ${moduleName} not found`);
      return false;
    }

    const storeModules = this.storeModules.get(storeId) || [];
    const existingModule = storeModules.find(m => m.moduleName === moduleName);
    
    if (existingModule) {
      existingModule.enabled = true;
      existingModule.settings = { ...existingModule.settings, ...settings };
    } else {
      storeModules.push({
        storeId,
        moduleName,
        enabled: true,
        settings,
        customFields: {},
        version: module.version,
      });
    }

    this.storeModules.set(storeId, storeModules);
    this.logger.log(`🏪 Enabled module ${moduleName} for store ${storeId}`);
    return true;
  }

  /**
   * Disable store module
   */
  async disableStoreModule(storeId: string, moduleName: string): Promise<boolean> {
    const storeModules = this.storeModules.get(storeId);
    if (!storeModules) return false;

    const module = storeModules.find(m => m.moduleName === moduleName);
    if (module) {
      module.enabled = false;
      this.logger.log(`🏪 Disabled module ${moduleName} for store ${storeId}`);
      return true;
    }

    return false;
  }

  /**
   * Get store modules
   */
  getStoreModules(storeId: string): StoreModuleConfig[] {
    return this.storeModules.get(storeId) || [];
  }

  /**
   * Get enabled store modules
   */
  getEnabledStoreModules(storeId: string): StoreModuleConfig[] {
    const storeModules = this.getStoreModules(storeId);
    return storeModules.filter(m => m.enabled);
  }

  /**
   * Update module settings
   */
  async updateModuleSettings(storeId: string, moduleName: string, settings: Record<string, any>): Promise<boolean> {
    const storeModules = this.storeModules.get(storeId);
    if (!storeModules) return false;

    const module = storeModules.find(m => m.moduleName === moduleName);
    if (module) {
      module.settings = { ...module.settings, ...settings };
      this.logger.log(`⚙️ Updated settings for module ${moduleName} in store ${storeId}`);
      return true;
    }

    return false;
  }

  /**
   * Get module health status
   */
  getModuleHealth(): Record<string, any> {
    const totalModules = this.modules.size;
    const loadedModules = this.loadedModules.size;
    const activeModules = Array.from(this.modules.values()).filter(m => m.status === 'active').length;
    const errorModules = Array.from(this.modules.values()).filter(m => m.status === 'error').length;

    return {
      total: totalModules,
      loaded: loadedModules,
      active: activeModules,
      inactive: totalModules - activeModules,
      errors: errorModules,
      modules: Array.from(this.modules.values()).map(m => ({
        name: m.name,
        version: m.version,
        status: m.status,
        loaded: this.loadedModules.has(m.name),
      })),
    };
  }
}

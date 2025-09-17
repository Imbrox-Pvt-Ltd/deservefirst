import { Injectable, Logger } from '@nestjs/common';
import { ModuleRegistryService, ModuleMetadata } from './module-registry.service';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

export interface LoadedModule {
  name: string;
  moduleClass: any;
  services: Map<string, any>;
  controllers: Map<string, any>;
  entities: Map<string, any>;
  events: Map<string, any>;
  hooks: Map<string, any>;
  isLoaded: boolean;
  lastLoaded: Date;
}

@Injectable()
export class DynamicModuleLoaderService {
  private readonly logger = new Logger(DynamicModuleLoaderService.name);
  private loadedModules = new Map<string, LoadedModule>();
  private watchers = new Map<string, chokidar.FSWatcher>();
  private isWatching = false;

  constructor(
    private moduleRegistry: ModuleRegistryService,
  ) {}

  /**
   * Initialize dynamic module loading
   */
  async initialize(): Promise<void> {
    this.logger.log('🔄 Initializing dynamic module loader...');
    
    // Load all discovered modules
    await this.loadAllModules();
    
    // Start file watching for hot-reloading
    await this.startFileWatching();
    
    this.logger.log('✅ Dynamic module loader initialized');
  }

  /**
   * Load all discovered modules
   */
  async loadAllModules(): Promise<void> {
    const modules = this.moduleRegistry.getModules();
    
    for (const module of modules) {
      try {
        await this.loadModule(module.name);
      } catch (error) {
        this.logger.error(`❌ Failed to load module ${module.name}:`, error);
      }
    }
  }

  /**
   * Load a specific module dynamically
   */
  async loadModule(moduleName: string): Promise<boolean> {
    const module = this.moduleRegistry.getModule(moduleName);
    if (!module) {
      this.logger.error(`Module ${moduleName} not found in registry`);
      return false;
    }

    try {
      // Check if already loaded
      if (this.loadedModules.has(moduleName)) {
        this.logger.log(`Module ${moduleName} already loaded`);
        return true;
      }

      // Load module class
      const moduleClass = await this.loadModuleClass(module);
      if (!moduleClass) {
        throw new Error(`Failed to load module class for ${moduleName}`);
      }

      // Load services
      const services = await this.loadServices(module);
      
      // Load controllers
      const controllers = await this.loadControllers(module);
      
      // Load entities
      const entities = await this.loadEntities(module);
      
      // Load events
      const events = await this.loadEvents(module);
      
      // Load hooks
      const hooks = await this.loadHooks(module);

      // Create loaded module record
      const loadedModule: LoadedModule = {
        name: moduleName,
        moduleClass,
        services,
        controllers,
        entities,
        events,
        hooks,
        isLoaded: true,
        lastLoaded: new Date(),
      };

      this.loadedModules.set(moduleName, loadedModule);
      
      // Register with NestJS module system
      await this.registerWithNestJS(loadedModule);

      this.logger.log(`✅ Loaded module: ${moduleName}`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Error loading module ${moduleName}:`, error);
      return false;
    }
  }

  /**
   * Unload a module
   */
  async unloadModule(moduleName: string): Promise<boolean> {
    const loadedModule = this.loadedModules.get(moduleName);
    if (!loadedModule) {
      this.logger.warn(`Module ${moduleName} not loaded`);
      return false;
    }

    try {
      // Unregister from NestJS
      await this.unregisterFromNestJS(loadedModule);

      // Clear from loaded modules
      this.loadedModules.delete(moduleName);

      this.logger.log(`✅ Unloaded module: ${moduleName}`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Error unloading module ${moduleName}:`, error);
      return false;
    }
  }

  /**
   * Reload a module (unload and load again)
   */
  async reloadModule(moduleName: string): Promise<boolean> {
    this.logger.log(`🔄 Reloading module: ${moduleName}`);
    
    const unloaded = await this.unloadModule(moduleName);
    if (!unloaded) {
      return false;
    }

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    const loaded = await this.loadModule(moduleName);
    if (loaded) {
      this.logger.log(`✅ Reloaded module: ${moduleName}`);
    }

    return loaded;
  }

  /**
   * Load module class
   */
  private async loadModuleClass(module: ModuleMetadata): Promise<any> {
    try {
      const modulePath = path.join(module.path, module.packageJson.deservefirst.moduleClass);
      
      // Clear require cache for hot-reloading
      delete require.cache[require.resolve(modulePath)];
      
      const moduleClass = require(modulePath);
      return moduleClass.default || moduleClass;
    } catch (error) {
      this.logger.error(`Error loading module class:`, error);
      return null;
    }
  }

  /**
   * Load services from module
   */
  private async loadServices(module: ModuleMetadata): Promise<Map<string, any>> {
    const services = new Map<string, any>();
    
    for (const serviceName of module.services || []) {
      try {
        const servicePath = path.join(module.path, 'src', 'services', `${serviceName}.service.ts`);
        
        if (fs.existsSync(servicePath)) {
          // Clear require cache
          delete require.cache[require.resolve(servicePath)];
          
          const serviceClass = require(servicePath);
          services.set(serviceName, serviceClass.default || serviceClass);
        }
      } catch (error) {
        this.logger.warn(`Error loading service ${serviceName}:`, error);
      }
    }
    
    return services;
  }

  /**
   * Load controllers from module
   */
  private async loadControllers(module: ModuleMetadata): Promise<Map<string, any>> {
    const controllers = new Map<string, any>();
    
    for (const controllerName of module.controllers || []) {
      try {
        const controllerPath = path.join(module.path, 'src', 'controllers', `${controllerName}.controller.ts`);
        
        if (fs.existsSync(controllerPath)) {
          // Clear require cache
          delete require.cache[require.resolve(controllerPath)];
          
          const controllerClass = require(controllerPath);
          controllers.set(controllerName, controllerClass.default || controllerClass);
        }
      } catch (error) {
        this.logger.warn(`Error loading controller ${controllerName}:`, error);
      }
    }
    
    return controllers;
  }

  /**
   * Load entities from module
   */
  private async loadEntities(module: ModuleMetadata): Promise<Map<string, any>> {
    const entities = new Map<string, any>();
    
    for (const entityName of module.entities || []) {
      try {
        const entityPath = path.join(module.path, 'src', 'entities', `${entityName}.entity.ts`);
        
        if (fs.existsSync(entityPath)) {
          // Clear require cache
          delete require.cache[require.resolve(entityPath)];
          
          const entityClass = require(entityPath);
          entities.set(entityName, entityClass.default || entityClass);
        }
      } catch (error) {
        this.logger.warn(`Error loading entity ${entityName}:`, error);
      }
    }
    
    return entities;
  }

  /**
   * Load events from module
   */
  private async loadEvents(module: ModuleMetadata): Promise<Map<string, any>> {
    const events = new Map<string, any>();
    
    for (const eventName of module.events || []) {
      try {
        const eventPath = path.join(module.path, 'src', 'events', `${eventName}.event.ts`);
        
        if (fs.existsSync(eventPath)) {
          // Clear require cache
          delete require.cache[require.resolve(eventPath)];
          
          const eventClass = require(eventPath);
          events.set(eventName, eventClass.default || eventClass);
        }
      } catch (error) {
        this.logger.warn(`Error loading event ${eventName}:`, error);
      }
    }
    
    return events;
  }

  /**
   * Load hooks from module
   */
  private async loadHooks(module: ModuleMetadata): Promise<Map<string, any>> {
    const hooks = new Map<string, any>();
    
    for (const hookName of module.hooks || []) {
      try {
        const hookPath = path.join(module.path, 'src', 'hooks', `${hookName}.hook.ts`);
        
        if (fs.existsSync(hookPath)) {
          // Clear require cache
          delete require.cache[require.resolve(hookPath)];
          
          const hookClass = require(hookPath);
          hooks.set(hookName, hookClass.default || hookClass);
        }
      } catch (error) {
        this.logger.warn(`Error loading hook ${hookName}:`, error);
      }
    }
    
    return hooks;
  }

  /**
   * Register module with NestJS
   */
  private async registerWithNestJS(loadedModule: LoadedModule): Promise<void> {
    // This would integrate with NestJS's dynamic module system
    // For now, we'll just log the registration
    this.logger.log(`🔧 Registering ${loadedModule.name} with NestJS`);
    
    // TODO: Implement actual NestJS module registration
    // This would involve creating a dynamic module and registering it
    // with the NestJS application context
  }

  /**
   * Unregister module from NestJS
   */
  private async unregisterFromNestJS(loadedModule: LoadedModule): Promise<void> {
    // This would unregister the module from NestJS
    this.logger.log(`🔧 Unregistering ${loadedModule.name} from NestJS`);
    
    // TODO: Implement actual NestJS module unregistration
  }

  /**
   * Start file watching for hot-reloading
   */
  async startFileWatching(): Promise<void> {
    if (this.isWatching) {
      return;
    }

    this.logger.log('👀 Starting file watching for hot-reloading...');
    
    const modulesPath = path.join(process.cwd(), 'modules', '@deservefirst');
    
    if (!fs.existsSync(modulesPath)) {
      this.logger.warn('Modules directory not found, skipping file watching');
      return;
    }

    // Watch for changes in module files
    const watcher = chokidar.watch(modulesPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    watcher.on('add', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    watcher.on('unlink', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    this.watchers.set('modules', watcher);
    this.isWatching = true;

    this.logger.log('✅ File watching started');
  }

  /**
   * Handle file change for hot-reloading
   */
  private async handleFileChange(filePath: string): Promise<void> {
    try {
      // Extract module name from file path
      const moduleName = this.extractModuleNameFromPath(filePath);
      if (!moduleName) {
        return;
      }

      this.logger.log(`🔄 File changed: ${filePath}`);
      this.logger.log(`🔄 Reloading module: ${moduleName}`);

      // Reload the module
      await this.reloadModule(moduleName);

    } catch (error) {
      this.logger.error('Error handling file change:', error);
    }
  }

  /**
   * Extract module name from file path
   */
  private extractModuleNameFromPath(filePath: string): string | null {
    const modulesPath = path.join(process.cwd(), 'modules', '@deservefirst');
    const relativePath = path.relative(modulesPath, filePath);
    
    // Extract module name from path like "module-name/src/services/service.ts"
    const parts = relativePath.split(path.sep);
    if (parts.length > 0) {
      return parts[0];
    }
    
    return null;
  }

  /**
   * Stop file watching
   */
  async stopFileWatching(): Promise<void> {
    this.logger.log('🛑 Stopping file watching...');
    
    for (const [name, watcher] of this.watchers) {
      await watcher.close();
      this.logger.log(`✅ Stopped watcher: ${name}`);
    }
    
    this.watchers.clear();
    this.isWatching = false;
  }

  /**
   * Get loaded modules
   */
  getLoadedModules(): LoadedModule[] {
    return Array.from(this.loadedModules.values());
  }

  /**
   * Get loaded module by name
   */
  getLoadedModule(name: string): LoadedModule | undefined {
    return this.loadedModules.get(name);
  }

  /**
   * Check if module is loaded
   */
  isModuleLoaded(name: string): boolean {
    return this.loadedModules.has(name) && this.loadedModules.get(name)?.isLoaded === true;
  }

  /**
   * Get module loading status
   */
  getLoadingStatus(): Record<string, any> {
    const loaded = this.getLoadedModules();
    const total = this.moduleRegistry.getModules().length;
    
    return {
      total,
      loaded: loaded.length,
      modules: loaded.map(m => ({
        name: m.name,
        isLoaded: m.isLoaded,
        lastLoaded: m.lastLoaded,
        services: m.services.size,
        controllers: m.controllers.size,
        entities: m.entities.size,
        events: m.events.size,
        hooks: m.hooks.size,
      })),
    };
  }
}

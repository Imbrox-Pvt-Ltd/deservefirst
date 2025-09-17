import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleRegistryService, StoreModuleConfig } from './module-registry.service';

export interface CustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'json';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: any;
  options?: string[]; // For select/multiselect
  validation?: Record<string, any>;
  moduleName: string;
  storeId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreModuleSettings {
  storeId: string;
  moduleName: string;
  settings: Record<string, any>;
  customFields: CustomField[];
  enabled: boolean;
  version: string;
  lastUpdated: Date;
}

@Injectable()
export class StoreModuleRegistryService {
  private readonly logger = new Logger(StoreModuleRegistryService.name);
  private storeModuleCache = new Map<string, StoreModuleSettings[]>();

  constructor(
    private moduleRegistry: ModuleRegistryService,
    // @InjectRepository(StoreModuleSettings)
    // private storeModuleRepository: Repository<StoreModuleSettings>,
  ) {}

  /**
   * Enable a module for a specific store
   */
  async enableModuleForStore(
    storeId: string,
    moduleName: string,
    settings: Record<string, any> = {},
    customFields: CustomField[] = [],
  ): Promise<boolean> {
    try {
      // Check if module exists
      const module = this.moduleRegistry.getModule(moduleName);
      if (!module) {
        this.logger.error(`Module ${moduleName} not found`);
        return false;
      }

      // Load the module if not already loaded
      if (!this.moduleRegistry.isModuleLoaded(moduleName)) {
        const loaded = await this.moduleRegistry.loadModule(moduleName);
        if (!loaded) {
          this.logger.error(`Failed to load module ${moduleName}`);
          return false;
        }
      }

      // Create store module configuration
      const storeModule: StoreModuleSettings = {
        storeId,
        moduleName,
        settings,
        customFields,
        enabled: true,
        version: module.version,
        lastUpdated: new Date(),
      };

      // Update cache
      const storeModules = this.storeModuleCache.get(storeId) || [];
      const existingIndex = storeModules.findIndex(m => m.moduleName === moduleName);
      
      if (existingIndex >= 0) {
        storeModules[existingIndex] = storeModule;
      } else {
        storeModules.push(storeModule);
      }

      this.storeModuleCache.set(storeId, storeModules);

      // TODO: Persist to database
      // await this.storeModuleRepository.save(storeModule);

      this.logger.log(`🏪 Enabled module ${moduleName} for store ${storeId}`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Error enabling module ${moduleName} for store ${storeId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Disable a module for a specific store
   */
  async disableModuleForStore(storeId: string, moduleName: string): Promise<boolean> {
    try {
      const storeModules = this.storeModuleCache.get(storeId);
      if (!storeModules) return false;

      const moduleIndex = storeModules.findIndex(m => m.moduleName === moduleName);
      if (moduleIndex >= 0) {
        storeModules[moduleIndex].enabled = false;
        storeModules[moduleIndex].lastUpdated = new Date();
        
        this.logger.log(`🏪 Disabled module ${moduleName} for store ${storeId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`❌ Error disabling module ${moduleName} for store ${storeId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Get all modules for a store
   */
  getStoreModules(storeId: string): StoreModuleSettings[] {
    return this.storeModuleCache.get(storeId) || [];
  }

  /**
   * Get enabled modules for a store
   */
  getEnabledStoreModules(storeId: string): StoreModuleSettings[] {
    const storeModules = this.getStoreModules(storeId);
    return storeModules.filter(m => m.enabled);
  }

  /**
   * Get module settings for a store
   */
  getModuleSettings(storeId: string, moduleName: string): Record<string, any> {
    const storeModules = this.getStoreModules(storeId);
    const module = storeModules.find(m => m.moduleName === moduleName);
    return module?.settings || {};
  }

  /**
   * Update module settings for a store
   */
  async updateModuleSettings(
    storeId: string,
    moduleName: string,
    settings: Record<string, any>,
  ): Promise<boolean> {
    try {
      const storeModules = this.getStoreModules(storeId);
      const module = storeModules.find(m => m.moduleName === moduleName);
      
      if (module) {
        module.settings = { ...module.settings, ...settings };
        module.lastUpdated = new Date();
        
        this.storeModuleCache.set(storeId, storeModules);
        
        // TODO: Persist to database
        // await this.storeModuleRepository.save(module);
        
        this.logger.log(`⚙️ Updated settings for module ${moduleName} in store ${storeId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`❌ Error updating settings for module ${moduleName} in store ${storeId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Add custom field to a module
   */
  async addCustomField(
    storeId: string,
    moduleName: string,
    customField: Omit<CustomField, 'id' | 'moduleName' | 'storeId' | 'createdAt' | 'updatedAt'>,
  ): Promise<boolean> {
    try {
      const storeModules = this.getStoreModules(storeId);
      const module = storeModules.find(m => m.moduleName === moduleName);
      
      if (module) {
        const newField: CustomField = {
          ...customField,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          moduleName,
          storeId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        module.customFields.push(newField);
        module.lastUpdated = new Date();
        
        this.storeModuleCache.set(storeId, storeModules);
        
        this.logger.log(`🔧 Added custom field ${customField.name} to module ${moduleName} in store ${storeId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`❌ Error adding custom field to module ${moduleName} in store ${storeId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Remove custom field from a module
   */
  async removeCustomField(
    storeId: string,
    moduleName: string,
    fieldId: string,
  ): Promise<boolean> {
    try {
      const storeModules = this.getStoreModules(storeId);
      const module = storeModules.find(m => m.moduleName === moduleName);
      
      if (module) {
        const fieldIndex = module.customFields.findIndex(f => f.id === fieldId);
        if (fieldIndex >= 0) {
          module.customFields.splice(fieldIndex, 1);
          module.lastUpdated = new Date();
          
          this.storeModuleCache.set(storeId, storeModules);
          
          this.logger.log(`🗑️ Removed custom field ${fieldId} from module ${moduleName} in store ${storeId}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`❌ Error removing custom field from module ${moduleName} in store ${storeId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Get custom fields for a module
   */
  getCustomFields(storeId: string, moduleName: string): CustomField[] {
    const storeModules = this.getStoreModules(storeId);
    const module = storeModules.find(m => m.moduleName === moduleName);
    return module?.customFields || [];
  }

  /**
   * Get all custom fields for a store
   */
  getAllCustomFields(storeId: string): CustomField[] {
    const storeModules = this.getStoreModules(storeId);
    return storeModules.flatMap(m => m.customFields);
  }

  /**
   * Validate custom field data
   */
  validateCustomFieldData(
    storeId: string,
    moduleName: string,
    fieldName: string,
    value: any,
  ): { valid: boolean; error?: string } {
    const customFields = this.getCustomFields(storeId, moduleName);
    const field = customFields.find(f => f.name === fieldName);
    
    if (!field) {
      return { valid: false, error: `Custom field ${fieldName} not found` };
    }

    // Basic validation
    if (field.required && (value === undefined || value === null || value === '')) {
      return { valid: false, error: `Field ${fieldName} is required` };
    }

    // Type validation
    switch (field.type) {
      case 'number':
        if (value !== undefined && isNaN(Number(value))) {
          return { valid: false, error: `Field ${fieldName} must be a number` };
        }
        break;
      case 'boolean':
        if (value !== undefined && typeof value !== 'boolean') {
          return { valid: false, error: `Field ${fieldName} must be a boolean` };
        }
        break;
      case 'select':
        if (value !== undefined && !field.options?.includes(value)) {
          return { valid: false, error: `Field ${fieldName} must be one of: ${field.options?.join(', ')}` };
        }
        break;
      case 'multiselect':
        if (value !== undefined && Array.isArray(value)) {
          const invalidValues = value.filter(v => !field.options?.includes(v));
          if (invalidValues.length > 0) {
            return { valid: false, error: `Field ${fieldName} contains invalid values: ${invalidValues.join(', ')}` };
          }
        }
        break;
    }

    return { valid: true };
  }

  /**
   * Get store module health
   */
  getStoreModuleHealth(storeId: string): Record<string, any> {
    const storeModules = this.getStoreModules(storeId);
    const enabledModules = storeModules.filter(m => m.enabled);
    const totalCustomFields = storeModules.reduce((sum, m) => sum + m.customFields.length, 0);

    return {
      storeId,
      totalModules: storeModules.length,
      enabledModules: enabledModules.length,
      disabledModules: storeModules.length - enabledModules.length,
      totalCustomFields,
      modules: storeModules.map(m => ({
        name: m.moduleName,
        version: m.version,
        enabled: m.enabled,
        customFields: m.customFields.length,
        lastUpdated: m.lastUpdated,
      })),
    };
  }
}

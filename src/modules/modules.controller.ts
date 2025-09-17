import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ModuleRegistryService } from './module-registry.service';
import { StoreModuleRegistryService } from './store-module-registry.service';
import { DynamicModuleLoaderService } from './dynamic-module-loader.service';

@ApiTags('modules')
@Controller('modules')
export class ModulesController {
  constructor(
    private moduleRegistry: ModuleRegistryService,
    private storeModuleRegistry: StoreModuleRegistryService,
    private dynamicLoader: DynamicModuleLoaderService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all registered modules' })
  @ApiResponse({ status: 200, description: 'Modules retrieved successfully' })
  async getAllModules() {
    const modules = this.moduleRegistry.getModules();
    const loadedModules = this.moduleRegistry.getLoadedModules();
    const health = this.moduleRegistry.getModuleHealth();

    return {
      modules: modules.map(module => ({
        ...module,
        loaded: loadedModules.includes(module.name),
      })),
      health,
      total: modules.length,
      loaded: loadedModules.length,
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get module system health' })
  @ApiResponse({ status: 200, description: 'Module health retrieved successfully' })
  async getModuleHealth() {
    return this.moduleRegistry.getModuleHealth();
  }

  @Post('load/:moduleName')
  @ApiOperation({ summary: 'Load a specific module' })
  @ApiParam({ name: 'moduleName', description: 'Name of the module to load' })
  @ApiResponse({ status: 200, description: 'Module loaded successfully' })
  @ApiResponse({ status: 404, description: 'Module not found' })
  async loadModuleFromRegistry(@Param('moduleName') moduleName: string) {
    const success = await this.moduleRegistry.loadModule(moduleName);
    if (!success) {
      return { success: false, message: `Failed to load module ${moduleName}` };
    }
    return { success: true, message: `Module ${moduleName} loaded successfully` };
  }

  @Get('store/:storeId')
  @ApiOperation({ summary: 'Get modules for a specific store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Store modules retrieved successfully' })
  async getStoreModules(@Param('storeId') storeId: string) {
    const modules = this.storeModuleRegistry.getStoreModules(storeId);
    const enabledModules = this.storeModuleRegistry.getEnabledStoreModules(storeId);
    const health = this.storeModuleRegistry.getStoreModuleHealth(storeId);

    return {
      storeId,
      modules,
      enabledModules,
      health,
      total: modules.length,
      enabled: enabledModules.length,
    };
  }

  @Post('store/:storeId/enable')
  @ApiOperation({ summary: 'Enable a module for a store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Module enabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async enableStoreModule(
    @Param('storeId') storeId: string,
    @Body() body: { moduleName: string; settings?: Record<string, any>; customFields?: any[] },
  ) {
    const { moduleName, settings = {}, customFields = [] } = body;
    
    const success = await this.storeModuleRegistry.enableModuleForStore(
      storeId,
      moduleName,
      settings,
      customFields,
    );

    if (!success) {
      return { success: false, message: `Failed to enable module ${moduleName} for store ${storeId}` };
    }

    return { success: true, message: `Module ${moduleName} enabled for store ${storeId}` };
  }

  @Post('store/:storeId/disable')
  @ApiOperation({ summary: 'Disable a module for a store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Module disabled successfully' })
  async disableStoreModule(
    @Param('storeId') storeId: string,
    @Body() body: { moduleName: string },
  ) {
    const { moduleName } = body;
    
    const success = await this.storeModuleRegistry.disableModuleForStore(storeId, moduleName);

    if (!success) {
      return { success: false, message: `Failed to disable module ${moduleName} for store ${storeId}` };
    }

    return { success: true, message: `Module ${moduleName} disabled for store ${storeId}` };
  }

  @Put('store/:storeId/settings')
  @ApiOperation({ summary: 'Update module settings for a store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Settings updated successfully' })
  async updateModuleSettings(
    @Param('storeId') storeId: string,
    @Body() body: { moduleName: string; settings: Record<string, any> },
  ) {
    const { moduleName, settings } = body;
    
    const success = await this.storeModuleRegistry.updateModuleSettings(
      storeId,
      moduleName,
      settings,
    );

    if (!success) {
      return { success: false, message: `Failed to update settings for module ${moduleName}` };
    }

    return { success: true, message: `Settings updated for module ${moduleName}` };
  }

  @Post('store/:storeId/custom-fields')
  @ApiOperation({ summary: 'Add custom field to a module' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Custom field added successfully' })
  async addCustomField(
    @Param('storeId') storeId: string,
    @Body() body: { 
      moduleName: string; 
      customField: {
        name: string;
        type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'json';
        label: string;
        description?: string;
        required: boolean;
        defaultValue?: any;
        options?: string[];
        validation?: Record<string, any>;
      };
    },
  ) {
    const { moduleName, customField } = body;
    
    const success = await this.storeModuleRegistry.addCustomField(
      storeId,
      moduleName,
      customField,
    );

    if (!success) {
      return { success: false, message: `Failed to add custom field to module ${moduleName}` };
    }

    return { success: true, message: `Custom field added to module ${moduleName}` };
  }

  @Delete('store/:storeId/custom-fields/:fieldId')
  @ApiOperation({ summary: 'Remove custom field from a module' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiParam({ name: 'fieldId', description: 'Custom field ID' })
  @ApiResponse({ status: 200, description: 'Custom field removed successfully' })
  async removeCustomField(
    @Param('storeId') storeId: string,
    @Param('fieldId') fieldId: string,
    @Query('moduleName') moduleName: string,
  ) {
    const success = await this.storeModuleRegistry.removeCustomField(
      storeId,
      moduleName,
      fieldId,
    );

    if (!success) {
      return { success: false, message: `Failed to remove custom field ${fieldId}` };
    }

    return { success: true, message: `Custom field ${fieldId} removed successfully` };
  }

  @Get('store/:storeId/custom-fields')
  @ApiOperation({ summary: 'Get custom fields for a store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiQuery({ name: 'moduleName', required: false, description: 'Filter by module name' })
  @ApiResponse({ status: 200, description: 'Custom fields retrieved successfully' })
  async getCustomFields(
    @Param('storeId') storeId: string,
    @Query('moduleName') moduleName?: string,
  ) {
    if (moduleName) {
      const customFields = this.storeModuleRegistry.getCustomFields(storeId, moduleName);
      return { storeId, moduleName, customFields };
    } else {
      const customFields = this.storeModuleRegistry.getAllCustomFields(storeId);
      return { storeId, customFields };
    }
  }

  @Post('store/:storeId/validate-custom-field')
  @ApiOperation({ summary: 'Validate custom field data' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateCustomFieldData(
    @Param('storeId') storeId: string,
    @Body() body: { moduleName: string; fieldName: string; value: any },
  ) {
    const { moduleName, fieldName, value } = body;
    
    const result = this.storeModuleRegistry.validateCustomFieldData(
      storeId,
      moduleName,
      fieldName,
      value,
    );

    return result;
  }

  @Get('store/:storeId/health')
  @ApiOperation({ summary: 'Get store module health' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  @ApiResponse({ status: 200, description: 'Store module health retrieved successfully' })
  async getStoreModuleHealth(@Param('storeId') storeId: string) {
    return this.storeModuleRegistry.getStoreModuleHealth(storeId);
  }

  // Dynamic Module Loading Endpoints
  @Post('dynamic-load/:moduleName')
  @ApiOperation({ summary: 'Load a module dynamically' })
  @ApiParam({ name: 'moduleName', description: 'Name of the module to load' })
  @ApiResponse({ status: 200, description: 'Module loaded successfully' })
  @ApiResponse({ status: 404, description: 'Module not found' })
  async loadModuleDynamically(@Param('moduleName') moduleName: string) {
    const success = await this.dynamicLoader.loadModule(moduleName);
    if (!success) {
      return { success: false, message: `Failed to load module ${moduleName}` };
    }
    return { success: true, message: `Module ${moduleName} loaded successfully` };
  }

  @Post('unload/:moduleName')
  @ApiOperation({ summary: 'Unload a module dynamically' })
  @ApiParam({ name: 'moduleName', description: 'Name of the module to unload' })
  @ApiResponse({ status: 200, description: 'Module unloaded successfully' })
  async unloadModule(@Param('moduleName') moduleName: string) {
    const success = await this.dynamicLoader.unloadModule(moduleName);
    if (!success) {
      return { success: false, message: `Failed to unload module ${moduleName}` };
    }
    return { success: true, message: `Module ${moduleName} unloaded successfully` };
  }

  @Post('reload/:moduleName')
  @ApiOperation({ summary: 'Reload a module dynamically' })
  @ApiParam({ name: 'moduleName', description: 'Name of the module to reload' })
  @ApiResponse({ status: 200, description: 'Module reloaded successfully' })
  async reloadModule(@Param('moduleName') moduleName: string) {
    const success = await this.dynamicLoader.reloadModule(moduleName);
    if (!success) {
      return { success: false, message: `Failed to reload module ${moduleName}` };
    }
    return { success: true, message: `Module ${moduleName} reloaded successfully` };
  }

  @Get('loaded')
  @ApiOperation({ summary: 'Get all loaded modules' })
  @ApiResponse({ status: 200, description: 'Loaded modules retrieved successfully' })
  async getLoadedModules() {
    const loadedModules = this.dynamicLoader.getLoadedModules();
    const status = this.dynamicLoader.getLoadingStatus();
    
    return {
      loadedModules: loadedModules.map(m => ({
        name: m.name,
        isLoaded: m.isLoaded,
        lastLoaded: m.lastLoaded,
        services: Array.from(m.services.keys()),
        controllers: Array.from(m.controllers.keys()),
        entities: Array.from(m.entities.keys()),
        events: Array.from(m.events.keys()),
        hooks: Array.from(m.hooks.keys()),
      })),
      status,
    };
  }

  @Get('loaded/:moduleName')
  @ApiOperation({ summary: 'Get loaded module details' })
  @ApiParam({ name: 'moduleName', description: 'Name of the module' })
  @ApiResponse({ status: 200, description: 'Module details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Module not found or not loaded' })
  async getLoadedModule(@Param('moduleName') moduleName: string) {
    const module = this.dynamicLoader.getLoadedModule(moduleName);
    if (!module) {
      return { success: false, message: `Module ${moduleName} not found or not loaded` };
    }

    return {
      success: true,
      module: {
        name: module.name,
        isLoaded: module.isLoaded,
        lastLoaded: module.lastLoaded,
        services: Array.from(module.services.keys()),
        controllers: Array.from(module.controllers.keys()),
        entities: Array.from(module.entities.keys()),
        events: Array.from(module.events.keys()),
        hooks: Array.from(module.hooks.keys()),
      },
    };
  }

  @Get('loading-status')
  @ApiOperation({ summary: 'Get module loading status' })
  @ApiResponse({ status: 200, description: 'Loading status retrieved successfully' })
  async getLoadingStatus() {
    return this.dynamicLoader.getLoadingStatus();
  }

  @Post('start-watching')
  @ApiOperation({ summary: 'Start file watching for hot-reloading' })
  @ApiResponse({ status: 200, description: 'File watching started successfully' })
  async startWatching() {
    await this.dynamicLoader.startFileWatching();
    return { success: true, message: 'File watching started' };
  }

  @Post('stop-watching')
  @ApiOperation({ summary: 'Stop file watching' })
  @ApiResponse({ status: 200, description: 'File watching stopped successfully' })
  async stopWatching() {
    await this.dynamicLoader.stopFileWatching();
    return { success: true, message: 'File watching stopped' };
  }
}

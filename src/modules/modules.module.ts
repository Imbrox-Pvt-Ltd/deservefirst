import { Module } from '@nestjs/common';
import { ModuleRegistryService } from './module-registry.service';
import { StoreModuleRegistryService } from './store-module-registry.service';
import { DynamicModuleLoaderService } from './dynamic-module-loader.service';
import { ModulesController } from './modules.controller';

@Module({
  controllers: [ModulesController],
  providers: [
    ModuleRegistryService,
    StoreModuleRegistryService,
    DynamicModuleLoaderService,
  ],
  exports: [
    ModuleRegistryService,
    StoreModuleRegistryService,
    DynamicModuleLoaderService,
  ],
})
export class ModulesModule {}

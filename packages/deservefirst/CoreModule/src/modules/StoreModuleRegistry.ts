import { Database } from '../database/Database';
import { Hooks } from '../hooks/Hooks';
import { Events } from '../events/Events';

export interface StoreModuleConfig {
  name: string;
  schema?: any;
  services?: { [key: string]: any };
  hooks?: { [key: string]: (payload: any) => Promise<void> };
  events?: { [key: string]: (payload: any) => Promise<void> };
}

export class StoreModuleRegistry {
  static async registerStoreModule(tenantId: string, storeId: string, module: StoreModuleConfig) {
    if (module.schema) {
      throw new Error('Store-level modules cannot define new schemas');
    }

    await Database.create('storeModules', {
      tenantId,
      storeId,
      name: module.name,
      services: module.services,
      hooks: Object.keys(module.hooks || {}),
      events: Object.keys(module.events || {}),
    });

    Object.entries(module.hooks || {}).forEach(([hookName, callback]) => {
      Hooks.register(hookName, callback);
    });
    Object.entries(module.events || {}).forEach(([eventName, callback]) => {
      Events.subscribe(eventName, callback);
    });
  }

  static async getStoreModules(tenantId: string, storeId: string) {
    return Database.find('storeModules', { tenantId, storeId });
  }
}

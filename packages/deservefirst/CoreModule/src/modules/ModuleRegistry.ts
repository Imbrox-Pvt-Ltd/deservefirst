import { MenuItem } from '../menu/MenuTypes';

export interface ModuleConfig {
  name: string;
  dependencies: string[];
  services: { [key: string]: any };
  events: { [key: string]: string };
  hooks: { [key: string]: string };
  routes: any[];
  permissions: { [key: string]: { description: string } };
  menu: MenuItem[];
  settings: any[];
}

export class ModuleRegistry {
  private static modules: ModuleConfig[] = [];

  static registerModule(config: ModuleConfig) {
    this.modules.push(config);
  }

  static getModules() {
    return this.modules;
  }
}

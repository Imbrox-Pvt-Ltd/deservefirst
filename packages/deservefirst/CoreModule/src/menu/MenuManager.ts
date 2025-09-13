import { MenuItem } from './MenuTypes';
import { ModuleRegistry } from '../modules/ModuleRegistry';

export class MenuManager {
  static getMenuItems(context: 'admin' | 'frontend') {
    const modules = ModuleRegistry.getModules();
    return modules
      .flatMap(module => module.menu || [])
      .filter(item => item.context === context)
      .sort((a, b) => a.order - b.order);
  }
}

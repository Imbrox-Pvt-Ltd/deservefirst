import { ModuleRegistry } from '@deservefirst/core-module';
import { routes } from './config/routes';
import { permissions } from './config/permissions';
import { menu } from './config/menu';
import { RoleService } from './services/RoleService';
import { PermissionService } from './services/PermissionService';
import { PolicyService } from './services/PolicyService';

export default class RBACModule {
  static async register() {
    await RoleService.init();
    await PermissionService.init();
    await PolicyService.init();

    ModuleRegistry.registerModule({
      name: 'RBACModule',
      dependencies: ['CoreModule'],
      services: {
        RoleService,
        PermissionService,
        PolicyService,
      },
      events: {
        'role.created': 'Role created',
        'permission.created': 'Permission created',
      },
      hooks: {
        'beforeRoleSave': 'Before role save',
        'afterRoleSave': 'After role save',
      },
      routes,
      permissions,
      menu,
      settings: [],
    });
  }
}

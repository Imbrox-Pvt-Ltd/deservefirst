import { Database, Events } from '@deservefirst/core-module';
import Permission from '../models/Permission';
import { ModuleRegistry } from '@deservefirst/core-module';

export class PermissionService {
  static async init() {
    // Register module permissions
    const modules = ModuleRegistry.getModules();
    for (const module of modules) {
      for (const [name, perm] of Object.entries(module.permissions || {})) {
        await this.createPermission('system', { name, description: perm.description });
      }
    }
  }

  static async createPermission(tenantId: string, data: any) {
    const permission = await Database.create(Permission, { ...data, tenantId });
    await Events.dispatch('permission.created', permission);
    return permission;
  }

  static async checkPermission(user: any, permission: string) {
    // Simplified permission check (to be implemented with policies)
    const policies = await Database.find('policies', { permissionId: permission });
    if (!policies.length) throw new Error('Permission denied');
  }
}

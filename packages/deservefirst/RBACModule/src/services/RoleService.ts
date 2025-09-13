import { Database, Events, Hooks } from '@deservefirst/core-module';
import Role from '../models/Role';

export class RoleService {
  static async init() {
    // Initialize if needed
  }

  static async createRole(tenantId: string, data: any) {
    await Hooks.execute('beforeRoleSave', { tenantId, data });
    const role = await Database.create(Role, { ...data, tenantId });
    await Events.dispatch('role.created', role);
    await Hooks.execute('afterRoleSave', role);
    return role;
  }

  static async getRoles(tenantId: string) {
    return Database.find(Role, { tenantId });
  }
}

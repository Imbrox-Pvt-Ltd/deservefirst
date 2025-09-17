import { Injectable } from '@nestjs/common';

@Injectable()
export class RbacService {
  async getRoles() {
    return [
      { id: '1', name: 'admin', description: 'Administrator role', permissions: ['read', 'write', 'delete'] },
      { id: '2', name: 'user', description: 'User role', permissions: ['read'] },
      { id: '3', name: 'guest', description: 'Guest role', permissions: [] },
    ];
  }

  async getPermissions() {
    return [
      { id: '1', name: 'read', description: 'Read permission' },
      { id: '2', name: 'write', description: 'Write permission' },
      { id: '3', name: 'delete', description: 'Delete permission' },
    ];
  }

  async createRole(createRoleDto: any) {
    return {
      id: Date.now().toString(),
      ...createRoleDto,
      createdAt: new Date().toISOString(),
    };
  }
}

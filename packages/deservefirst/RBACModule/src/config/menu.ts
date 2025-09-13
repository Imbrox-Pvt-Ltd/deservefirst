import { MenuItem } from '@deservefirst/core-module';

export const menu: MenuItem[] = [
  {
    id: 'rbac.roles',
    label: 'rbac.menu.roles',
    url: '/admin/rbac/roles',
    icon: 'role',
    permission: 'rbac:roles:read',
    context: 'admin',
    order: 1,
  },
];

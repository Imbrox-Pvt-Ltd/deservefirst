import { Router } from '@deservefirst/core-module';
import { RoleService } from '../services/RoleService';
import { PermissionService } from '../services/PermissionService';
import { PolicyService } from '../services/PolicyService';

export const routes = [
  {
    method: 'get',
    path: '/roles',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'rbac:roles:read');
      const { tenantId } = req.query;
      const roles = await RoleService.getRoles(tenantId);
      res.json(roles);
    },
  },
  {
    method: 'post',
    path: '/roles',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'rbac:roles:write');
      const { tenantId, ...data } = req.body;
      const role = await RoleService.createRole(tenantId, data);
      res.json(role);
    },
  },
  {
    method: 'get',
    path: '/policies',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'rbac:policies:read');
      const { tenantId } = req.query;
      const policies = await PolicyService.getPolicies(tenantId);
      res.json(policies);
    },
  },
];

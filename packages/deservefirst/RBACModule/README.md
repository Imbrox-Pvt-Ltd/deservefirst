# RBACModule

## Overview

RBACModule provides a comprehensive Role-Based Access Control (RBAC) system for the Deservefirst platform. It enables fine-grained permission management, role hierarchies, and secure access control for your applications.

## Features

- **Role Management**: Create, update, and delete user roles
- **Permission System**: Define granular permissions for resources and actions
- **Role Hierarchies**: Support for parent-child role relationships
- **User Assignment**: Assign multiple roles to users with context
- **Permission Checking**: Fast permission validation and authorization
- **Audit Trail**: Track role and permission changes
- **Multi-Tenant Support**: Tenant-isolated RBAC with proper data segregation
- **Caching**: Redis-based permission caching for performance
- **API Endpoints**: RESTful API for role and permission management

## Installation

```bash
npm install @deservefirst/rbac-module
```

## Quick Start

### Basic Setup

```typescript
import { ModuleOrchestrator } from '@deservefirst/core-module';

const orchestrator = ModuleOrchestrator.getInstance();

// Register RBAC Module
await orchestrator.registerModule('RBACModule', {
  name: 'RBACModule',
  version: '1.0.0',
  category: 'security',
  dependencies: ['CoreModule'],
  routes: [
    {
      method: 'get',
      path: '/roles',
      handler: (req, res) => {
        res.json({ roles: ['admin', 'user', 'guest'] });
      }
    },
    {
      method: 'get',
      path: '/permissions',
      handler: (req, res) => {
        res.json({ permissions: ['read', 'write', 'delete'] });
      }
    }
  ]
});
```

### Environment Variables

```bash
# RBAC Configuration
RBAC_CACHE_TTL=3600
RBAC_ENABLE_AUDIT=true
RBAC_DEFAULT_ROLE=user

# Database (inherited from CoreModule)
MYSQL_URL=mysql://username:password@localhost:3306/database_name
REDIS_URL=redis://localhost:6379
```

## Core Concepts

### Roles
Roles represent a collection of permissions that can be assigned to users. Roles can have hierarchical relationships.

### Permissions
Permissions define what actions can be performed on specific resources. They follow the format: `resource:action`

### Users
Users are assigned one or more roles, which grant them the associated permissions.

### Tenants
Multi-tenant support ensures data isolation between different organizations or contexts.

## API Reference

### Role Management

#### Create Role
```typescript
import { RoleService } from '@deservefirst/rbac-module';

const roleService = new RoleService();

// Create a new role
const role = await roleService.createRole({
  tenantId: 'tenant-123',
  name: 'content-manager',
  displayName: 'Content Manager',
  description: 'Can manage content and media',
  permissions: [
    'content:read',
    'content:write',
    'media:read',
    'media:upload'
  ],
  parentRoleId: 'user-role-id' // Optional parent role
});
```

#### Get Roles
```typescript
// Get all roles for a tenant
const roles = await roleService.getRoles('tenant-123');

// Get specific role
const role = await roleService.getRole('tenant-123', 'role-id');

// Get role hierarchy
const hierarchy = await roleService.getRoleHierarchy('tenant-123', 'role-id');
```

#### Update Role
```typescript
// Update role permissions
const updatedRole = await roleService.updateRole('tenant-123', 'role-id', {
  permissions: [
    'content:read',
    'content:write',
    'content:delete',
    'media:read'
  ]
});
```

#### Delete Role
```typescript
// Delete role (will fail if assigned to users)
const success = await roleService.deleteRole('tenant-123', 'role-id');
```

### Permission Management

#### Define Permissions
```typescript
import { PermissionService } from '@deservefirst/rbac-module';

const permissionService = new PermissionService();

// Create permission
const permission = await permissionService.createPermission({
  tenantId: 'tenant-123',
  resource: 'content',
  action: 'publish',
  description: 'Ability to publish content'
});

// Bulk create permissions
const permissions = await permissionService.createPermissions('tenant-123', [
  { resource: 'user', action: 'read', description: 'View user profiles' },
  { resource: 'user', action: 'write', description: 'Edit user profiles' },
  { resource: 'user', action: 'delete', description: 'Delete user accounts' }
]);
```

#### Get Permissions
```typescript
// Get all permissions
const allPermissions = await permissionService.getPermissions('tenant-123');

// Get permissions by resource
const userPermissions = await permissionService.getPermissionsByResource('tenant-123', 'user');

// Check if permission exists
const exists = await permissionService.hasPermission('tenant-123', 'user:delete');
```

### User Role Assignment

#### Assign Roles to Users
```typescript
import { UserRoleService } from '@deservefirst/rbac-module';

const userRoleService = new UserRoleService();

// Assign single role
await userRoleService.assignRole({
  tenantId: 'tenant-123',
  userId: 'user-456',
  roleId: 'content-manager-role',
  assignedBy: 'admin-user-id',
  context: { department: 'marketing' } // Optional context
});

// Assign multiple roles
await userRoleService.assignRoles('tenant-123', 'user-456', [
  'content-manager-role',
  'social-media-role'
]);
```

#### Get User Roles
```typescript
// Get all roles for a user
const userRoles = await userRoleService.getUserRoles('tenant-123', 'user-456');

// Get effective permissions (including inherited)
const permissions = await userRoleService.getUserPermissions('tenant-123', 'user-456');

// Check if user has specific role
const hasRole = await userRoleService.userHasRole('tenant-123', 'user-456', 'admin');
```

#### Remove Roles
```typescript
// Remove specific role
await userRoleService.removeRole('tenant-123', 'user-456', 'content-manager-role');

// Remove all roles
await userRoleService.removeAllRoles('tenant-123', 'user-456');
```

### Permission Checking

#### Authorization Middleware
```typescript
import { AuthorizationMiddleware } from '@deservefirst/rbac-module';

// Express middleware for route protection
const requirePermission = AuthorizationMiddleware.requirePermission('content:write');

app.post('/api/content', requirePermission, (req, res) => {
  // Only users with 'content:write' permission can access
  res.json({ message: 'Content created' });
});

// Multiple permissions (OR logic)
const requireAnyPermission = AuthorizationMiddleware.requireAnyPermission([
  'content:write',
  'content:admin'
]);

// Multiple permissions (AND logic)
const requireAllPermissions = AuthorizationMiddleware.requireAllPermissions([
  'content:read',
  'user:read'
]);
```

#### Programmatic Permission Checking
```typescript
import { AuthorizationService } from '@deservefirst/rbac-module';

const authService = new AuthorizationService();

// Check single permission
const canWrite = await authService.hasPermission(
  'tenant-123',
  'user-456',
  'content:write'
);

// Check multiple permissions
const permissions = await authService.checkPermissions(
  'tenant-123',
  'user-456',
  ['content:read', 'content:write', 'content:delete']
);

// Get all user permissions
const allPermissions = await authService.getUserPermissions('tenant-123', 'user-456');
```

## REST API Endpoints

### Roles API

```http
# Get all roles
GET /api/rbacmodule/roles
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Create role
POST /api/rbacmodule/roles
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "name": "content-manager",
  "displayName": "Content Manager",
  "description": "Can manage content",
  "permissions": ["content:read", "content:write"]
}

# Get specific role
GET /api/rbacmodule/roles/{roleId}
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Update role
PUT /api/rbacmodule/roles/{roleId}
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "permissions": ["content:read", "content:write", "content:delete"]
}

# Delete role
DELETE /api/rbacmodule/roles/{roleId}
Authorization: Bearer <token>
Tenant-ID: tenant-123
```

### Permissions API

```http
# Get all permissions
GET /api/rbacmodule/permissions
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Create permission
POST /api/rbacmodule/permissions
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "resource": "content",
  "action": "publish",
  "description": "Ability to publish content"
}

# Get permissions by resource
GET /api/rbacmodule/permissions?resource=content
Authorization: Bearer <token>
Tenant-ID: tenant-123
```

### User Roles API

```http
# Get user roles
GET /api/rbacmodule/users/{userId}/roles
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Assign role to user
POST /api/rbacmodule/users/{userId}/roles
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "roleId": "content-manager-role",
  "context": { "department": "marketing" }
}

# Remove role from user
DELETE /api/rbacmodule/users/{userId}/roles/{roleId}
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Check user permissions
GET /api/rbacmodule/users/{userId}/permissions
Authorization: Bearer <token>
Tenant-ID: tenant-123
```

## Advanced Features

### Role Hierarchies

```typescript
// Create parent-child role relationship
const adminRole = await roleService.createRole({
  tenantId: 'tenant-123',
  name: 'admin',
  permissions: ['*'] // All permissions
});

const managerRole = await roleService.createRole({
  tenantId: 'tenant-123',
  name: 'manager',
  parentRoleId: adminRole.id, // Inherits admin permissions
  permissions: ['team:manage']
});

// Get effective permissions (includes inherited)
const effectivePermissions = await roleService.getEffectivePermissions(
  'tenant-123',
  managerRole.id
);
```

### Conditional Permissions

```typescript
// Context-based permission checking
const canEdit = await authService.hasPermissionWithContext(
  'tenant-123',
  'user-456',
  'content:edit',
  {
    resourceId: 'content-123',
    department: 'marketing'
  }
);

// Custom permission evaluator
const customEvaluator = (user, permission, context) => {
  if (permission === 'content:edit' && context.resourceId) {
    // Check if user owns the content
    return user.id === context.ownerId;
  }
  return false;
};

authService.addPermissionEvaluator(customEvaluator);
```

### Audit Trail

```typescript
import { AuditService } from '@deservefirst/rbac-module';

const auditService = new AuditService();

// Get role assignment history
const auditLog = await auditService.getRoleAuditLog('tenant-123', 'user-456');

// Get permission changes
const permissionChanges = await auditService.getPermissionChanges(
  'tenant-123',
  'role-id',
  { startDate: '2023-01-01', endDate: '2023-12-31' }
);

// Track custom events
await auditService.logEvent({
  tenantId: 'tenant-123',
  userId: 'user-456',
  action: 'permission_check',
  resource: 'content:write',
  result: 'granted',
  context: { ip: '192.168.1.1' }
});
```

## Performance Optimization

### Caching Strategy

```typescript
// Configure permission caching
const cacheConfig = {
  userPermissionsTTL: 3600, // 1 hour
  rolePermissionsTTL: 7200, // 2 hours
  enableDistributedCache: true
};

// Warm up cache for frequently accessed users
await authService.warmUpUserCache('tenant-123', ['user-1', 'user-2', 'user-3']);

// Invalidate cache when roles change
await authService.invalidateUserCache('tenant-123', 'user-456');
```

### Bulk Operations

```typescript
// Bulk role assignments
await userRoleService.bulkAssignRoles([
  { tenantId: 'tenant-123', userId: 'user-1', roleId: 'role-1' },
  { tenantId: 'tenant-123', userId: 'user-2', roleId: 'role-1' },
  { tenantId: 'tenant-123', userId: 'user-3', roleId: 'role-2' }
]);

// Bulk permission checks
const results = await authService.bulkCheckPermissions([
  { tenantId: 'tenant-123', userId: 'user-1', permission: 'content:read' },
  { tenantId: 'tenant-123', userId: 'user-2', permission: 'content:write' }
]);
```

## Security Best Practices

### Principle of Least Privilege
```typescript
// Always assign minimal required permissions
const viewerRole = await roleService.createRole({
  name: 'content-viewer',
  permissions: ['content:read'] // Only read access
});

// Avoid wildcard permissions except for admin roles
const adminRole = await roleService.createRole({
  name: 'super-admin',
  permissions: ['*'] // Use sparingly
});
```

### Input Validation
```typescript
// Validate role names and permissions
const isValidRoleName = (name) => /^[a-z0-9-_]+$/.test(name);
const isValidPermission = (perm) => /^[a-z0-9-_]+:[a-z0-9-_]+$/.test(perm);

// Sanitize user inputs
const sanitizedRoleName = roleName.toLowerCase().replace(/[^a-z0-9-_]/g, '');
```

### Audit and Monitoring
```typescript
// Enable comprehensive audit logging
const auditConfig = {
  logAllPermissionChecks: true,
  logRoleChanges: true,
  logFailedAttempts: true,
  retentionDays: 90
};

// Monitor suspicious activities
const suspiciousActivity = await auditService.detectAnomalies('tenant-123', {
  timeWindow: '24h',
  thresholds: {
    failedPermissionChecks: 100,
    roleChanges: 10
  }
});
```

## Testing

### Unit Tests
```typescript
import { RoleService } from '@deservefirst/rbac-module';
import { expect } from 'chai';

describe('RoleService', () => {
  let roleService: RoleService;

  beforeEach(() => {
    roleService = new RoleService();
  });

  it('should create a role with permissions', async () => {
    const role = await roleService.createRole({
      tenantId: 'test-tenant',
      name: 'test-role',
      permissions: ['test:read']
    });

    expect(role.name).to.equal('test-role');
    expect(role.permissions).to.include('test:read');
  });
});
```

### Integration Tests
```typescript
import request from 'supertest';
import { app } from '../app';

describe('RBAC API', () => {
  it('should require authentication for role creation', async () => {
    const response = await request(app)
      .post('/api/rbacmodule/roles')
      .send({ name: 'test-role' });

    expect(response.status).to.equal(401);
  });

  it('should create role with valid token', async () => {
    const response = await request(app)
      .post('/api/rbacmodule/roles')
      .set('Authorization', 'Bearer valid-token')
      .set('Tenant-ID', 'test-tenant')
      .send({
        name: 'test-role',
        permissions: ['test:read']
      });

    expect(response.status).to.equal(201);
    expect(response.body.name).to.equal('test-role');
  });
});
```

## Troubleshooting

### Common Issues

1. **Permission Denied Errors**
   ```typescript
   // Debug permission checking
   const debug = await authService.debugPermissionCheck(
     'tenant-123',
     'user-456',
     'content:write'
   );
   console.log('Permission check details:', debug);
   ```

2. **Role Hierarchy Issues**
   ```typescript
   // Check for circular dependencies
   const circularCheck = await roleService.checkCircularDependency(
     'tenant-123',
     'parent-role-id',
     'child-role-id'
   );
   ```

3. **Cache Inconsistencies**
   ```typescript
   // Force cache refresh
   await authService.refreshCache('tenant-123');
   
   // Check cache status
   const cacheStats = await authService.getCacheStats();
   ```

## Migration Guide

### From v1.0 to v2.0
```typescript
// Old API (v1.0)
const hasPermission = await rbac.checkPermission(userId, 'content:write');

// New API (v2.0)
const hasPermission = await authService.hasPermission(
  tenantId,
  userId,
  'content:write'
);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**Note**: This module requires CoreModule as a dependency and Node.js 16+.
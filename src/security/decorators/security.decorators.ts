import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';
export const PUBLIC_KEY = 'isPublic';
export const MFA_REQUIRED_KEY = 'mfaRequired';
export const API_KEY_REQUIRED_KEY = 'apiKeyRequired';
export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Decorator to mark a route as public (no authentication required)
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Decorator to require specific roles
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator to require specific permissions
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Decorator to require MFA
 */
export const MfaRequired = () => SetMetadata(MFA_REQUIRED_KEY, true);

/**
 * Decorator to require API key
 */
export const ApiKeyRequired = () => SetMetadata(API_KEY_REQUIRED_KEY, true);

/**
 * Decorator to set rate limit
 */
export const RateLimit = (limit: number, windowMs: number = 60000) => 
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs });

/**
 * Decorator to require admin role
 */
export const AdminOnly = () => Roles('admin');

/**
 * Decorator to require user role
 */
export const UserOnly = () => Roles('user');

/**
 * Decorator to require specific permission
 */
export const RequirePermission = (permission: string) => Permissions(permission);

/**
 * Decorator to require multiple permissions (all must be present)
 */
export const RequireAllPermissions = (...permissions: string[]) => Permissions(...permissions);

/**
 * Decorator to require any of the specified permissions (at least one must be present)
 */
export const RequireAnyPermission = (...permissions: string[]) => Permissions(...permissions);

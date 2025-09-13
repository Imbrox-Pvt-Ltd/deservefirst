RBACModule
==========

Purpose
-------
Provides role-based access control: Roles, Permissions, Policies. Registers permissions declared by other modules.

How to use
----------
- Register the module:
  await RBACModule.register();

- Use PermissionService.checkPermission(user, permission) in route handlers.

Security & Scalability notes
----------------------------
- PermissionService currently uses database lookups. For production at scale:
  - Move permission checks to a fast Policy Engine (e.g., OPA).
  - Cache permission decisions in Redis with short TTLs and invalidate on policy updates.
  - Support attribute-based checks for complex rules.


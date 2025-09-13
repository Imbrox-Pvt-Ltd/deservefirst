CMSModule
=========

Purpose
-------
CMSModule provides content management capabilities: Pages, Blocks, URL rewrites, and Custom Fields. It depends on CoreModule and RBACModule.

How to use
----------
- Register the module during bootstrap:
  await CMSModule.register();

- Use services (PageService, BlockService, etc.) inside other modules or APIs.

Security & Scalability notes
----------------------------
- All operations check permissions via RBAC; ensure PermissionService.checkPermission is wired to a centralized AuthZ service.
- Use event-driven indexing: upon page or block changes, publish events consumed by async indexers.
- For high-scale tenants, create per-tenant indices in Elasticsearch and separate indexing pipelines.


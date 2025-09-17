CMSModule Directory Structure (npm Module)
├── deservefirst-cms-module/                    // Separate Git repository
│   ├── src/
│   │   ├── index.ts                           // Module entry point and registration
│   │   ├── models/                            // Data models (database schemas)
│   │   │   ├── Page.ts                        // CMS page schema (title, content, urlKey, tenantId, storeId)
│   │   │   ├── Block.ts                       // CMS block schema (identifier, content, tenantId, storeId)
│   │   │   ├── UrlRewrite.ts                  // SEO-friendly URL rewrites
│   │   │   └── CustomFields.ts                // Store-specific custom fields
│   │   ├── services/                          // Business logic
│   │   │   ├── PageService.ts                 // CRUD for CMS pages
│   │   │   ├── BlockService.ts                // CRUD for CMS blocks
│   │   │   ├── UrlRewriteService.ts           // SEO-friendly URL management
│   │   │   └── CustomFieldsService.ts         // Manage store-specific custom fields
│   │   ├── events/                            // Event definitions
│   │   │   ├── CMSEvents.ts                   // Events: PageCreated, BlockUpdated, etc.
│   │   │   └── EventTypes.ts                  // TypeScript interfaces for events
│   │   ├── hooks/                             // Hook definitions
│   │   │   ├── CMSHooks.ts                    // Hooks: BeforePageSave, AfterBlockDelete
│   │   │   └── HookTypes.ts                   // TypeScript interfaces for hooks
│   │   ├── views/                             // React components for admin/frontend
│   │   │   ├── admin/
│   │   │   │   ├── PageGrid.tsx               // Page management grid
│   │   │   │   ├── PageEditor.tsx             // Page editor with WYSIWYG
│   │   │   │   ├── BlockGrid.tsx              // Block management grid
│   │   │   │   ├── BlockEditor.tsx            // Block editor
│   │   │   │   └── CustomFieldsEditor.tsx     // Editor for store-specific custom fields
│   │   │   └── frontend/
│   │   │       ├── PageView.tsx               // Render CMS page
│   │   │       └── BlockView.tsx              // Render CMS block
│   │   ├── i18n/                              // Multi-language support
│   │   │   ├── en_US.json                     // English translations
│   │   │   ├── es.json                        // Spanish translations
│   │   │   └── fr.json                        // French translations
│   │   ├── config/                            // Module-specific configurations
│   │   │   ├── routes.ts                      // API routes with permission mappings
│   │   │   ├── permissions.ts                 // RBAC permissions (e.g., cms:view)
│   │   │   ├── menu.ts                        // Menu items for admin/frontend navigation
│   │   │   ├── settings.json                  // JSON-based configuration sections
│   │   │   └── defaults.ts                    // Default settings values
│   │   ├── tests/                             // Module-specific tests
│   │   │   ├── unit/
│   │   │   │   ├── PageService.test.ts        // Unit tests for PageService
│   │   │   │   ├── BlockService.test.ts       // Unit tests for BlockService
│   │   │   │   └── CustomFieldsService.test.ts// Unit tests for CustomFieldsService
│   │   │   └── integration/
│   │   │       └── CMSAPI.test.ts             // Integration tests for API endpoints
│   │   └── schema/                            // Database schema definitions
│   │       ├── PageSchema.ts                  // Schema for Page
│   │       ├── BlockSchema.ts                 // Schema for Block
│   │       ├── UrlRewriteSchema.ts            // Schema for UrlRewrite
│   │       └── CustomFieldsSchema.ts          // Schema for store-specific custom fields
│   ├── package.json                            // npm module metadata
│   ├── README.md                              // Module documentation
│   ├── tsconfig.json                          // TypeScript configuration
│   └── .gitignore                             // Git ignore file

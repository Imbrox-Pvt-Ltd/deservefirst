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

npm Module Setup
The CMSModule will be hosted in a separate Git repository (e.g., github.com/deservefirst/deservefirst-cms-module) and published to npm as @deservefirst/cms-module.
1. package.json
{
  "name": "@deservefirst/cms-module",
  "version": "1.0.0",
  "description": "CMS module for Deservefirst platform",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "mocha tests/**/*.test.ts",
    "publish": "npm publish"
  },
  "dependencies": {
    "@deservefirst/core-module": "^1.0.0",
    "@deservefirst/rbac-module": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "mocha": "^10.0.0",
    "@types/node": "^20.0.0"
  },
  "author": "Deservefirst Team",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deservefirst/deservefirst-cms-module.git"
  }
}

2. Module Registration (index.ts)
The module auto-registers with ModuleRegistry when installed, ensuring seamless integration.
import { ModuleRegistry } from '@deservefirst/core-module';
import { PageService, BlockService, UrlRewriteService, CustomFieldsService } from './services';
import { CMSEvents } from './events/CMSEvents';
import { CMSHooks } from './hooks/CMSHooks';
import routes from './config/routes';
import permissions from './config/permissions';
import menu from './config/menu';
import settings from './config/settings.json';

export default class CMSModule {
  static register() {
    ModuleRegistry.registerModule({
      name: 'CMSModule',
      dependencies: ['CoreModule', 'RBACModule'],
      services: { PageService, BlockService, UrlRewriteService, CustomFieldsService },
      events: CMSEvents,
      hooks: CMSHooks,
      routes,
      permissions,
      menu,
      settings,
    });
  }
}

// Auto-register when module is imported
CMSModule.register();

Store-Level Module Flexibility
To support store-specific modules, we’ll introduce a StoreModuleRegistry and a CustomFields mechanism, ensuring store owners can create modules without modifying core database schemas.
1. StoreModuleRegistry (src/core/modules/StoreModuleRegistry.ts)

Purpose: Manages store-specific modules, scoped by tenantId and storeId, with restrictions to prevent schema modifications.
Example:

import { Database } from '../database/Database';
import { Hooks } from '../hooks/Hooks';
import { Events } from '../events/Events';

export class StoreModuleRegistry {
  static async registerStoreModule(tenantId: string, storeId: string, module: any) {
    // Validate module to ensure no schema modifications
    if (module.schema) {
      throw new Error('Store-level modules cannot define new schemas');
    }

    // Register module metadata
    await Database.create('storeModules', {
      tenantId,
      storeId,
      name: module.name,
      services: module.services,
      hooks: module.hooks,
      events: module.events,
    });

    // Register hooks and events
    Object.entries(module.hooks || {}).forEach(([hookName, callback]) => {
      Hooks.register(hookName, callback);
    });
    Object.entries(module.events || {}).forEach(([eventName, callback]) => {
      Events.subscribe(eventName, callback);
    });
  }

  static async getStoreModules(tenantId: string, storeId: string) {
    return Database.find('storeModules', { tenantId, storeId });
  }
}

2. CustomFields Model (models/CustomFields.ts)

Purpose: Allows store owners to add custom fields to pages or blocks, stored in a flexible customFields object.
Example:

import { Database } from '@deservefirst/core-module';

const CustomFieldsSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, required: true, index: true },
  entityType: { type: String, enum: ['page', 'block'], required: true },
  entityId: { type: String, required: true },
  fields: { type: Object }, // e.g., { "bannerImage": "url", "customText": "value" }
}, { timestamps: true });

export default Database.model('CustomFields', CustomFieldsSchema);

3. CustomFieldsService (services/CustomFieldsService.ts)

Purpose: Manages store-specific custom fields, ensuring they are scoped and validated.
Example:

import { Database } from '@deservefirst/core-module';
import { Hooks } from '@deservefirst/core-module';
import { Events } from '@deservefirst/core-module';
import { CMSHooks } from '../hooks/CMSHooks';
import { CMSEvents } from '../events/CMSEvents';
import CustomFieldsModel from '../models/CustomFields';

export class CustomFieldsService {
  async addCustomField(tenantId: string, storeId: string, entityType: 'page' | 'block', entityId: string, fieldName: string, fieldValue: any) {
    await Hooks.execute(CMSHooks.BEFORE_CUSTOM_FIELD_ADD, { tenantId, storeId, entityType, entityId, fieldName, fieldValue });
    
    // Validate field name (e.g., alphanumeric, no reserved keywords)
    if (!/^[a-zA-Z0-9]+$/.test(fieldName)) {
      throw new Error('Invalid field name');
    }

    const customFields = await Database.findOne(CustomFieldsModel, { tenantId, storeId, entityType, entityId }) || {};
    customFields.fields = { ...customFields.fields, [fieldName]: fieldValue };
    
    await Database.update(CustomFieldsModel, { tenantId, storeId, entityType, entityId }, customFields, { upsert: true });
    Events.dispatch(CMSEvents.CUSTOM_FIELD_ADDED, { tenantId, storeId, entityType, entityId, fieldName, fieldValue });
  }

  async getCustomFields(tenantId: string, storeId: string, entityType: 'page' | 'block', entityId: string) {
    const customFields = await Database.findOne(CustomFieldsModel, { tenantId, storeId, entityType, entityId });
    return customFields ? customFields.fields : {};
  }
}

4. Updated Page Model (models/Page.ts)

Change: Add storeId and customFields to support store-specific scoping and field extensions.

import { Database } from '@deservefirst/core-module';

const PageSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true }, // Optional, for store-specific pages
  title: { type: String, required: true },
  urlKey: { type: String, required: true, unique: true },
  content: { type: String },
  isActive: { type: Boolean, default: true },
  metaTitle: { type: String },
  metaDescription: { type: String },
  customFields: { type: Object, default: {} }, // Store-specific custom fields
}, { timestamps: true });

export default Database.model('Page', PageSchema);

5. Updated PageService (services/PageService.ts)

Change: Support store-specific pages and integrate custom fields.

import { Database } from '@deservefirst/core-module';
import { Hooks } from '@deservefirst/core-module';
import { Events } from '@deservefirst/core-module';
import { CMSEvents } from '../events/CMSEvents';
import { CMSHooks } from '../hooks/CMSHooks';
import PageModel from '../models/Page';
import { CustomFieldsService } from './CustomFieldsService';

export class PageService {
  async createPage(data: any, tenantId: string, storeId?: string) {
    await Hooks.execute(CMSHooks.BEFORE_PAGE_CREATE, { data, tenantId, storeId });
    const page = await Database.create(PageModel, { ...data, tenantId, storeId });
    
    // Apply custom fields if provided
    if (data.customFields && storeId) {
      for (const [fieldName, fieldValue] of Object.entries(data.customFields)) {
        await CustomFieldsService.addCustomField(tenantId, storeId, 'page', page._id, fieldName, fieldValue);
      }
    }
    
    Events.dispatch(CMSEvents.PAGE_CREATED, { page, tenantId, storeId });
    return page;
  }

  async getPages(tenantId: string, storeId?: string, query: any = {}) {
    return Database.find(PageModel, { tenantId, storeId, ...query });
  }
}

6. Store-Specific Custom Module Example
A store owner can create a custom module (e.g., CustomCMSModule) scoped to their store, using hooks and custom fields.
Example (store-specific module):
// store-modules/tenant1/store1/CustomCMSModule.ts
import { StoreModuleRegistry } from '@deservefirst/core-module';
import { CMSHooks } from '@deservefirst/cms-module';

export default class CustomCMSModule {
  static register(tenantId: string, storeId: string) {
    StoreModuleRegistry.registerStoreModule(tenantId, storeId, {
      name: 'CustomCMSModule',
      hooks: {
        [CMSHooks.BEFORE_PAGE_CREATE]: async ({ data }) => {
          // Add custom validation or data modification
          if (!data.customFields?.bannerImage) {
            throw new Error('Banner image required for store pages');
          }
        },
      },
      services: {
        async addCustomPageData(pageId: string, data: any) {
          // Use CustomFieldsService to add store-specific data
          return CustomFieldsService.addCustomField(tenantId, storeId, 'page', pageId, 'extraData', data);
        },
      },
    });
  }
}

7. Permissions (config/permissions.ts)
Add permissions for custom fields:
export default {
  'cms:view': { description: 'View CMS pages and blocks' },
  'cms:edit': { description: 'Edit CMS pages and blocks' },
  'cms:delete': { description: 'Delete CMS pages and blocks' },
  'cms:config': { description: 'Manage CMS settings' },
  'cms:custom_fields': { description: 'Manage store-specific custom fields' },
};

8. Menu (config/menu.ts)
Add menu item for custom fields editor:
import { MenuItem } from '@deservefirst/core-module';

const menuItems: MenuItem[] = [
  {
    id: 'cms-pages',
    label: 'cms.menu.pages',
    url: '/admin/cms/pages',
    icon: 'fa-file-alt',
    permission: 'cms:view',
    context: 'admin',
    order: 10,
  },
  {
    id: 'cms-blocks',
    label: 'cms.menu.blocks',
    url: '/admin/cms/blocks',
    icon: 'fa-cube',
    permission: 'cms:view',
    context: 'admin',
    order: 20,
  },
  {
    id: 'cms-custom-fields',
    label: 'cms.menu.custom_fields',
    url: '/admin/cms/custom-fields',
    icon: 'fa-cog',
    permission: 'cms:custom_fields',
    context: 'admin',
    order: 30,
  },
];

export default menuItems;

9. Settings (config/settings.json)
Add settings for custom field restrictions:
[
  {
    "id": "cms.enable_wysiwyg",
    "label": "cms.settings.enable_wysiwyg",
    "type": "boolean",
    "default": true,
    "permission": "cms:config",
    "required": false
  },
  {
    "id": "cms.default_page_layout",
    "label": "cms.settings.default_page_layout",
    "type": "select",
    "default": "1column",
    "permission": "cms:config",
    "options": [
      { "value": "1column", "label": "cms.settings.layout.1column" },
      { "value": "2columns", "label": "cms.settings.layout.2columns" }
    ],
    "required": true
  },
  {
    "id": "cms.url_prefix",
    "label": "cms.settings.url_prefix",
    "type": "text",
    "default": "cms",
    "permission": "cms:config",
    "validators": { "regex": "^[a-z0-9-]+$" },
    "required": false
  },
  {
    "id": "cms.max_custom_fields",
    "label": "cms.settings.max_custom_fields",
    "type": "number",
    "default": 10,
    "permission": "cms:config",
    "validators": { "min": 1, "max": 50 },
    "required": true
  }
]

10. i18n (i18n/en_US.json)
{
  "cms.menu.pages": "Pages",
  "cms.menu.blocks": "Blocks",
  "cms.menu.custom_fields": "Custom Fields",
  "cms.settings.enable_wysiwyg": "Enable WYSIWYG Editor",
  "cms.settings.default_page_layout": "Default Page Layout",
  "cms.settings.layout.1column": "One Column",
  "cms.settings.layout.2columns": "Two Columns",
  "cms.settings.url_prefix": "URL Prefix",
  "cms.settings.max_custom_fields": "Max Custom Fields per Store"
}

11. Tests (tests/unit/CustomFieldsService.test.ts)
import { expect } from 'chai';
import { CustomFieldsService } from '../services/CustomFieldsService';
import { Database } from '@deservefirst/core-module';
import sinon from 'sinon';

describe('CustomFieldsService', () => {
  it('should add a custom field', async () => {
    const stub = sinon.stub(Database, 'update').resolves();
    await CustomFieldsService.addCustomField('tenant1', 'store1', 'page', 'page1', 'bannerImage', 'url');
    expect(stub.calledOnce).to.be.true;
    stub.restore();
  });

  it('should reject invalid field name', async () => {
    try {
      await CustomFieldsService.addCustomField('tenant1', 'store1', 'page', 'page1', 'invalid@field', 'value');
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error.message).to.equal('Invalid field name');
    }
  });
});

Integration with Platform

npm Installation:
Install the module: npm install @deservefirst/cms-module.
The platform’s ModuleRegistry automatically detects and registers the module via its index.ts entry point.


Store-Level Modules:
Store owners upload custom modules to a tenant-specific directory (e.g., store-modules/tenant1/store1/).
StoreModuleRegistry.registerStoreModule validates and registers the module, restricting it to the store’s scope.


Custom Fields:
Store owners use CustomFieldsEditor.tsx to add fields (e.g., bannerImage) to pages or blocks.
CustomFieldsService stores fields in the CustomFields collection, linked to entityId and storeId.


Security:
RBAC restricts store-level modules to cms:custom_fields permission.
StoreModuleRegistry prevents schema modifications by rejecting modules with schema definitions.


Scalability:
Database sharding on tenantId and storeId handles 135TB across 20,000 merchants.
Cache abstraction (e.g., cms:tenant1:store1:page:about-us) ensures performance.



Workflow

Module Installation:
Install @deservefirst/cms-module via npm.
ModuleRegistry auto-registers routes, permissions, menus, and settings.


Store-Specific Module:
Store owner uploads CustomCMSModule to store-modules/tenant1/store1/.
StoreModuleRegistry registers it, enabling store-specific hooks and services.


Custom Fields:
Store owner adds a bannerImage field to a page via CustomFieldsEditor.tsx.
CustomFieldsService saves it to the CustomFields collection, accessible only for storeId.


Page Creation:
Admin creates a page with store-specific custom fields, saved via PageService and CustomFieldsService.


Rendering:
PageView.tsx renders pages, including custom fields, scoped by tenantId and storeId.



Magento Parity
The CMSModule matches Magento_Cms with pages, blocks, SEO URLs, and admin/frontend interfaces, while adding store-level flexibility not present in Magento’s multi-store model. The npm packaging mimics Magento’s module system, and the CustomFields mechanism provides store owners with extensibility without compromising platform stability.
This updated CMSModule is now an npm module, database-agnostic, and supports store-level customization, aligning with your vision for Deservefirst.com. If you need to develop another module or refine specific features (e.g., custom field validation), let me know!
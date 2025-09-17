# Module Structure Specification

## 🎯 Overview
This document defines the **Magento-style npm module structure** that all Deservefirst modules must follow for automatic registration and integration.

## 📦 Module Types

### **1. Core Modules** (`@deservefirst/core-*`)
- **Purpose**: Essential platform functionality
- **Examples**: `@deservefirst/core-module`, `@deservefirst/database-module`
- **Scope**: Global, affects entire platform
- **Dependencies**: None or other core modules only

### **2. Feature Modules** (`@deservefirst/*-module`)
- **Purpose**: Business functionality modules
- **Examples**: `@deservefirst/cms-module`, `@deservefirst/rbac-module`
- **Scope**: Global, available to all tenants
- **Dependencies**: Core modules + other feature modules

### **3. Store Modules** (`@deservefirst/store-*`)
- **Purpose**: Store-specific customizations
- **Examples**: `@deservefirst/store-custom-cms`, `@deservefirst/store-theme`
- **Scope**: Tenant/store specific
- **Dependencies**: Core + feature modules

## 🏗️ Standard Module Structure

```
@deservefirst/module-name/
├── src/
│   ├── index.ts                           # Module entry point and auto-registration
│   ├── models/                            # Data models (database schemas)
│   │   ├── EntityName.ts                  # Entity schema with tenantId, storeId
│   │   └── CustomFields.ts                # Store-specific custom fields
│   ├── services/                          # Business logic
│   │   ├── EntityService.ts               # CRUD operations
│   │   └── CustomFieldsService.ts         # Custom fields management
│   ├── events/                            # Event definitions
│   │   ├── ModuleEvents.ts                # Event constants
│   │   └── EventTypes.ts                  # TypeScript interfaces
│   ├── hooks/                             # Hook definitions
│   │   ├── ModuleHooks.ts                 # Hook constants
│   │   └── HookTypes.ts                   # TypeScript interfaces
│   ├── views/                             # React components
│   │   ├── admin/                         # Admin interface components
│   │   │   ├── EntityGrid.tsx             # Data grid component
│   │   │   ├── EntityEditor.tsx           # Editor component
│   │   │   └── CustomFieldsEditor.tsx     # Custom fields editor
│   │   └── frontend/                      # Frontend components
│   │       ├── EntityView.tsx             # Display component
│   │       └── EntityList.tsx             # List component
│   ├── i18n/                              # Multi-language support
│   │   ├── en_US.json                     # English translations
│   │   ├── es.json                        # Spanish translations
│   │   └── fr.json                        # French translations
│   ├── config/                            # Module configuration
│   │   ├── routes.ts                      # API routes with permissions
│   │   ├── permissions.ts                 # RBAC permissions
│   │   ├── menu.ts                        # Navigation menu items
│   │   ├── settings.json                  # Configuration schema
│   │   └── defaults.ts                    # Default values
│   ├── tests/                             # Module tests
│   │   ├── unit/                          # Unit tests
│   │   │   ├── EntityService.test.ts      # Service tests
│   │   │   └── CustomFieldsService.test.ts
│   │   ├── integration/                   # Integration tests
│   │   │   └── ModuleAPI.test.ts          # API endpoint tests
│   │   └── e2e/                           # End-to-end tests
│   │       └── ModuleWorkflow.test.ts     # Complete workflow tests
│   └── schema/                            # Database schema definitions
│       ├── EntitySchema.ts                # Entity schema
│       └── CustomFieldsSchema.ts          # Custom fields schema
├── package.json                           # npm module metadata
├── README.md                              # Module documentation
├── tsconfig.json                          # TypeScript configuration
├── .gitignore                             # Git ignore rules
└── .npmignore                             # npm ignore rules
```

## 📋 Required Files

### **1. package.json**
```json
{
  "name": "@deservefirst/module-name",
  "version": "1.0.0",
  "description": "Module description",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "jest --testPathPattern=e2e",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix"
  },
  "dependencies": {
    "@deservefirst/core-module": "^1.0.0",
    "@deservefirst/rbac-module": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0"
  },
  "keywords": ["deservefirst", "module", "ecommerce"],
  "author": "Deservefirst Team",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deservefirst/deservefirst-module-name.git"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### **2. index.ts (Auto-Registration)**
```typescript
import { ModuleRegistry } from '@deservefirst/core-module';
import { EntityService, CustomFieldsService } from './services';
import { ModuleEvents } from './events/ModuleEvents';
import { ModuleHooks } from './hooks/ModuleHooks';
import routes from './config/routes';
import permissions from './config/permissions';
import menu from './config/menu';
import settings from './config/settings.json';

export default class ModuleName {
  static register() {
    ModuleRegistry.registerModule({
      name: 'ModuleName',
      version: '1.0.0',
      dependencies: ['CoreModule', 'RBACModule'],
      services: { EntityService, CustomFieldsService },
      events: ModuleEvents,
      hooks: ModuleHooks,
      routes,
      permissions,
      menu,
      settings,
    });
  }
}

// Auto-register when module is imported
ModuleName.register();

// Export services for external use
export { EntityService, CustomFieldsService };
export * from './models';
export * from './events';
export * from './hooks';
```

### **3. Models (with Multi-Tenancy)**
```typescript
// models/EntityName.ts
import { Database } from '@deservefirst/core-module';

const EntitySchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true }, // Optional for store-specific entities
  name: { type: String, required: true },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  customFields: { type: Object, default: {} }, // Store-specific custom fields
  metadata: { type: Object, default: {} }, // Additional metadata
}, { 
  timestamps: true,
  tenantIsolation: true // Enable row-level security
});

export default Database.model('EntityName', EntitySchema);
```

### **4. Services (with Hooks and Events)**
```typescript
// services/EntityService.ts
import { Database } from '@deservefirst/core-module';
import { Hooks } from '@deservefirst/core-module';
import { Events } from '@deservefirst/core-module';
import { ModuleEvents } from '../events/ModuleEvents';
import { ModuleHooks } from '../hooks/ModuleHooks';
import EntityModel from '../models/EntityName';

export class EntityService {
  async createEntity(data: any, tenantId: string, storeId?: string) {
    await Hooks.execute(ModuleHooks.BEFORE_ENTITY_CREATE, { data, tenantId, storeId });
    
    const entity = await Database.create(EntityModel, { 
      ...data, 
      tenantId, 
      storeId 
    });
    
    Events.dispatch(ModuleEvents.ENTITY_CREATED, { entity, tenantId, storeId });
    return entity;
  }

  async getEntities(tenantId: string, storeId?: string, query: any = {}) {
    return Database.find(EntityModel, { tenantId, storeId, ...query });
  }

  async updateEntity(id: string, data: any, tenantId: string, storeId?: string) {
    await Hooks.execute(ModuleHooks.BEFORE_ENTITY_UPDATE, { id, data, tenantId, storeId });
    
    const entity = await Database.update(EntityModel, { _id: id, tenantId, storeId }, data);
    
    Events.dispatch(ModuleEvents.ENTITY_UPDATED, { entity, tenantId, storeId });
    return entity;
  }

  async deleteEntity(id: string, tenantId: string, storeId?: string) {
    await Hooks.execute(ModuleHooks.BEFORE_ENTITY_DELETE, { id, tenantId, storeId });
    
    await Database.delete(EntityModel, { _id: id, tenantId, storeId });
    
    Events.dispatch(ModuleEvents.ENTITY_DELETED, { id, tenantId, storeId });
  }
}
```

### **5. Events**
```typescript
// events/ModuleEvents.ts
export const ModuleEvents = {
  ENTITY_CREATED: 'module.entity.created',
  ENTITY_UPDATED: 'module.entity.updated',
  ENTITY_DELETED: 'module.entity.deleted',
  CUSTOM_FIELD_ADDED: 'module.custom_field.added',
  CUSTOM_FIELD_REMOVED: 'module.custom_field.removed',
} as const;

// events/EventTypes.ts
export interface EntityCreatedEvent {
  type: 'module.entity.created';
  payload: {
    entity: any;
    tenantId: string;
    storeId?: string;
  };
}

export interface CustomFieldAddedEvent {
  type: 'module.custom_field.added';
  payload: {
    tenantId: string;
    storeId: string;
    entityType: string;
    entityId: string;
    fieldName: string;
    fieldValue: any;
  };
}
```

### **6. Hooks**
```typescript
// hooks/ModuleHooks.ts
export const ModuleHooks = {
  BEFORE_ENTITY_CREATE: 'module.before.entity.create',
  AFTER_ENTITY_CREATE: 'module.after.entity.create',
  BEFORE_ENTITY_UPDATE: 'module.before.entity.update',
  AFTER_ENTITY_UPDATE: 'module.after.entity.update',
  BEFORE_ENTITY_DELETE: 'module.before.entity.delete',
  AFTER_ENTITY_DELETE: 'module.after.entity.delete',
} as const;

// hooks/HookTypes.ts
export interface BeforeEntityCreateHook {
  hook: 'module.before.entity.create';
  data: any;
  tenantId: string;
  storeId?: string;
}
```

### **7. Configuration Files**

#### **routes.ts**
```typescript
import { RouteConfig } from '@deservefirst/core-module';

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/entities',
    handler: 'EntityService.getEntities',
    permission: 'module:view',
    middleware: ['tenantAuth', 'storeAuth']
  },
  {
    method: 'post',
    path: '/entities',
    handler: 'EntityService.createEntity',
    permission: 'module:create',
    middleware: ['tenantAuth', 'storeAuth']
  },
  {
    method: 'put',
    path: '/entities/:id',
    handler: 'EntityService.updateEntity',
    permission: 'module:update',
    middleware: ['tenantAuth', 'storeAuth']
  },
  {
    method: 'delete',
    path: '/entities/:id',
    handler: 'EntityService.deleteEntity',
    permission: 'module:delete',
    middleware: ['tenantAuth', 'storeAuth']
  }
];

export default routes;
```

#### **permissions.ts**
```typescript
export default {
  'module:view': { 
    description: 'View module entities',
    category: 'module'
  },
  'module:create': { 
    description: 'Create module entities',
    category: 'module'
  },
  'module:update': { 
    description: 'Update module entities',
    category: 'module'
  },
  'module:delete': { 
    description: 'Delete module entities',
    category: 'module'
  },
  'module:custom_fields': { 
    description: 'Manage custom fields',
    category: 'module'
  }
};
```

#### **menu.ts**
```typescript
import { MenuItem } from '@deservefirst/core-module';

const menuItems: MenuItem[] = [
  {
    id: 'module-entities',
    label: 'module.menu.entities',
    url: '/admin/module/entities',
    icon: 'fa-cube',
    permission: 'module:view',
    context: 'admin',
    order: 10,
  },
  {
    id: 'module-custom-fields',
    label: 'module.menu.custom_fields',
    url: '/admin/module/custom-fields',
    icon: 'fa-cog',
    permission: 'module:custom_fields',
    context: 'admin',
    order: 20,
  }
];

export default menuItems;
```

#### **settings.json**
```json
[
  {
    "id": "module.enable_feature",
    "label": "module.settings.enable_feature",
    "type": "boolean",
    "default": true,
    "permission": "module:config",
    "required": false
  },
  {
    "id": "module.max_entities",
    "label": "module.settings.max_entities",
    "type": "number",
    "default": 100,
    "permission": "module:config",
    "validators": { "min": 1, "max": 1000 },
    "required": true
  }
]
```

## 🔧 Module Development Workflow

### **1. Create New Module**
```bash
# Use CLI tool to generate module
npm run create-module cms-module feature

# This creates:
# - packages/deservefirst/cms-module/
# - All required files with boilerplate
# - TypeScript configuration
# - Test setup
```

### **2. Develop Module**
```bash
cd packages/deservefirst/cms-module

# Install dependencies
npm install

# Start development
npm run dev

# Run tests
npm run test

# Build module
npm run build
```

### **3. Publish Module**
```bash
# Build and publish
npm run build
npm publish

# Module auto-registers when installed
```

### **4. Use Module**
```typescript
// In your application
import '@deservefirst/cms-module';

// Module automatically registers with platform
// Services, routes, permissions, and menus are available
```

## 🧪 Testing Requirements

### **Unit Tests** (>90% coverage)
- Test all service methods
- Test event dispatching
- Test hook execution
- Test error handling

### **Integration Tests**
- Test API endpoints
- Test database operations
- Test module registration
- Test permission system

### **E2E Tests**
- Test complete workflows
- Test user interactions
- Test multi-tenant scenarios
- Test store-specific functionality

## 📊 Performance Requirements

- **Module Load Time**: <2s
- **Service Response Time**: <100ms
- **Memory Usage**: <50MB per module
- **Database Queries**: Optimized with proper indexing
- **Cache Hit Ratio**: >80%

## 🔒 Security Requirements

- **Tenant Isolation**: All data scoped by tenantId
- **Store Isolation**: Store-specific data scoped by storeId
- **Permission Checks**: All operations require proper permissions
- **Input Validation**: All inputs validated and sanitized
- **SQL Injection**: Protected through ORM
- **XSS Protection**: Output properly escaped

## 📝 Documentation Requirements

- **README.md**: Complete module documentation
- **API Documentation**: Auto-generated from code
- **Code Comments**: JSDoc for all public methods
- **Examples**: Usage examples in README
- **Changelog**: Version history and changes

This structure ensures that all modules follow the same pattern, are automatically discoverable, and integrate seamlessly with the Deservefirst platform.

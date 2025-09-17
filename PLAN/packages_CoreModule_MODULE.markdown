# CoreModule Documentation

This document contains the complete code and filenames for all files in the `CoreModule` of the Deservefirst platform monorepo.

## File: package.json
```json
{
  "name": "@deservefirst/core-module",
  "version": "1.0.0",
  "description": "Core module for Deservefirst platform",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "mocha tests/**/*.test.ts"
  },
  "dependencies": {
    "mysql2": "^3.0.0",
    "redis": "^4.0.0",
    "express": "^4.18.0",
    "i18next": "^23.0.0",
    "ajv": "^8.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "mocha": "^10.0.0",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "ts-node": "^10.9.0"
  },
  "author": "Deservefirst Team",
  "license": "MIT"
}
```

## File: tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## File: .gitignore
```
node_modules/
dist/
```

## File: src/index.ts
```typescript
import dotenv from 'dotenv';
import express from 'express';
import { ModuleRegistry } from './modules/ModuleRegistry';
import { ConfigManager } from './config/ConfigManager';
import { DatabaseProvider } from './database/providers/MySQLProvider';
import { CacheProvider } from './cache/providers/RedisProvider';
import { RouterProvider } from './api/providers/ExpressProvider';
import { HookProvider } from './hooks/providers/DefaultHookProvider';
import { EventProvider } from './events/providers/DefaultEventProvider';
import { I18nProvider } from './i18n/providers/I18NextProvider';
import { I18n } from './i18n/I18n';
import { runMigrations } from './migrations';

// Initialize providers
export function initializeCoreModule(config: { mysqlUrl: string; redisUrl: string }) {
  DatabaseProvider.configure({ url: config.mysqlUrl });
  CacheProvider.configure({ url: config.redisUrl });
  RouterProvider.configure();
  HookProvider.configure();
  EventProvider.configure();
  I18nProvider.configure({ defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en' });
}

export async function startApplication() {
  // Run migrations
  await runMigrations();

  // Load settings
  await ConfigManager.loadSettings();

  // Initialize i18n
  await I18n.init({
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en',
    resources: {
      en: { translation: require('./i18n/en.json') },
      es: { translation: require('./i18n/es.json') },
      fr: { translation: require('./i18n/fr.json') },
    },
  });

  // Create Express app
  const app = express();
  app.use(express.json());

  // Register module routes
  const modules = ModuleRegistry.getModules();
  modules.forEach(module => {
    module.routes.forEach(route => {
      const router = RouterProvider.createRouter();
      router[route.method](route.path, route.handler);
      app.use(`/api/${module.name.toLowerCase()}`, router);
    });
  });

  // Start server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Deservefirst platform running on port ${port}`);
  });
}

export default class CoreModule {
  static register() {
    ModuleRegistry.registerModule({
      name: 'CoreModule',
      dependencies: [],
      services: {},
      events: {},
      hooks: {},
      routes: [
        {
          method: 'get',
          path: '/status',
          handler: async (req, res) => res.json({ status: 'ok' }),
        },
      ],
      permissions: {
        'core:config': { description: 'Manage core settings' },
      },
      menu: [],
      settings: require('./config/settings.json'),
    });
  }
}

export * from './database/Database';
export * from './cache/Cache';
export * from './api/Router';
export * from './hooks/Hooks';
export * from './events/Events';
export * from './modules/ModuleRegistry';
export * from './modules/StoreModuleRegistry';
export * from './menu/MenuManager';
export * from './config/ConfigManager';
export * from './i18n/I18n';
```

## File: src/database/Database.ts
```typescript
export interface SchemaOptions {
  timestamps?: boolean;
  [key: string]: any;
}

export class Database {
  static createSchema(definition: any, options: SchemaOptions = {}) {
    return DatabaseProvider.createSchema(definition, options);
  }

  static model(name: string, schema: any) {
    return DatabaseProvider.model(name, schema);
  }

  static async create(model: any, data: any) {
    return DatabaseProvider.create(model, data);
  }

  static async find(model: any, query: any) {
    return DatabaseProvider.find(model, query);
  }

  static async findOne(model: any, query: any) {
    return DatabaseProvider.findOne(model, query);
  }

  static async update(model: any, query: any, data: any, options: any = {}) {
    return DatabaseProvider.update(model, query, data, options);
  }

  static async delete(model: any, query: any) {
    return DatabaseProvider.delete(model, query);
  }
}

export let DatabaseProvider = {
  configure: (config: any) => { throw new Error('DatabaseProvider not configured'); },
  createSchema: (definition: any, options: any) => { throw new Error('DatabaseProvider not configured'); },
  model: (name: string, schema: any) => { throw new Error('DatabaseProvider not configured'); },
  create: async (model: any, data: any) => { throw new Error('DatabaseProvider not configured'); },
  find: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
  findOne: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
  update: async (model: any, query: any, data: any, options: any) => { throw new Error('DatabaseProvider not configured'); },
  delete: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
};
```

## File: src/database/providers/MySQLProvider.ts
```typescript
import mysql from 'mysql2/promise';
import { DatabaseProvider } from '../Database';

let pool: mysql.Pool;

export const MySQLProvider = {
  configure: (config: { url: string }) => {
    pool = mysql.createPool({
      uri: config.url,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  },

  createSchema: (definition: any, options: any) => {
    const fields = Object.entries(definition).map(([key, value]: [string, any]) => {
      let type = 'VARCHAR(255)';
      if (value.type === String) type = 'VARCHAR(255)';
      if (value.type === Number) type = 'INT';
      if (value.type === Boolean) type = 'BOOLEAN';
      if (value.type === Object) type = 'JSON';
      const constraints = value.required ? 'NOT NULL' : '';
      const index = value.index ? `INDEX idx_${key} (${key})` : '';
      const unique = value.unique ? `UNIQUE (${key})` : '';
      return `${key} ${type} ${constraints} ${index} ${unique}`.trim();
    }).join(', ');

    return {
      fields,
      options,
    };
  },

  model: async (name: string, schema: any) => {
    const tableName = name.toLowerCase();
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ${schema.fields},
        tenantId VARCHAR(255) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenantId (tenantId)
      ) PARTITION BY HASH(tenantId) PARTITIONS 16;
    `;
    await pool.execute(createTableSQL);
    return { tableName };
  },

  create: async (model: any, data: any) => {
    const fields = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);
    const sql = `INSERT INTO ${model.tableName} (${fields}) VALUES (${placeholders})`;
    const [result] = await pool.execute(sql, values);
    return { id: result.insertId, ...data };
  },

  find: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `SELECT * FROM ${model.tableName} WHERE ${conditions || '1=1'}`;
    const [rows] = await pool.execute(sql, values);
    return rows;
  },

  findOne: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `SELECT * FROM ${model.tableName} WHERE ${conditions || '1=1'} LIMIT 1`;
    const [rows] = await pool.execute(sql, values);
    return rows[0] || null;
  },

  update: async (model: any, query: any, data: any, options: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const updates = Object.entries(data).map(([key]) => `${key} = ?`).join(', ');
    const values = [...Object.values(data), ...Object.values(query)];
    const sql = `UPDATE ${model.tableName} SET ${updates} WHERE ${conditions}`;
    const [result] = await pool.execute(sql, values);
    return { affectedRows: result.affectedRows };
  },

  delete: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `DELETE FROM ${model.tableName} WHERE ${conditions}`;
    const [result] = await pool.execute(sql, values);
    return { affectedRows: result.affectedRows };
  },
};

DatabaseProvider = MySQLProvider;
```

## File: src/cache/Cache.ts
```typescript
export class Cache {
  static async get(key: string) {
    return CacheProvider.get(key);
  }

  static async set(key: string, value: any, ttl?: number) {
    return CacheProvider.set(key, value, ttl);
  }
}

export let CacheProvider = {
  configure: (config: any) => { throw new Error('CacheProvider not configured'); },
  get: async (key: string) => { throw new Error('CacheProvider not configured'); },
  set: async (key: string, value: any, ttl?: number) => { throw new Error('CacheProvider not configured'); },
};
```

## File: src/cache/providers/RedisProvider.ts
```typescript
import { createClient } from 'redis';
import { CacheProvider } from '../Cache';

let client: any;

export const RedisProvider = {
  configure: (config: { url: string }) => {
    client = createClient({ url: config.url });
    client.connect();
  },
  get: async (key: string) => {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  },
  set: async (key: string, value: any, ttl?: number) => {
    if (ttl) {
      await client.setEx(key, ttl, JSON.stringify(value));
    } else {
      await client.set(key, JSON.stringify(value));
    }
  },
};

CacheProvider = RedisProvider;
```

## File: src/api/Router.ts
```typescript
export const Router = () => RouterProvider.createRouter();

export let RouterProvider = {
  configure: () => { throw new Error('RouterProvider not configured'); },
  createRouter: () => { throw new Error('RouterProvider not configured'); },
};
```

## File: src/api/providers/ExpressProvider.ts
```typescript
import express from 'express';
import { RouterProvider } from '../Router';

export const ExpressProvider = {
  configure: () => { /* Initialize Express if needed */ },
  createRouter: () => express.Router(),
};

RouterProvider = ExpressProvider;
```

## File: src/hooks/Hooks.ts
```typescript
export interface HookCallback {
  (payload: any): Promise<void>;
}

export class Hooks {
  static async execute(hookName: string, payload: any) {
    return HookProvider.execute(hookName, payload);
  }

  static register(hookName: string, callback: HookCallback) {
    HookProvider.register(hookName, callback);
  }
}

export let HookProvider = {
  configure: () => { /* Initialize hook system */ },
  execute: async (hookName: string, payload: any) => { /* Default implementation */ },
  register: (hookName: string, callback: HookCallback) => { /* Default implementation */ },
};
```

## File: src/hooks/providers/DefaultHookProvider.ts
```typescript
import { HookProvider, HookCallback } from '../Hooks';

const hooks: { [key: string]: HookCallback[] } = {};

export const DefaultHookProvider = {
  configure: () => { /* Initialize if needed */ },
  execute: async (hookName: string, payload: any) => {
    const callbacks = hooks[hookName] || [];
    for (const callback of callbacks) {
      await callback(payload);
    }
  },
  register: (hookName: string, callback: HookCallback) => {
    hooks[hookName] = hooks[hookName] || [];
    hooks[hookName].push(callback);
  },
};

HookProvider = DefaultHookProvider;
```

## File: src/hooks/HookTypes.ts
```typescript
export interface Hook {
  name: string;
  callback: (payload: any) => Promise<void>;
}
```

## File: src/events/Events.ts
```typescript
export interface EventCallback {
  (payload: any): Promise<void>;
}

export class Events {
  static dispatch(eventName: string, payload: any) {
    EventProvider.dispatch(eventName, payload);
  }

  static subscribe(eventName: string, callback: EventCallback) {
    EventProvider.subscribe(eventName, callback);
  }
}

export let EventProvider = {
  configure: () => { /* Initialize event system */ },
  dispatch: (eventName: string, payload: any) => { /* Default implementation */ },
  subscribe: (eventName: string, callback: EventCallback) => { /* Default implementation */ },
};
```

## File: src/events/providers/DefaultEventProvider.ts
```typescript
import { EventProvider, EventCallback } from '../Events';

const events: { [key: string]: EventCallback[] } = {};

export const DefaultEventProvider = {
  configure: () => { /* Initialize if needed */ },
  dispatch: (eventName: string, payload: any) => {
    const callbacks = events[eventName] || [];
    for (const callback of callbacks) {
      callback(payload);
    }
  },
  subscribe: (eventName: string, callback: EventCallback) => {
    events[eventName] = events[eventName] || [];
    events[eventName].push(callback);
  },
};

EventProvider = DefaultEventProvider;
```

## File: src/events/EventTypes.ts
```typescript
export interface Event {
  name: string;
  callback: (payload: any) => Promise<void>;
}
```

## File: src/modules/ModuleRegistry.ts
```typescript
import { MenuItem } from '../menu/MenuTypes';

export interface ModuleConfig {
  name: string;
  dependencies: string[];
  services: { [key: string]: any };
  events: { [key: string]: string };
  hooks: { [key: string]: string };
  routes: any[];
  permissions: { [key: string]: { description: string } };
  menu: MenuItem[];
  settings: any[];
}

export class ModuleRegistry {
  private static modules: ModuleConfig[] = [];

  static registerModule(config: ModuleConfig) {
    this.modules.push(config);
  }

  static getModules() {
    return this.modules;
  }
}
```

## File: src/modules/StoreModuleRegistry.ts
```typescript
import { Database } from '../database/Database';
import { Hooks } from '../hooks/Hooks';
import { Events } from '../events/Events';

export interface StoreModuleConfig {
  name: string;
  services?: { [key: string]: any };
  hooks?: { [key: string]: (payload: any) => Promise<void> };
  events?: { [key: string]: (payload: any) => Promise<void> };
}

export class StoreModuleRegistry {
  static async registerStoreModule(tenantId: string, storeId: string, module: StoreModuleConfig) {
    if (module.schema) {
      throw new Error('Store-level modules cannot define new schemas');
    }

    await Database.create('storeModules', {
      tenantId,
      storeId,
      name: module.name,
      services: module.services,
      hooks: Object.keys(module.hooks || {}),
      events: Object.keys(module.events || {}),
    });

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
```

## File: src/menu/MenuManager.ts
```typescript
import { MenuItem } from './MenuTypes';
import { ModuleRegistry } from '../modules/ModuleRegistry';

export class MenuManager {
  static getMenuItems(context: 'admin' | 'frontend') {
    const modules = ModuleRegistry.getModules();
    return modules
      .flatMap(module => module.menu || [])
      .filter(item => item.context === context)
      .sort((a, b) => a.order - b.order);
  }
}
```

## File: src/menu/MenuTypes.ts
```typescript
export interface MenuItem {
  id: string;
  label: string;
  url: string;
  icon?: string;
  permission?: string;
  context: 'admin' | 'frontend';
  order: number;
}
```

## File: src/config/ConfigManager.ts
```typescript
import Ajv from 'ajv';
import { ModuleRegistry } from '../modules/ModuleRegistry';
import { Cache } from '../cache/Cache';
import { Database } from '../database/Database';
import { Hooks } from '../hooks/Hooks';
import { SettingsSchema } from './SettingsSchema';
import fs from 'fs';
import path from 'path';

const ajv = new Ajv();
const validate = ajv.compile(SettingsSchema);

export class ConfigManager {
  static async loadSettings(): Promise<void> {
    ModuleRegistry.getModules().forEach(module => {
      const settingsPath = path.join(__dirname, `../../${module.name}/config/settings.json`);
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (!validate(settings)) {
          throw new Error(`Invalid settings.json in ${module.name}: ${JSON.stringify(validate.errors)}`);
        }
        module.settings = settings;
      }
    });
  }

  static async getConfigValue(tenantId: string, storeId: string | null, settingId: string): Promise<any> {
    const cacheKey = `config:${tenantId}:${storeId || 'default'}:${settingId}`;
    const cached = await Cache.get(cacheKey);
    if (cached) return cached;

    const query = storeId ? { tenantId, storeId, settingId } : { tenantId, settingId };
    const setting = await Database.findOne('settings', query);
    const value = setting ? setting.value : this.getDefaultValue(settingId);
    if (value) await Cache.set(cacheKey, value);
    return value;
  }

  static async saveConfigValue(tenantId: string, storeId: string | null, settingId: string, value: any): Promise<void> {
    const field = ModuleRegistry.getModules()
      .flatMap(module => module.settings || [])
      .find(f => f.id === settingId);

    if (!field) throw new Error(`Unknown setting: ${settingId}`);
    if (field.validators) {
      if (field.validators.min && value < field.validators.min) throw new Error(`Value below minimum: ${field.validators.min}`);
      if (field.validators.max && value > field.validators.max) throw new Error(`Value above maximum: ${field.validators.max}`);
      if (field.validators.regex && !new RegExp(field.validators.regex).test(value)) throw new Error(`Value does not match regex: ${field.validators.regex}`);
    }

    const query = storeId ? { tenantId, storeId, settingId } : { tenantId, settingId };
    await Database.update('settings', query, { value }, { upsert: true });
    await Cache.set(`config:${tenantId}:${storeId || 'default'}:${settingId}`, value);
    await Hooks.execute('afterConfigSave', { tenantId, storeId, settingId, value });
  }

  static getDefaultValue(settingId: string): any {
    const field = ModuleRegistry.getModules()
      .flatMap(module => module.settings || [])
      .find(f => f.id === settingId);
    return field ? field.default : null;
  }
}
```

## File: src/config/SettingsSchema.ts
```typescript
import { JSONSchemaType } from 'ajv';

export interface ConfigField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'textarea';
  default: any;
  permission: string;
  validators?: {
    min?: number;
    max?: number;
    regex?: string;
  };
  options?: { value: string; label: string }[];
  required: boolean;
}

export const SettingsSchema: JSONSchemaType<ConfigField[]> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      type: { type: 'string', enum: ['text', 'number', 'select', 'boolean', 'textarea'] },
      default: {},
      permission: { type: 'string' },
      validators: {
        type: 'object',
        properties: {
          min: { type: 'number', nullable: true },
          max: { type: 'number', nullable: true },
          regex: { type: 'string', nullable: true },
        },
        nullable: true,
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['value', 'label'],
        },
        nullable: true,
      },
      required: { type: 'boolean' },
    },
    required: ['id', 'label', 'type', 'default', 'permission', 'required'],
  },
};
```

## File: src/config/settings.json
```json
[
  {
    "id": "core.default_language",
    "label": "core.settings.default_language",
    "type": "select",
    "default": "en",
    "permission": "core:config",
    "options": [
      { "value": "en", "label": "core.settings.language.english" },
      { "value": "es", "label": "core.settings.language.spanish" },
      { "value": "fr", "label": "core.settings.language.french" }
    ],
    "required": true
  },
  {
    "id": "core.maintenance_mode",
    "label": "core.settings.maintenance_mode",
    "type": "boolean",
    "default": false,
    "permission": "core:config",
    "required": false
  },
  {
    "id": "core.cache_ttl",
    "label": "core.settings.cache_ttl",
    "type": "number",
    "default": 3600,
    "permission": "core:config",
    "validators": { "min": 60, "max": 86400 },
    "required": true
  }
]
```

## File: src/i18n/I18n.ts
```typescript
export class I18n {
  static init(config: any) {
    I18nProvider.init(config);
  }

  static t(key: string, options?: any) {
    return I18nProvider.t(key, options);
  }
}

export let I18nProvider = {
  init: (config: any) => { throw new Error('I18nProvider not configured'); },
  t: (key: string, options?: any) => { throw new Error('I18nProvider not configured'); },
};
```

## File: src/i18n/providers/I18NextProvider.ts
```typescript
import i18next from 'i18next';
import { I18nProvider } from '../I18n';

export const I18NextProvider = {
  init: (config: any) => {
    i18next.init({
      lng: config.defaultLanguage || 'en',
      resources: config.resources || {},
    });
  },
  t: (key: string, options?: any) => i18next.t(key, options),
};

I18nProvider = I18NextProvider;
```

## File: src/i18n/en.json
```json
{
  "core.settings.default_language": "Default Language",
  "core.settings.language.english": "English",
  "core.settings.language.spanish": "Spanish",
  "core.settings.language.french": "French",
  "core.settings.maintenance_mode": "Maintenance Mode",
  "core.settings.cache_ttl": "Cache TTL (seconds)"
}
```

## File: src/i18n/es.json
```json
{
  "core.settings.default_language": "Idioma predeterminado",
  "core.settings.language.english": "Inglés",
  "core.settings.language.spanish": "Español",
  "core.settings.language.french": "Francés",
  "core.settings.maintenance_mode": "Modo de mantenimiento",
  "core.settings.cache_ttl": "TTL de caché (segundos)"
}
```

## File: src/i18n/fr.json
```json
{
  "core.settings.default_language": "Langue par défaut",
  "core.settings.language.english": "Anglais",
  "core.settings.language.spanish": "Espagnol",
  "core.settings.language.french": "Français",
  "core.settings.maintenance_mode": "Mode de maintenance",
  "core.settings.cache_ttl": "TTL du cache (secondes)"
}
```

## File: src/migrations.ts
```typescript
import { Database } from './database/Database';

export async function runMigrations() {
  const settingsSchema = Database.createSchema({
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String },
    settingId: { type: String, required: true },
    value: { type: Object },
  }, { timestamps: true });
  await Database.model('settings', settingsSchema);

  const storeModulesSchema = Database.createSchema({
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String, required: true },
    name: { type: String, required: true },
    services: { type: Object },
    hooks: { type: Object },
    events: { type: Object },
  }, { timestamps: true });
  await Database.model('storeModules', storeModulesSchema);
}
```

## File: src/tests/unit/Database.test.ts
```typescript
import { expect } from 'chai';
import { Database } from '../../database/Database';
import sinon from 'sinon';

describe('Database', () => {
  it('should create a record', async () => {
    const stub = sinon.stub(DatabaseProvider, 'create').resolves({ id: 1, title: 'Test' });
    const model = await Database.model('test', { fields: 'title VARCHAR(255)' });
    const result = await Database.create(model, { title: 'Test' });
    expect(result.title).to.equal('Test');
    stub.restore();
  });
});
```

## File: src/tests/unit/ConfigManager.test.ts
```typescript
import { expect } from 'chai';
import { ConfigManager } from '../../config/ConfigManager';
import sinon from 'sinon';

describe('ConfigManager', () => {
  it('should get default config value', async () => {
    const result = await ConfigManager.getDefaultValue('core.default_language');
    expect(result).to.equal('en');
  });
});
```
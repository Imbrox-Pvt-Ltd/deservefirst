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

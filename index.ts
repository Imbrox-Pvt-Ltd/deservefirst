const dotenv = require('dotenv');
const express = require('express');
const { initializeCoreModule, startApplication } = require('./packages/deservefirst/CoreModule/src/index');
const { ModuleOrchestrator } = require('./packages/deservefirst/CoreModule/src/modules/ModuleOrchestrator');
const { ModuleCommunicationHub } = require('./packages/deservefirst/CoreModule/src/modules/ModuleCommunicationHub');
const { PerformanceOptimizer } = require('./packages/deservefirst/CoreModule/src/modules/PerformanceOptimizer');
const { ModuleVersionManager } = require('./packages/deservefirst/CoreModule/src/modules/ModuleVersionManager');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const MYSQL_URL = process.env.MYSQL_URL || 'mysql://localhost:3306/deservefirst';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function bootstrap() {
  try {
    console.log('🚀 Starting Deservefirst Platform...');
    
    // Initialize core module
    console.log('📦 Initializing Core Module...');
    initializeCoreModule({
      mysqlUrl: MYSQL_URL,
      redisUrl: REDIS_URL
    });
    
    // Initialize module orchestration system
    console.log('🎯 Initializing Module Orchestration System...');
    const orchestrator = ModuleOrchestrator.getInstance();
    const communicationHub = ModuleCommunicationHub.getInstance();
    const performanceOptimizer = PerformanceOptimizer.getInstance();
    const versionManager = ModuleVersionManager.getInstance();
    
    // Register sample modules
    await registerSampleModules(orchestrator);
    
    // Start the application and get the configured Express app
    console.log('🌟 Starting Application Services...');
    const app = await startApplication();
    
    // Initialize and start all modules
    console.log('🔧 Initializing modules...');
    await orchestrator.initializeAllModules();
    
    console.log('🚀 Starting modules...');
    await orchestrator.startAllModules();
    
    // Register module routes after modules are started
    console.log('🔗 Registering module routes...');
    const modules = orchestrator.getAllModules();
    modules.forEach((moduleInstance: any, moduleName: string) => {
      if (moduleInstance.config.routes && moduleInstance.config.routes.length > 0) {
        moduleInstance.config.routes.forEach((route: any) => {
          const routePath = `/api/${moduleName.toLowerCase()}${route.path}`;
          console.log(`📍 Registering route: ${route.method.toUpperCase()} ${routePath}`);
          (app as any)[route.method.toLowerCase()](routePath, route.handler);
        });
      }
    });
    
    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Health check endpoint
    app.get('/health', (req: any, res: any) => {
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: {
          registered: orchestrator.getAllModules().size,
          loaded: Array.from(orchestrator.getAllModules().values()).filter((m: any) => m.status === 'running').length
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version
        }
      };
      res.json(healthStatus);
    });
    
    // Module status endpoint
    app.get('/modules', (req: any, res: any) => {
      const modules = {
        registered: Array.from(orchestrator.getAllModules().keys()),
        loaded: Array.from(orchestrator.getAllModules().values()).filter((m: any) => m.status === 'running').map((m: any) => m.config.name),
        allModules: Array.from(orchestrator.getAllModules().values()).map((m: any) => ({
          name: m.config.name,
          status: m.status,
          version: m.config.version,
          category: m.config.category
        }))
      };
      res.json(modules);
    });
    
    // App-level routes
    app.get('/app/dashboard', (req: any, res: any) => {
      res.json({ 
        title: 'Deservefirst Dashboard',
        modules: Array.from(orchestrator.getAllModules().keys()),
        timestamp: new Date().toISOString()
      });
    });
    
    app.get('/app/status', (req: any, res: any) => {
      res.json({
        platform: 'Deservefirst',
        version: '1.0.0',
        uptime: process.uptime(),
        modules: {
           total: orchestrator.getAllModules().size,
           running: Array.from(orchestrator.getAllModules().values()).filter((m: any) => m.status === 'running').length
         }
      });
    });
    
    // Performance metrics endpoint
    app.get('/metrics', async (req: any, res: any) => {
      const metrics = await orchestrator.getModuleMetrics();
      res.json(metrics);
    });
    
    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Deservefirst Platform is running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
      console.log(`🔧 Modules: http://localhost:${PORT}/modules`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start Deservefirst Platform:', error);
    process.exit(1);
  }
}

async function registerSampleModules(orchestrator: any) {
  // Register Core Module
  await orchestrator.registerModule({
    name: 'CoreModule',
    version: '1.0.0',
    dependencies: [],
    services: {},
    events: {},
    hooks: {},
    routes: [
      { method: 'get', path: '/info', handler: (req: any, res: any) => res.json({ module: 'CoreModule', status: 'active' }) }
    ],
    permissions: {},
    menu: [],
    settings: [],
    priority: 100,
    category: 'core',
    onInit: async () => {
      console.log('✅ Core Module initialized');
    },
    onDestroy: async () => {
      console.log('🔄 Core Module destroyed');
    }
  });
  
  // Register RBAC Module
  await orchestrator.registerModule({
    name: 'RBACModule',
    version: '1.0.0',
    dependencies: ['CoreModule'],
    services: { RoleService: {}, PermissionService: {} },
    events: { 'role.assigned': 'Role assigned to user', 'permission.granted': 'Permission granted' },
    hooks: { 'user.login': 'User login hook', 'permission.check': 'Permission check hook' },
    routes: [
      { method: 'get', path: '/roles', handler: (req: any, res: any) => res.json({ roles: ['admin', 'user', 'guest'] }) },
      { method: 'get', path: '/permissions', handler: (req: any, res: any) => res.json({ permissions: ['read', 'write', 'delete'] }) }
    ],
    permissions: { 'rbac.manage': { description: 'Manage roles and permissions' } },
    menu: [],
    settings: [],
    priority: 80,
    category: 'core',
    onInit: async () => {
      console.log('✅ RBAC Module initialized');
    },
    onDestroy: async () => {
      console.log('🔄 RBAC Module destroyed');
    }
  });
  
  // Register CMS Module
  await orchestrator.registerModule({
    name: 'CMSModule',
    version: '1.0.0',
    dependencies: ['CoreModule', 'RBACModule'],
    services: { ContentService: {}, MediaService: {} },
    events: { 'content.updated': 'Content updated', 'media.uploaded': 'Media uploaded' },
    hooks: { 'content.created': 'Content created hook', 'content.published': 'Content published hook' },
    routes: [
      { method: 'get', path: '/content', handler: (req: any, res: any) => res.json({ content: ['page1', 'page2', 'blog1'] }) },
      { method: 'post', path: '/content', handler: (req: any, res: any) => res.json({ message: 'Content created', id: Date.now() }) },
      { method: 'get', path: '/media', handler: (req: any, res: any) => res.json({ media: ['image1.jpg', 'video1.mp4'] }) }
    ],
    permissions: { 'cms.manage': { description: 'Manage CMS content' } },
    menu: [],
    settings: [],
    priority: 60,
    category: 'business',
    onInit: async () => {
      console.log('✅ CMS Module initialized');
    },
    onDestroy: async () => {
      console.log('🔄 CMS Module destroyed');
    }
  });
  
  console.log('📦 Sample modules registered successfully');
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  const orchestrator = ModuleOrchestrator.getInstance();
  // Stop all modules in reverse order
  const modules = Array.from(orchestrator.getAllModules().keys()).reverse();
  for (const moduleName of modules) {
    try {
      await orchestrator.stopModule(moduleName);
    } catch (error) {
      console.error(`Error stopping module ${moduleName}:`, error);
    }
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  const orchestrator = ModuleOrchestrator.getInstance();
  // Stop all modules in reverse order
  const modules = Array.from(orchestrator.getAllModules().keys()).reverse();
  for (const moduleName of modules) {
    try {
      await orchestrator.stopModule(moduleName);
    } catch (error) {
      console.error(`Error stopping module ${moduleName}:`, error);
    }
  }
  process.exit(0);
});

// Start the application
bootstrap();
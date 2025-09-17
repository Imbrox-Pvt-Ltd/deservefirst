import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ModuleRegistryService } from './modules/module-registry.service';
import { DynamicModuleLoaderService } from './modules/dynamic-module-loader.service';
import { SimpleMigrationManagerService } from './migrations/simple-migration-manager.service';
import { ModuleVersionManagerService } from './migrations/module-version-manager.service';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Health check endpoint (before global prefix)
  app.use('/health', (req: any, res: any) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  // Global prefix for API routes
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Deservefirst Platform API')
    .setDescription('Enterprise-grade e-commerce platform API')
    .setVersion('1.0')
    .addTag('core', 'Core platform functionality')
    .addTag('rbac', 'Role-based access control')
    .addTag('cms', 'Content management system')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Serve static files
  app.use('/public', express.static('public'));

  // Initialize module discovery
  const moduleRegistry = app.get(ModuleRegistryService);
  await moduleRegistry.discoverModules();
  
  // Initialize dynamic module loader
  const dynamicLoader = app.get(DynamicModuleLoaderService);
  await dynamicLoader.initialize();
  
  // Initialize migration system
  const migrationManager = app.get(SimpleMigrationManagerService);
  await migrationManager.initialize();
  
  // Initialize version management
  const versionManager = app.get(ModuleVersionManagerService);
  await versionManager.initialize();
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log(`🚀 Deservefirst Platform is running on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`📈 API Docs: http://localhost:${port}/api/docs`);
  console.log(`🔧 Modules: http://localhost:${port}/api/modules`);
  console.log(`🏪 Store Modules: http://localhost:${port}/api/modules/store/{storeId}`);
  console.log(`⚡ Dynamic Modules: http://localhost:${port}/api/modules/loaded`);
  console.log(`🔄 Hot Reload: File watching enabled for modules/`);
  console.log(`🗄️ Migrations: http://localhost:${port}/api/migrations`);
  console.log(`📦 Version Management: http://localhost:${port}/api/migrations/versions`);
}

bootstrap();

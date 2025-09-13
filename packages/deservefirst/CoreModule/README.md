# CoreModule

## Overview

CoreModule is the foundational module of the Deservefirst platform, providing essential infrastructure services and abstractions for building scalable, modular applications.

## Features

- **Database Abstraction**: MySQL provider with connection pooling and query optimization
- **Cache Layer**: Redis provider for high-performance caching
- **Router System**: Express-based routing with middleware support
- **Configuration Management**: AJV-validated configuration with schema enforcement
- **Event System**: Pub/sub event handling for decoupled communication
- **Hook System**: Extensible hook mechanism for plugin architecture
- **Internationalization**: i18next-based multi-language support
- **Module Registry**: Dynamic module registration and lifecycle management
- **Migration System**: Database schema versioning and migration tools
- **Module Orchestration**: Advanced module loading, dependency resolution, and communication

## Installation

```bash
npm install @deservefirst/core-module
```

## Quick Start

### Basic Setup

```typescript
import { initializeCoreModule, startApplication } from '@deservefirst/core-module';
import { ModuleOrchestrator } from '@deservefirst/core-module';

// Initialize core services
initializeCoreModule({
  mysqlUrl: process.env.MYSQL_URL || 'mysql://localhost:3306/deservefirst',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Get the Express app with configured routes
const app = await startApplication();

// Initialize module orchestrator
const orchestrator = ModuleOrchestrator.getInstance();

// Register and start modules
await orchestrator.initializeAllModules();
await orchestrator.startAllModules();

// Start the server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Environment Variables

```bash
# Database Configuration
MYSQL_URL=mysql://username:password@localhost:3306/database_name
REDIS_URL=redis://localhost:6379

# Application Configuration
PORT=3000
DEFAULT_LANGUAGE=en
NODE_ENV=development
```

## Module Registration

### Registering a Custom Module

```typescript
import { ModuleOrchestrator } from '@deservefirst/core-module';

const orchestrator = ModuleOrchestrator.getInstance();

// Register a module with full configuration
await orchestrator.registerModule('MyCustomModule', {
  name: 'MyCustomModule',
  version: '1.0.0',
  category: 'business',
  dependencies: ['CoreModule'],
  routes: [
    {
      method: 'get',
      path: '/custom',
      handler: (req, res) => {
        res.json({ message: 'Custom module endpoint' });
      }
    }
  ],
  services: {
    customService: {
      initialize: async () => {
        console.log('Custom service initialized');
      }
    }
  },
  events: {
    'custom.event': {
      handler: (data) => {
        console.log('Custom event received:', data);
      }
    }
  },
  hooks: {
    'before.request': {
      handler: async (context) => {
        console.log('Before request hook');
        return context;
      }
    }
  }
});
```

## API Reference

### Core Services

#### Database Provider

```typescript
import { DatabaseProvider } from '@deservefirst/core-module';

// Execute queries
const result = await DatabaseProvider.query('SELECT * FROM users WHERE id = ?', [userId]);

// Use connection pool
const connection = await DatabaseProvider.getConnection();
try {
  await connection.beginTransaction();
  // ... perform operations
  await connection.commit();
} finally {
  connection.release();
}
```

#### Cache Provider

```typescript
import { CacheProvider } from '@deservefirst/core-module';

// Set cache with TTL
await CacheProvider.set('user:123', userData, 3600); // 1 hour TTL

// Get cached data
const userData = await CacheProvider.get('user:123');

// Delete cache
await CacheProvider.del('user:123');
```

#### Event System

```typescript
import { EventProvider } from '@deservefirst/core-module';

// Emit events
EventProvider.emit('user.created', { userId: 123, email: 'user@example.com' });

// Listen to events
EventProvider.on('user.created', (data) => {
  console.log('New user created:', data);
});
```

#### Hook System

```typescript
import { HookProvider } from '@deservefirst/core-module';

// Register hooks
HookProvider.addHook('before.user.create', async (userData) => {
  // Validate or modify user data
  return { ...userData, createdAt: new Date() };
});

// Execute hooks
const processedData = await HookProvider.executeHook('before.user.create', userData);
```

### Module Orchestration

#### Module Lifecycle Management

```typescript
import { ModuleOrchestrator } from '@deservefirst/core-module';

const orchestrator = ModuleOrchestrator.getInstance();

// Get module status
const modules = orchestrator.getAllModules();
console.log('Registered modules:', Array.from(modules.keys()));

// Check module health
const healthStatus = await orchestrator.checkModuleHealth('MyModule');

// Restart a module
await orchestrator.restartModule('MyModule');

// Get module metrics
const metrics = orchestrator.getModuleMetrics('MyModule');
```

#### Inter-Module Communication

```typescript
import { ModuleCommunicationHub } from '@deservefirst/core-module';

const hub = ModuleCommunicationHub.getInstance();

// Send message between modules
await hub.sendMessage('SourceModule', 'TargetModule', {
  action: 'processData',
  payload: { data: 'example' }
});

// Subscribe to module messages
hub.subscribe('MyModule', (message) => {
  console.log('Received message:', message);
});
```

## Configuration

### Config Manager

```typescript
import { ConfigManager } from '@deservefirst/core-module';

// Get configuration values
const dbConfig = ConfigManager.get('database');
const apiKey = ConfigManager.get('api.key', 'default-key');

// Set configuration
ConfigManager.set('feature.enabled', true);

// Validate configuration against schema
const isValid = ConfigManager.validate({
  database: {
    host: 'localhost',
    port: 3306
  }
});
```

## Migration System

```typescript
import { runMigrations } from '@deservefirst/core-module';

// Run pending migrations
await runMigrations();

// Create a new migration
// migrations/001_create_users_table.sql
/*
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
*/
```

## Internationalization

```typescript
import { I18n } from '@deservefirst/core-module';

// Initialize i18n
const i18n = I18n.getInstance();

// Translate text
const message = i18n.t('welcome.message', { name: 'John' });

// Change language
i18n.changeLanguage('es');

// Add translations
i18n.addResourceBundle('en', 'common', {
  welcome: {
    message: 'Welcome, {{name}}!'
  }
});
```

## Security Best Practices

### Database Security
- Use parameterized queries to prevent SQL injection
- Implement tenant isolation with `tenantId` in all queries
- Use connection pooling with proper limits
- Enable SSL/TLS for database connections

### Cache Security
- Configure Redis with ACLs and authentication
- Use Redis Cluster for high availability
- Implement proper key expiration policies

### Application Security
- Validate all input using AJV schemas
- Implement proper error handling
- Use environment variables for sensitive configuration
- Enable CORS and security headers

## Performance Optimization

### Database Optimization
```typescript
// Use connection pooling
const pool = DatabaseProvider.getPool();

// Implement query caching
const cachedResult = await CacheProvider.get(`query:${queryHash}`);
if (!cachedResult) {
  const result = await DatabaseProvider.query(sql, params);
  await CacheProvider.set(`query:${queryHash}`, result, 300);
  return result;
}
```

### Module Performance
```typescript
// Use performance optimizer
import { PerformanceOptimizer } from '@deservefirst/core-module';

const optimizer = PerformanceOptimizer.getInstance();

// Monitor module performance
const metrics = optimizer.getModuleMetrics('MyModule');
console.log('Response time:', metrics.averageResponseTime);

// Optimize module loading
optimizer.optimizeModuleLoading(['CoreModule', 'RBACModule']);
```

## Troubleshooting

### Common Issues

1. **Module Registration Fails**
   ```typescript
   // Check module dependencies
   const dependencies = orchestrator.getModuleDependencies('MyModule');
   console.log('Missing dependencies:', dependencies.missing);
   ```

2. **Database Connection Issues**
   ```typescript
   // Test database connection
   try {
     await DatabaseProvider.query('SELECT 1');
     console.log('Database connected successfully');
   } catch (error) {
     console.error('Database connection failed:', error);
   }
   ```

3. **Cache Connection Issues**
   ```typescript
   // Test Redis connection
   try {
     await CacheProvider.set('test', 'value', 10);
     const value = await CacheProvider.get('test');
     console.log('Cache connected successfully');
   } catch (error) {
     console.error('Cache connection failed:', error);
   }
   ```

## Development

### Running Tests
```bash
npm test
npm run test:coverage
```

### Building
```bash
npm run build
```

### Linting
```bash
npm run lint
npm run lint:fix
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Create an issue on GitHub
- Check the documentation
- Review the troubleshooting guide

---

**Note**: This module requires Node.js 16+ and supports TypeScript out of the box.
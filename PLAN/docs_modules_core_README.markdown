# Core Module

**Project**: deservefirst.com  
**Module**: Deservefirst_CustomFeature - Core  
**Developer**: deservefirst  
**Author**: Sanjay Bisht  
**Email**: info@deservefirst.com  
**Website**: https://deservefirst.com  
**Copyright**: © 2025 Deservefirst  
**License**: OSL-3.0 / AFL-3.0  

## Overview
The `core` module manages foundational entities (tenants, users, settings, currencies), migrations, hooks, translations, and performance monitoring. It provides services for tenant isolation, sharding, and currency handling, serving as the backbone for other modules.

### Features
- **Tenant Management**: Create, update, and shard tenants.
- **User Management**: System-wide user accounts and roles.
- **Settings**: Global and tenant-specific configurations.
- **Currency**: ECB-based FX rates, rounding, and price snapshots.
- **Translations**: Type-safe i18n with fallback support.
- **Migrations**: Versioned schema updates.
- **Performance**: Query metrics and monitoring.
- **Event Bus**: Async event handling.

## Directory Structure
```
backend/src/core/
├── module-config/
│   ├── module.json
│   └── config.ts
├── entities/
│   ├── tenant.entity.ts
│   ├── user.entity.ts
│   ├── setting.entity.ts
│   └── currency.entity.ts
├── services/
│   ├── tenant.service.ts
│   ├── user.service.ts
│   ├── setting.service.ts
│   ├── currency.service.ts
│   ├── translation.service.ts
│   ├── migration.service.ts
│   ├── performance.service.ts
│   └── event-bus.service.ts
├── controllers/
│   ├── tenant.controller.ts
│   ├── user.controller.ts
│   ├── setting.controller.ts
│   └── currency.controller.ts
├── migrations/
│   ├── 1.0.0-create-tenants-table.ts
│   ├── 1.0.1-create-users-table.ts
│   ├── 1.0.2-create-settings-table.ts
│   └── 1.0.3-create-currencies-table.ts
├── seeders/
│   ├── tenants.seeder.ts
│   ├── users.seeder.ts
│   ├── settings.seeder.ts
│   └── currencies.seeder.ts
├── hooks/
│   ├── tenant.hooks.ts
│   └── user.hooks.ts
└── core.module.ts
```

## APIs
- **POST /api/tenants**: Create a tenant.
  - Headers: `Authorization: Bearer <token>`
  - Body: `{ "name": "Acme", "db_shard": "shared" }`
  - Response: `{ "id": 1, "uuid": "uuid", "name": "Acme", "db_shard": "shared" }`
- **GET /api/tenants/:uuid**: Retrieve tenant details.
  - Headers: `Authorization: Bearer <token>`
  - Response: `{ "id": 1, "uuid": "uuid", "name": "Acme", "db_shard": "shared" }`
- **POST /api/users**: Create a user.
  - Headers: `Authorization: Bearer <token>`
  - Body: `{ "email": "user@deservefirst.com", "password": "hashed", "tenant_id": 1 }`
- **GET /api/currencies/rates**: Get FX rates.
  - Response: `{ "USD_EUR": 0.85, "cached_at": "2025-09-11T10:16:00Z" }`
- **GET /api/settings**: Get system settings.
  - Headers: `Authorization: Bearer <token>`
  - Response: `{ "key": "theme", "value": "default" }`

## Setup
1. **Install Dependencies**:
   ```bash
   cd backend && npm install
   ```
2. **Run Migrations**:
   ```bash
   npm run migrate
   ```
3. **Seed Data**:
   ```bash
   npm run seed:core
   ```
4. **Configure**:
   - Update `backend/src/config/database.config.ts` for DB connection.
   - Set `SECRET_KEY_PATH` in `.env`.

## Usage
- **Tenant Creation**:
  ```bash
  curl -X POST http://api.deservefirst.com/api/tenants \
    -H "Authorization: Bearer <token>" \
    -d '{"name":"Acme","db_shard":"shared"}'
  ```
- **Run Translations**:
  ```bash
  npm run i18n:extract
  npm run i18n:types
  ```
- **Monitor Performance**:
  - View query metrics in Grafana: `http://grafana.deservefirst.com`.

## Hooks
- `before:tenant:create`: Modify tenant data before creation.
- `after:user:create`: Notify external systems after user creation.

## Dependencies
- `@nestjs/core`, `@nestjs/typeorm`, `typeorm`, `redis`, `bullmq`

## Testing
- **Unit Tests**: `backend/test/unit/core/`
- **Integration Tests**: `backend/test/integration/core/`
- **Run Tests**:
  ```bash
  npm run test:core
  ```
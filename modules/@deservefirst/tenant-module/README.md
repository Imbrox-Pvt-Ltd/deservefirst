# @deservefirst/tenant-module

Tenant Management Module for multi-tenant architecture

## Installation

```bash
npm install @deservefirst/tenant-module
```

## Usage

```typescript
import { TenantModule } from '@deservefirst/tenant-module';

// Add to your NestJS app
@Module({
  imports: [TenantModule],
})
export class AppModule {}
```

## Features

- **Services**: TenantService, TenantSettingsService
- **Controllers**: TenantController, TenantSettingsController
- **Entities**: Tenant, TenantSettings
- **Events**: TenantCreated, TenantUpdated
- **Hooks**: TenantValidationHook, TenantMigrationHook
- **Custom Fields**: Supported
- **Store Level**: Yes

## API Documentation

### Tenant Management

- `GET /tenant` - Get all tenants
- `GET /tenant/search?q=query` - Search tenants
- `GET /tenant/:id` - Get tenant by ID
- `GET /tenant/subdomain/:subdomain` - Get tenant by subdomain
- `POST /tenant` - Create new tenant
- `PUT /tenant/:id` - Update tenant
- `DELETE /tenant/:id` - Delete tenant
- `POST /tenant/:id/activate` - Activate tenant
- `POST /tenant/:id/deactivate` - Deactivate tenant
- `PUT /tenant/:id/plan` - Update tenant plan
- `GET /tenant/:id/stats` - Get tenant statistics

### Tenant Settings

- `GET /tenant-settings/:tenantId` - Get all settings for a tenant
- `GET /tenant-settings/:tenantId/object` - Get settings as object
- `GET /tenant-settings/:tenantId/secret` - Get secret settings
- `GET /tenant-settings/:tenantId/required` - Get required settings
- `GET /tenant-settings/:tenantId/:key` - Get specific setting
- `POST /tenant-settings` - Create new setting
- `PUT /tenant-settings/:tenantId/:key` - Update setting
- `DELETE /tenant-settings/:tenantId/:key` - Delete setting
- `POST /tenant-settings/:tenantId/set` - Set setting value
- `POST /tenant-settings/:tenantId/:key/validate` - Validate setting value

## Data Models

### Tenant

```typescript
{
  id: string;
  name: string;
  subdomain: string;
  displayName: string;
  description?: string;
  active: boolean;
  plan: string;
  settings: Record<string, any>;
  customFields: Record<string, any>;
  logoUrl?: string;
  websiteUrl?: string;
  supportEmail?: string;
  timezone: string;
  locale: string;
  maxUsers: number;
  maxStores: number;
  maxProducts: number;
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### TenantSettings

```typescript
{
  id: string;
  tenantId: string;
  key: string;
  value: string;
  description?: string;
  type: string;
  isSecret: boolean;
  isRequired: boolean;
  validation: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
```

## Events

### TenantCreated

Emitted when a new tenant is created.

```typescript
{
  tenantId: string;
  tenantName: string;
  subdomain: string;
  plan: string;
  timestamp: Date;
}
```

### TenantUpdated

Emitted when a tenant is updated.

```typescript
{
  tenantId: string;
  changes: Record<string, any>;
  timestamp: Date;
}
```

## Hooks

### TenantValidationHook

Validates tenant data before creation or update.

### TenantMigrationHook

Handles tenant data migration between module versions.

## Custom Fields

This module supports custom fields, allowing you to extend tenant data without modifying the core schema.

## Store-Level Configuration

Each store can have different tenant configurations and settings.

## License

MIT

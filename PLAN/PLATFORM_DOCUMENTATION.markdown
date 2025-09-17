# Deservefirst Platform Documentation

**Project**: deservefirst.com  
**Module**: Deservefirst_CustomFeature  
**Developer**: deservefirst  
**Author**: Sanjay Bisht  
**Email**: info@deservefirst.com  
**Website**: https://deservefirst.com  
**Copyright**: © 2025 Deservefirst  
**License**: OSL-3.0 / AFL-3.0  

## Overview
Deservefirst is a multi-tenant e-commerce SaaS platform designed for scalability (~12k merchants, 35TB), combining Shopify’s usability with Magento’s modularity. It uses a single database (MySQL dev, PostgreSQL prod) with row-level isolation (`tenant_id`), supports transparent sharding, and provides robust security, performance, and developer experience (DX).

### Features
- **Single Database with Row-Level Isolation**: `tenant_id` on all tables, shard-ready with range partitioning.
- **Template Path Hinting**: Debugging for templates/components (admin-only).
- **User Tracking Logs**: Tenant-isolated, enable/disable via config.
- **SEO**: Per-store metadata, sitemaps, robots.txt.
- **Store-Level Logs**: Tenant-specific, accessible to store owners/admins.
- **Admin Permissions**: RBAC for system/store-level admins.
- **Modular Hooks**: WordPress-style extensibility with Redis-backed execution.
- **Module Migrations/Seeders**: Versioned, independent per module.
- **Sensitive Data Security**: Encrypted passwords, file-based controls, RLS.
- **Shared Components**: Reusable UI components (grids, buttons, etc.).
- **I18n**: Type-safe translations with health dashboard.
- **FX & Pricing**: ECB rates, merchant spread, immutable snapshots.
- **Performance**: Read/write splitting, query budgets, tenant canary testing.
- **Disaster Recovery**: Continuous backups, nightly `pg_dump`, RTO < 30 min, RPO < 5 min.

## Architecture
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, BullMQ.
- **Frontend**: React, Next.js (storefront), Vite (admin, merchant, builder).
- **Infrastructure**: AWS Aurora, Kubernetes, Docker, Terraform.
- **Monitoring**: Loki, Prometheus, Grafana with tenant-specific dashboards.
- **Security**: RLS, CSP nonce, idempotency, signed webhooks, rate-limiting.
- **Data Model**:
  ```
  tenant_id bigint NOT NULL
  id        bigint PRIMARY KEY
  uuid      uuid UNIQUE NOT NULL
  created_at timestamptz DEFAULT now()
  updated_at timestamptz DEFAULT now()
  deleted_at timestamptz
  ```
  - Range-partitioned on `(tenant_id, id)` for hot tables.
  - `tenant.db_shard` (e.g., `shared`, `schema:acme`, `db:acme`, `cluster:acme-eu`).

## Setup
1. **Clone Repository**:
   ```bash
   git clone https://github.com/deservefirst/deservefirst.git
   cd deservefirst
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   cd frontend/admin-panel && npm install
   cd ../merchant-dashboard && npm install
   cd ../customer-frontend && npm install
   cd ../storefront-builder && npm install
   ```
3. **Configure Environment**:
   - Copy `.env.example` to `.env`.
   - Set:
     ```plaintext
     DB_TYPE=postgresql
     DB_HOST=localhost
     DB_PORT=5432
     DB_USER=admin
     DB_PASSWORD=password
     SHARD_ENABLED_TENANT_123=false
     DEBUG_PATH_HINTING=true
     SECRET_KEY_PATH=/config/secrets/encryption.key
     ```
4. **Run Migrations**:
   ```bash
   npm run migrate
   ```
5. **Start Services**:
   ```bash
   docker-compose up -d
   npm run start:backend
   cd frontend/admin-panel && npm run dev
   cd ../merchant-dashboard && npm run dev
   cd ../customer-frontend && npm run dev
   ```
6. **Access Platform**:
   - Admin: `http://admin.deservefirst.com`
   - Merchant Dashboard: `http://merchant.deservefirst.com`
   - Storefront: `http://store.deservefirst.com`

## APIs
See `docs/api/openapi.yaml` for full API specs. Key endpoints:
- **Tenants**: `POST /api/tenants`, `GET /api/tenants/:uuid`
- **Users**: `POST /api/users`, `GET /api/users/:uuid`
- **Products**: `POST /api/products`, `GET /api/products/:uuid`
- **Orders**: `POST /api/orders`, `GET /api/orders/:uuid`
- **Translations**: `GET /api/translations/health`

## Module Documentation
- **Core**: Tenant, user, settings, currency, translations, migrations, performance (`docs/modules/core/README.md`).
- **Auth**: Authentication, RBAC, user tracking logs (`docs/modules/auth/README.md`).
- **Admin**: System-level admin UI and permissions (`docs/modules/admin/README.md`).
- **Store-Admin**: Store-level admin UI and permissions (`docs/modules/store-admin/README.md`).
- **Theme**: Template rendering, path hinting (`docs/modules/theme/README.md`).
- **Store**: Store configuration, logs (`docs/modules/store/README.md`).
- **Tenant**: Tenant configuration, sharding (`docs/modules/tenant/README.md`).
- **Catalog**: Product management, SEO (`docs/modules/catalog/README.md`).
- **CMS**: Content pages, sitemaps (`docs/modules/cms/README.md`).
- **I18n**: Translations, health dashboard (`docs/modules/i18n/README.md`).
- **Cart/Checkout/Order/Payment/Shipping**: E-commerce core (`docs/modules/<module>/README.md`).
- **Logging**: Store-level and audit logs (`docs/modules/logging/README.md`).
- **Plugin/App**: Third-party integrations (`docs/modules/<module>/README.md`).
- **Analytics/Notification/Support/Discount/Search**: Additional features (`docs/modules/<module>/README.md`).

## Security
- **RLS**: Enforced on all tables (`tenant_id`).
- **CSP Nonce**: Inline assets in `theme.service.ts`.
- **Idempotency**: `X-Idempotency-Key` in `checkout` module.
- **Signed Webhooks**: HMAC-SHA256 in `payment` module.
- **Rate-Limiting**: 100 req/min per tenant+IP (`rate-limiter.service.ts`).
- **Audit Logs**: Append-only, exported to S3/Glacier (`audit-log.service.ts`).

## Performance
- **Read/Write Split**: Aurora replica for reads if lag < 1s (`database.util.ts`).
- **Cache Tags**: `t:{tenant}:{locale}:{ns}`, `fx:{base}:{quote}` (`cache.service.ts`).
- **Query Budget**: Log `EXPLAIN ANALYZE` if cost > 5,000 (`performance.service.ts`).
- **Tenant Canary**: 1% traffic to new shard for 24h (`sharding.service.ts`).

## Disaster Recovery
- **Continuous Backup**: Aurora to S3 (35-day point-in-time).
- **Logical Backup**: Nightly `pg_dump` per tenant, kept 90 days (`backup-tenant.sh`).
- **Cross-Region Replica**: For `cluster:*` shards.
- **Restore Drill**: Every 30 days, RTO < 30 min, RPO < 5 min.

## Observability
- **Loki**: Logs with `tenant_id` label.
- **Prometheus**: Per-endpoint latency.
- **Grafana Dashboards**: Tenant TPS, translation coverage, FX age, hook execution time.
- **Alerts**: FX rate > 15 min old, missing translations > 10%, shard lag > 5s.

## Developer Experience
- **Type-Safe I18n**: `npm run i18n:types` generates `locale-keys.d.ts`.
- **Storybook**: `frontend/shared/stories/` for component previews.
- **Path Hinting**: `?hinting=1` shows component paths (`path-hinting.service.ts`).
- **Smoke Tests**: Playwright tests `/cart` with `MXN` + `es-419` (`scripts/test/smoke.ts`).

## Sharding
- **Shard Map**: `tenant.db_shard` (e.g., `shared`, `schema:acme`, `db:acme`, `cluster:acme-eu`).
- **Migration**:
  ```bash
  npm run migrate-tenant -- --tenant acme --target "cluster:acme-us-west-2" --dry-run false --rate-limit 5000
  ```
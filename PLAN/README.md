# Deservefirst E-Commerce SaaS Platform

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
- **Single Database with Row-Level Isolation**: `tenant_id` on all tables, shard-ready.
- **Template Path Hinting**: Debugging for templates/components (admin-only).
- **User Tracking Logs**: Tenant-isolated, enable/disable via config.
- **SEO**: Per-store metadata, sitemaps, robots.txt.
- **Store-Level Logs**: Tenant-specific, accessible to store owners/admins.
- **Admin Permissions**: RBAC for system/store-level admins.
- **Modular Hooks**: WordPress-style extensibility.
- **Module Migrations/Seeders**: Versioned, independent per module.
- **Sensitive Data Security**: Encrypted passwords, file-based controls.
- **Shared Components**: Reusable UI components (grids, buttons, etc.).
- **I18n**: Type-safe translations with health dashboard.
- **FX & Pricing**: ECB rates, merchant spread, immutable snapshots.

### Architecture
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, BullMQ.
- **Frontend**: React, Next.js (storefront), Vite (admin, merchant, builder).
- **Infrastructure**: AWS Aurora, Kubernetes, Docker, Terraform.
- **Monitoring**: Loki, Prometheus, Grafana.

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

## Documentation
- **Architecture**: `docs/architecture/ARCHITECTURE.md`
- **API**: `docs/api/openapi.yaml`
- **User Guide**: `docs/public/USER_GUIDE.md`
- **Module Docs**: `docs/modules/<module>/README.md`

## Contributing
See `docs/CONTRIBUTING.md` for guidelines.
CoreModule
==========

Purpose
-------
CoreModule is the foundational module for the Deservefirst platform. It provides:
- Database provider abstraction (MySQLProvider)
- Cache provider abstraction (RedisProvider)
- Router provider (Express)
- ConfigManager with AJV validation using SettingsSchema
- Event and Hook providers
- I18n support (i18next)
- ModuleRegistry to register other modules
- Migrations for core schemas

How to use
----------
1. Install dependencies:
   npm install

2. Configure environment variables:
   - DEFAULT_LANGUAGE (default 'en')
   - PORT
   - MYSQL_URL
   - REDIS_URL

3. Initialize providers from your application entry:
   import { initializeCoreModule, startApplication } from '@deservefirst/core-module';
   initializeCoreModule({ mysqlUrl: process.env.MYSQL_URL, redisUrl: process.env.REDIS_URL });
   startApplication();

Security & Scalability notes
----------------------------
- Tenant isolation: keep tenantId in every query. Consider a Tenant Metadata Service (TMS) for routing to shards.
- Use prepared statements and parameterized queries (mysql2 promise API as used).
- For high scale, replace direct MySQL with Vitess or a distributed SQL solution.
- Redis should be a cluster and configured with ACLs in production.
- Use TLS for DB and Redis connections.
- Limit SQL privileges for application user (no SUPER).


-- UP
-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    subdomain VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    plan VARCHAR(50) DEFAULT 'free',
    settings JSON,
    custom_fields JSON,
    logo_url VARCHAR(500),
    website_url VARCHAR(500),
    support_email VARCHAR(255),
    timezone VARCHAR(100) DEFAULT 'UTC',
    locale VARCHAR(10) DEFAULT 'en',
    max_users INT DEFAULT 0,
    max_stores INT DEFAULT 0,
    max_products INT DEFAULT 0,
    trial_ends_at TIMESTAMP NULL,
    subscription_ends_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenants_subdomain (subdomain),
    INDEX idx_tenants_active (active),
    INDEX idx_tenants_plan (plan)
);

-- Create tenant_settings table
CREATE TABLE IF NOT EXISTS tenant_settings (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'string',
    is_secret BOOLEAN DEFAULT FALSE,
    is_required BOOLEAN DEFAULT FALSE,
    validation JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant_settings_tenant_key (tenant_id, key),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_tenant_settings_tenant_id (tenant_id),
    INDEX idx_tenant_settings_key (key)
);

-- DOWN
-- Drop tenant_settings table
DROP TABLE IF EXISTS tenant_settings;

-- Drop tenants table
DROP TABLE IF EXISTS tenants;

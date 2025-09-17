-- UP
-- Add billing fields to tenants table
ALTER TABLE tenants 
ADD COLUMN billing_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN billing_customer_id VARCHAR(255),
ADD COLUMN billing_subscription_id VARCHAR(255),
ADD COLUMN billing_status VARCHAR(50) DEFAULT 'inactive',
ADD COLUMN billing_currency VARCHAR(3) DEFAULT 'USD',
ADD COLUMN billing_interval VARCHAR(20) DEFAULT 'monthly',
ADD COLUMN billing_amount DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN billing_next_invoice_at TIMESTAMP NULL,
ADD COLUMN billing_trial_ends_at TIMESTAMP NULL,
ADD COLUMN billing_canceled_at TIMESTAMP NULL;

-- Create tenant_billing table
CREATE TABLE IF NOT EXISTS tenant_billing (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(50) NOT NULL,
    due_date TIMESTAMP NOT NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_tenant_billing_tenant_id (tenant_id),
    INDEX idx_tenant_billing_status (status),
    INDEX idx_tenant_billing_due_date (due_date)
);

-- Create tenant_usage table
CREATE TABLE IF NOT EXISTS tenant_usage (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    usage_type VARCHAR(100) NOT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    usage_limit INT NOT NULL DEFAULT 0,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tenant_usage_tenant_type_period (tenant_id, usage_type, period_start),
    INDEX idx_tenant_usage_tenant_id (tenant_id),
    INDEX idx_tenant_usage_type (usage_type),
    INDEX idx_tenant_usage_period (period_start, period_end)
);

-- Create indexes for performance
CREATE INDEX idx_tenants_billing_enabled ON tenants(billing_enabled);
CREATE INDEX idx_tenants_billing_status ON tenants(billing_status);
CREATE INDEX idx_tenants_billing_next_invoice ON tenants(billing_next_invoice_at);

-- DOWN
-- Drop tenant_usage table
DROP TABLE IF EXISTS tenant_usage;

-- Drop tenant_billing table
DROP TABLE IF EXISTS tenant_billing;

-- Remove billing fields from tenants table
ALTER TABLE tenants 
DROP COLUMN billing_enabled,
DROP COLUMN billing_customer_id,
DROP COLUMN billing_subscription_id,
DROP COLUMN billing_status,
DROP COLUMN billing_currency,
DROP COLUMN billing_interval,
DROP COLUMN billing_amount,
DROP COLUMN billing_next_invoice_at,
DROP COLUMN billing_trial_ends_at,
DROP COLUMN billing_canceled_at;

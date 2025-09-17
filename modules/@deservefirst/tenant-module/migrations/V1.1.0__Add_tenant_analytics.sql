-- UP
-- Add analytics fields to tenants table
ALTER TABLE tenants 
ADD COLUMN analytics_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN analytics_tracking_id VARCHAR(255),
ADD COLUMN last_activity_at TIMESTAMP NULL,
ADD COLUMN total_users INT DEFAULT 0,
ADD COLUMN total_stores INT DEFAULT 0,
ADD COLUMN total_products INT DEFAULT 0,
ADD COLUMN monthly_requests INT DEFAULT 0,
ADD COLUMN storage_used BIGINT DEFAULT 0,
ADD COLUMN bandwidth_used BIGINT DEFAULT 0;

-- Create tenant_analytics table
CREATE TABLE IF NOT EXISTS tenant_analytics (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL,
    metric_unit VARCHAR(50),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_tenant_analytics_tenant_id (tenant_id),
    INDEX idx_tenant_analytics_metric (metric_name),
    INDEX idx_tenant_analytics_recorded_at (recorded_at)
);

-- Create indexes for performance
CREATE INDEX idx_tenants_analytics_enabled ON tenants(analytics_enabled);
CREATE INDEX idx_tenants_last_activity ON tenants(last_activity_at);

-- DOWN
-- Drop tenant_analytics table
DROP TABLE IF EXISTS tenant_analytics;

-- Remove analytics fields from tenants table
ALTER TABLE tenants 
DROP COLUMN analytics_enabled,
DROP COLUMN analytics_tracking_id,
DROP COLUMN last_activity_at,
DROP COLUMN total_users,
DROP COLUMN total_stores,
DROP COLUMN total_products,
DROP COLUMN monthly_requests,
DROP COLUMN storage_used,
DROP COLUMN bandwidth_used;

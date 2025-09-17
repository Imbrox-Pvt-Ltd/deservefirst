export interface TenantValidationHook {
  name: string;
  priority: number;
  execute(tenantData: any): Promise<{ valid: boolean; errors: string[] }>;
}

export class TenantValidationHookImpl implements TenantValidationHook {
  name = 'tenant-validation';
  priority = 100;

  async execute(tenantData: any): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate required fields
    if (!tenantData.name) {
      errors.push('Tenant name is required');
    }

    if (!tenantData.subdomain) {
      errors.push('Tenant subdomain is required');
    }

    if (!tenantData.displayName) {
      errors.push('Tenant display name is required');
    }

    // Validate subdomain format
    if (tenantData.subdomain && !/^[a-z0-9-]+$/.test(tenantData.subdomain)) {
      errors.push('Subdomain must contain only lowercase letters, numbers, and hyphens');
    }

    // Validate subdomain length
    if (tenantData.subdomain && (tenantData.subdomain.length < 3 || tenantData.subdomain.length > 50)) {
      errors.push('Subdomain must be between 3 and 50 characters');
    }

    // Validate plan
    const validPlans = ['free', 'basic', 'premium', 'enterprise'];
    if (tenantData.plan && !validPlans.includes(tenantData.plan)) {
      errors.push(`Plan must be one of: ${validPlans.join(', ')}`);
    }

    // Validate email format if provided
    if (tenantData.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenantData.supportEmail)) {
      errors.push('Support email must be a valid email address');
    }

    // Validate website URL if provided
    if (tenantData.websiteUrl && !/^https?:\/\/.+/.test(tenantData.websiteUrl)) {
      errors.push('Website URL must start with http:// or https://');
    }

    // Validate numeric limits
    if (tenantData.maxUsers !== undefined && (tenantData.maxUsers < 0 || !Number.isInteger(tenantData.maxUsers))) {
      errors.push('Max users must be a non-negative integer');
    }

    if (tenantData.maxStores !== undefined && (tenantData.maxStores < 0 || !Number.isInteger(tenantData.maxStores))) {
      errors.push('Max stores must be a non-negative integer');
    }

    if (tenantData.maxProducts !== undefined && (tenantData.maxProducts < 0 || !Number.isInteger(tenantData.maxProducts))) {
      errors.push('Max products must be a non-negative integer');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

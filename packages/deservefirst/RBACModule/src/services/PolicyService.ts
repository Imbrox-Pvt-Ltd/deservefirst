import { Database } from '@deservefirst/core-module';
import Policy from '../models/Policy';

export class PolicyService {
  static async init() {
    // Initialize if needed
  }

  static async createPolicy(tenantId: string, data: any) {
    return Database.create(Policy, { ...data, tenantId });
  }

  static async getPolicies(tenantId: string) {
    return Database.find(Policy, { tenantId });
  }
}

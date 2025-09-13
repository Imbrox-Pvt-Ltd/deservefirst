import { Database } from '@deservefirst/core-module';
import CustomFields from '../models/CustomFields';

export class CustomFieldsService {
  static async init() {
    // Initialize if needed
  }

  static async createCustomField(tenantId: string, storeId: string, data: any) {
    return Database.create(CustomFields, { ...data, tenantId, storeId });
  }

  static async getCustomFields(tenantId: string, storeId: string, entityType: string, entityId: string) {
    return Database.find(CustomFields, { tenantId, storeId, entityType, entityId });
  }
}

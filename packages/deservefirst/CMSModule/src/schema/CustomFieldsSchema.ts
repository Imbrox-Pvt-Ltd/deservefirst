import { Database } from '@deservefirst/core-module';

export const CustomFieldsSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  fieldName: { type: String, required: true },
  fieldValue: { type: Object },
}, { timestamps: true });

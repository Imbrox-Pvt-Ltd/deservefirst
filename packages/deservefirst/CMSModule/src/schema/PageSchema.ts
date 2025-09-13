import { Database } from '@deservefirst/core-module';

export const PageSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true },
  title: { type: String, required: true },
  urlKey: { type: String, required: true, unique: true },
  content: { type: String },
  isActive: { type: Boolean, default: true },
  metaTitle: { type: String },
  metaDescription: { type: String },
  customFields: { type: Object, default: {} },
}, { timestamps: true });

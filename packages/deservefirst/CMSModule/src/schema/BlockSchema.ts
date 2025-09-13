import { Database } from '@deservefirst/core-module';

export const BlockSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true },
  identifier: { type: String, required: true, unique: true },
  content: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

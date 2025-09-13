import { Database } from '@deservefirst/core-module';

export const UrlRewriteSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  storeId: { type: String, index: true },
  requestPath: { type: String, required: true, unique: true },
  targetPath: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
}, { timestamps: true });

import { Database } from '@deservefirst/core-module';

export const RoleSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
}, { timestamps: true });

import { Database } from '@deservefirst/core-module';

export const PolicySchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  roleId: { type: String, required: true },
  permissionId: { type: String, required: true },
}, { timestamps: true });

import { Database } from '@deservefirst/core-module';

export const PermissionSchema = Database.createSchema({
  tenantId: { type: String, required: true, index: true },
  name: { type: String, required: true, unique: true },
  description: { type: String },
}, { timestamps: true });

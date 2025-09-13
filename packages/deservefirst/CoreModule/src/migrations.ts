import { Database } from './database/Database';

export async function runMigrations() {
  const settingsSchema = Database.createSchema({
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String },
    settingId: { type: String, required: true },
    value: { type: Object },
  }, { timestamps: true });
  await Database.model('settings', settingsSchema);

  const storeModulesSchema = Database.createSchema({
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String, required: true },
    name: { type: String, required: true },
    services: { type: Object },
    hooks: { type: Object },
    events: { type: Object },
  }, { timestamps: true });
  await Database.model('storeModules', storeModulesSchema);
}

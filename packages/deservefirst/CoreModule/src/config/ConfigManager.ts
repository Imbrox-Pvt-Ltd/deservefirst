import Ajv from 'ajv';
import { ModuleRegistry } from '../modules/ModuleRegistry';
import { Cache } from '../cache/Cache';
import { Database } from '../database/Database';
import { Hooks } from '../hooks/Hooks';
import { SettingsSchema } from './SettingsSchema';
import fs from 'fs';
import path from 'path';

const ajv = new Ajv();
const validate = ajv.compile(SettingsSchema);

export class ConfigManager {
  static async loadSettings(): Promise<void> {
    ModuleRegistry.getModules().forEach(module => {
      const settingsPath = path.join(__dirname, `../../${module.name}/config/settings.json`);
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (!validate(settings)) {
          throw new Error(`Invalid settings.json in ${module.name}: ${JSON.stringify(validate.errors)}`);
        }
        module.settings = settings;
      }
    });
  }

  static async getConfigValue(tenantId: string, storeId: string | null, settingId: string): Promise<any> {
    const cacheKey = `config:${tenantId}:${storeId || 'default'}:${settingId}`;
    const cached = await Cache.get(cacheKey);
    if (cached) return cached;

    const query = storeId ? { tenantId, storeId, settingId } : { tenantId, settingId };
    const setting = await Database.findOne('settings', query);
    const value = setting ? setting.value : this.getDefaultValue(settingId);
    if (value) await Cache.set(cacheKey, value);
    return value;
  }

  static async saveConfigValue(tenantId: string, storeId: string | null, settingId: string, value: any): Promise<void> {
    const field = ModuleRegistry.getModules()
      .flatMap(module => module.settings || [])
      .find(f => f.id === settingId);

    if (!field) throw new Error(`Unknown setting: ${settingId}`);
    if (field.validators) {
      if (field.validators.min && value < field.validators.min) throw new Error(`Value below minimum: ${field.validators.min}`);
      if (field.validators.max && value > field.validators.max) throw new Error(`Value above maximum: ${field.validators.max}`);
      if (field.validators.regex && !new RegExp(field.validators.regex).test(value)) throw new Error(`Value does not match regex: ${field.validators.regex}`);
    }

    const query = storeId ? { tenantId, storeId, settingId } : { tenantId, settingId };
    await Database.update('settings', query, { value }, { upsert: true });
    await Cache.set(`config:${tenantId}:${storeId || 'default'}:${settingId}`, value);
    await Hooks.execute('afterConfigSave', { tenantId, storeId, settingId, value });
  }

  static getDefaultValue(settingId: string): any {
    const field = ModuleRegistry.getModules()
      .flatMap(module => module.settings || [])
      .find(f => f.id === settingId);
    return field ? field.default : null;
  }
}

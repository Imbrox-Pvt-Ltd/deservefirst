import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettings } from '../entities/tenant-settings.entity';

export interface CreateTenantSettingDto {
  tenantId: string;
  key: string;
  value: string;
  description?: string;
  type?: string;
  isSecret?: boolean;
  isRequired?: boolean;
  validation?: Record<string, any>;
}

export interface UpdateTenantSettingDto {
  value?: string;
  description?: string;
  type?: string;
  isSecret?: boolean;
  isRequired?: boolean;
  validation?: Record<string, any>;
}

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);

  constructor(
    @InjectRepository(TenantSettings)
    private tenantSettingsRepository: Repository<TenantSettings>,
  ) {}

  async findAll(tenantId: string): Promise<TenantSettings[]> {
    this.logger.log(`Finding all settings for tenant: ${tenantId}`);
    return this.tenantSettingsRepository.find({
      where: { tenantId },
      order: { key: 'ASC' },
    });
  }

  async findOne(tenantId: string, key: string): Promise<TenantSettings> {
    this.logger.log(`Finding setting ${key} for tenant: ${tenantId}`);
    const setting = await this.tenantSettingsRepository.findOne({
      where: { tenantId, key },
    });

    if (!setting) {
      throw new NotFoundException(`Setting ${key} not found for tenant ${tenantId}`);
    }

    return setting;
  }

  async create(createSettingDto: CreateTenantSettingDto): Promise<TenantSettings> {
    this.logger.log(`Creating setting ${createSettingDto.key} for tenant: ${createSettingDto.tenantId}`);

    const setting = this.tenantSettingsRepository.create({
      ...createSettingDto,
      type: createSettingDto.type || 'string',
      isSecret: createSettingDto.isSecret || false,
      isRequired: createSettingDto.isRequired || false,
      validation: createSettingDto.validation || {},
    });

    return this.tenantSettingsRepository.save(setting);
  }

  async update(tenantId: string, key: string, updateSettingDto: UpdateTenantSettingDto): Promise<TenantSettings> {
    this.logger.log(`Updating setting ${key} for tenant: ${tenantId}`);

    const setting = await this.findOne(tenantId, key);
    Object.assign(setting, updateSettingDto);
    
    return this.tenantSettingsRepository.save(setting);
  }

  async delete(tenantId: string, key: string): Promise<boolean> {
    this.logger.log(`Deleting setting ${key} for tenant: ${tenantId}`);

    const setting = await this.findOne(tenantId, key);
    await this.tenantSettingsRepository.remove(setting);

    return true;
  }

  async getSettingsAsObject(tenantId: string): Promise<Record<string, any>> {
    this.logger.log(`Getting settings as object for tenant: ${tenantId}`);
    
    const settings = await this.findAll(tenantId);
    const settingsObject: Record<string, any> = {};

    for (const setting of settings) {
      let value = setting.value;
      
      // Parse value based on type
      switch (setting.type) {
        case 'number':
          value = parseFloat(setting.value);
          break;
        case 'boolean':
          value = setting.value === 'true';
          break;
        case 'json':
          try {
            value = JSON.parse(setting.value);
          } catch (error) {
            this.logger.warn(`Failed to parse JSON setting ${setting.key}: ${error.message}`);
          }
          break;
        case 'array':
          try {
            value = JSON.parse(setting.value);
          } catch (error) {
            this.logger.warn(`Failed to parse array setting ${setting.key}: ${error.message}`);
            value = [setting.value];
          }
          break;
        default:
          value = setting.value;
      }

      settingsObject[setting.key] = value;
    }

    return settingsObject;
  }

  async setSetting(tenantId: string, key: string, value: any, options?: {
    description?: string;
    type?: string;
    isSecret?: boolean;
    isRequired?: boolean;
    validation?: Record<string, any>;
  }): Promise<TenantSettings> {
    this.logger.log(`Setting ${key} for tenant: ${tenantId}`);

    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const type = options?.type || (typeof value === 'object' ? 'json' : typeof value);

    try {
      const existingSetting = await this.findOne(tenantId, key);
      return this.update(tenantId, key, {
        value: stringValue,
        type,
        description: options?.description,
        isSecret: options?.isSecret,
        isRequired: options?.isRequired,
        validation: options?.validation,
      });
    } catch (error) {
      return this.create({
        tenantId,
        key,
        value: stringValue,
        type,
        description: options?.description,
        isSecret: options?.isSecret,
        isRequired: options?.isRequired,
        validation: options?.validation,
      });
    }
  }

  async validateSetting(tenantId: string, key: string, value: any): Promise<{ valid: boolean; error?: string }> {
    this.logger.log(`Validating setting ${key} for tenant: ${tenantId}`);

    try {
      const setting = await this.findOne(tenantId, key);
      
      if (setting.validation) {
        // TODO: Implement validation logic based on validation rules
        // This could include min/max values, regex patterns, etc.
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async getSecretSettings(tenantId: string): Promise<TenantSettings[]> {
    this.logger.log(`Getting secret settings for tenant: ${tenantId}`);
    
    return this.tenantSettingsRepository.find({
      where: { tenantId, isSecret: true },
      order: { key: 'ASC' },
    });
  }

  async getRequiredSettings(tenantId: string): Promise<TenantSettings[]> {
    this.logger.log(`Getting required settings for tenant: ${tenantId}`);
    
    return this.tenantSettingsRepository.find({
      where: { tenantId, isRequired: true },
      order: { key: 'ASC' },
    });
  }
}

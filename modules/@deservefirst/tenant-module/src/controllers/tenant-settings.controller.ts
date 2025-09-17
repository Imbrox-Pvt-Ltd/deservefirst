import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { TenantSettingsService, CreateTenantSettingDto, UpdateTenantSettingDto } from '../services/tenant-settings.service';

@ApiTags('tenant-settings')
@Controller('tenant-settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get(':tenantId')
  @ApiOperation({ summary: 'Get all settings for a tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Settings retrieved successfully' })
  async findAll(@Param('tenantId') tenantId: string) {
    return this.tenantSettingsService.findAll(tenantId);
  }

  @Get(':tenantId/object')
  @ApiOperation({ summary: 'Get tenant settings as object' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Settings object retrieved successfully' })
  async getSettingsAsObject(@Param('tenantId') tenantId: string) {
    return this.tenantSettingsService.getSettingsAsObject(tenantId);
  }

  @Get(':tenantId/secret')
  @ApiOperation({ summary: 'Get secret settings for a tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Secret settings retrieved successfully' })
  async getSecretSettings(@Param('tenantId') tenantId: string) {
    return this.tenantSettingsService.getSecretSettings(tenantId);
  }

  @Get(':tenantId/required')
  @ApiOperation({ summary: 'Get required settings for a tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Required settings retrieved successfully' })
  async getRequiredSettings(@Param('tenantId') tenantId: string) {
    return this.tenantSettingsService.getRequiredSettings(tenantId);
  }

  @Get(':tenantId/:key')
  @ApiOperation({ summary: 'Get specific setting for a tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'key', description: 'Setting key' })
  @ApiResponse({ status: 200, description: 'Setting retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  async findOne(@Param('tenantId') tenantId: string, @Param('key') key: string) {
    return this.tenantSettingsService.findOne(tenantId, key);
  }

  @Post()
  @ApiOperation({ summary: 'Create new tenant setting' })
  @ApiBody({ type: CreateTenantSettingDto })
  @ApiResponse({ status: 201, description: 'Setting created successfully' })
  async create(@Body() createSettingDto: CreateTenantSettingDto) {
    return this.tenantSettingsService.create(createSettingDto);
  }

  @Put(':tenantId/:key')
  @ApiOperation({ summary: 'Update tenant setting' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'key', description: 'Setting key' })
  @ApiBody({ type: UpdateTenantSettingDto })
  @ApiResponse({ status: 200, description: 'Setting updated successfully' })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @Body() updateSettingDto: UpdateTenantSettingDto,
  ) {
    return this.tenantSettingsService.update(tenantId, key, updateSettingDto);
  }

  @Delete(':tenantId/:key')
  @ApiOperation({ summary: 'Delete tenant setting' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'key', description: 'Setting key' })
  @ApiResponse({ status: 200, description: 'Setting deleted successfully' })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  async delete(@Param('tenantId') tenantId: string, @Param('key') key: string) {
    await this.tenantSettingsService.delete(tenantId, key);
    return { message: 'Setting deleted successfully' };
  }

  @Post(':tenantId/set')
  @ApiOperation({ summary: 'Set tenant setting value' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'any' },
        description: { type: 'string' },
        type: { type: 'string' },
        isSecret: { type: 'boolean' },
        isRequired: { type: 'boolean' },
        validation: { type: 'object' },
      },
      required: ['key', 'value'],
    },
  })
  @ApiResponse({ status: 200, description: 'Setting set successfully' })
  async setSetting(
    @Param('tenantId') tenantId: string,
    @Body() body: {
      key: string;
      value: any;
      description?: string;
      type?: string;
      isSecret?: boolean;
      isRequired?: boolean;
      validation?: Record<string, any>;
    },
  ) {
    const { key, value, ...options } = body;
    return this.tenantSettingsService.setSetting(tenantId, key, value, options);
  }

  @Post(':tenantId/:key/validate')
  @ApiOperation({ summary: 'Validate tenant setting value' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'key', description: 'Setting key' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        value: { type: 'any' },
      },
      required: ['value'],
    },
  })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateSetting(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @Body('value') value: any,
  ) {
    return this.tenantSettingsService.validateSetting(tenantId, key, value);
  }
}

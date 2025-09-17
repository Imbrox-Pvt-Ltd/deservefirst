import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { TenantService, CreateTenantDto, UpdateTenantDto } from '../services/tenant.service';

@ApiTags('tenant')
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tenants' })
  @ApiResponse({ status: 200, description: 'Tenants retrieved successfully' })
  async findAll() {
    return this.tenantService.findAll();
  }

  @Get('search')
  @ApiOperation({ summary: 'Search tenants' })
  @ApiQuery({ name: 'q', description: 'Search query' })
  @ApiResponse({ status: 200, description: 'Search results retrieved successfully' })
  async search(@Query('q') query: string) {
    return this.tenantService.searchTenants(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by id' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Tenant retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async findOne(@Param('id') id: string) {
    return this.tenantService.findOne(id);
  }

  @Get('subdomain/:subdomain')
  @ApiOperation({ summary: 'Get tenant by subdomain' })
  @ApiParam({ name: 'subdomain', description: 'Tenant subdomain' })
  @ApiResponse({ status: 200, description: 'Tenant retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async findBySubdomain(@Param('subdomain') subdomain: string) {
    return this.tenantService.findBySubdomain(subdomain);
  }

  @Post()
  @ApiOperation({ summary: 'Create new tenant' })
  @ApiBody({ type: CreateTenantDto })
  @ApiResponse({ status: 201, description: 'Tenant created successfully' })
  @ApiResponse({ status: 409, description: 'Tenant already exists' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantService.create(createTenantDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiBody({ type: UpdateTenantDto })
  @ApiResponse({ status: 200, description: 'Tenant updated successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantService.update(id, updateTenantDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Tenant deleted successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async delete(@Param('id') id: string) {
    await this.tenantService.delete(id);
    return { message: 'Tenant deleted successfully' };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Tenant activated successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async activate(@Param('id') id: string) {
    return this.tenantService.activate(id);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Tenant deactivated successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async deactivate(@Param('id') id: string) {
    return this.tenantService.deactivate(id);
  }

  @Put(':id/plan')
  @ApiOperation({ summary: 'Update tenant plan' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiBody({ schema: { type: 'object', properties: { plan: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Tenant plan updated successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async updatePlan(@Param('id') id: string, @Body('plan') plan: string) {
    return this.tenantService.updatePlan(id, plan);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get tenant statistics' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Tenant stats retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getStats(@Param('id') id: string) {
    return this.tenantService.getTenantStats(id);
  }
}

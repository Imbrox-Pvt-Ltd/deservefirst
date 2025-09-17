import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RbacService } from '../services/rbac.service';

@ApiTags('rbac')
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async getRoles() {
    return this.rbacService.getRoles();
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Get all permissions' })
  @ApiResponse({ status: 200, description: 'Permissions retrieved successfully' })
  async getPermissions() {
    return this.rbacService.getPermissions();
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  async createRole(@Body() createRoleDto: any) {
    return this.rbacService.createRole(createRoleDto);
  }
}

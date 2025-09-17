import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CoreService } from '../services/core.service';

@ApiTags('core')
@Controller('core')
export class CoreController {
  constructor(private readonly coreService: CoreService) {}

  @Get('info')
  @ApiOperation({ summary: 'Get core module information' })
  @ApiResponse({ status: 200, description: 'Core module information retrieved successfully' })
  async getInfo() {
    return this.coreService.getSystemInfo();
  }

  @Get('modules')
  @ApiOperation({ summary: 'Get all registered modules' })
  @ApiResponse({ status: 200, description: 'Modules retrieved successfully' })
  async getModules() {
    return this.coreService.getModules();
  }
}

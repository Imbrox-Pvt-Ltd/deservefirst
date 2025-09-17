import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CoreService } from '../services/core.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly coreService: CoreService) {}

  @Get()
  @ApiOperation({ summary: 'Get system health status' })
  @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
  async getHealth() {
    return this.coreService.getHealthStatus();
  }
}

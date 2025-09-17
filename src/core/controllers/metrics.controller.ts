import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CoreService } from '../services/core.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly coreService: CoreService) {}

  @Get()
  @ApiOperation({ summary: 'Get system metrics' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getMetrics() {
    return this.coreService.getMetrics();
  }
}

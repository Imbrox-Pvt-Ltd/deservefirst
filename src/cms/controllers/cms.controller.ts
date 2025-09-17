import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CmsService } from '../services/cms.service';

@ApiTags('cms')
@Controller('cms')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get('content')
  @ApiOperation({ summary: 'Get all content' })
  @ApiResponse({ status: 200, description: 'Content retrieved successfully' })
  async getContent() {
    return this.cmsService.getContent();
  }

  @Post('content')
  @ApiOperation({ summary: 'Create new content' })
  @ApiResponse({ status: 201, description: 'Content created successfully' })
  async createContent(@Body() createContentDto: any) {
    return this.cmsService.createContent(createContentDto);
  }

  @Get('media')
  @ApiOperation({ summary: 'Get all media' })
  @ApiResponse({ status: 200, description: 'Media retrieved successfully' })
  async getMedia() {
    return this.cmsService.getMedia();
  }
}

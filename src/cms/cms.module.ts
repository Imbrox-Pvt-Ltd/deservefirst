import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsController } from './controllers/cms.controller';
import { CmsService } from './services/cms.service';
import { Page } from './entities/page.entity';
import { Block } from './entities/block.entity';
import { Media } from './entities/media.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Page, Block, Media])],
  controllers: [CmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}

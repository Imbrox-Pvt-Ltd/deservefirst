import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacController } from './controllers/rbac.controller';
import { RbacService } from './services/rbac.service';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { Policy } from './entities/policy.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, Policy])],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}

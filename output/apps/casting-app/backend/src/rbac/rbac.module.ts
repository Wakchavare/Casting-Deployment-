import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PermissionsController } from './permissions.controller';
import { RbacService } from './rbac.service';
import { RolesController } from './roles.controller';

@Module({
  imports: [AuditLogsModule],
  controllers: [RolesController, PermissionsController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}

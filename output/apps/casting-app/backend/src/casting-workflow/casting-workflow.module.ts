import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CastingWorkflowController } from './casting-workflow.controller';
import { CastingWorkflowService } from './casting-workflow.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [CastingWorkflowController],
  providers: [CastingWorkflowService],
  exports: [CastingWorkflowService],
})
export class CastingWorkflowModule {}

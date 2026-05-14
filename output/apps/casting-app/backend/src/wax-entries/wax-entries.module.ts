import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { WaxEntriesController } from './wax-entries.controller';
import { WaxEntriesService } from './wax-entries.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [WaxEntriesController],
  providers: [WaxEntriesService],
  exports: [WaxEntriesService],
})
export class WaxEntriesModule {}

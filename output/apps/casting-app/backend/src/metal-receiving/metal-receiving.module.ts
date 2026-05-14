import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MetalReceivingController } from './metal-receiving.controller';
import { MetalReceivingService } from './metal-receiving.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [MetalReceivingController],
  providers: [MetalReceivingService],
  exports: [MetalReceivingService],
})
export class MetalReceivingModule {}

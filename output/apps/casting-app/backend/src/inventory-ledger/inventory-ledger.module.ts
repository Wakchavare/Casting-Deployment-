import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryLedgerController } from './inventory-ledger.controller';
import { InventoryLedgerService } from './inventory-ledger.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [InventoryLedgerController],
  providers: [InventoryLedgerService],
  exports: [InventoryLedgerService],
})
export class InventoryLedgerModule {}

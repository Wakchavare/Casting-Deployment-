import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { CastingWorkflowModule } from './casting-workflow/casting-workflow.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { HealthController } from './health/health.controller';
import { InventoryLedgerModule } from './inventory-ledger/inventory-ledger.module';
import { MetalReceivingModule } from './metal-receiving/metal-receiving.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { UsersModule } from './users/users.module';
import { WaxEntriesModule } from './wax-entries/wax-entries.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditLogsModule,
    AuthModule,
    RbacModule,
    UsersModule,
    WaxEntriesModule,
    CastingWorkflowModule,
    MetalReceivingModule,
    InventoryLedgerModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

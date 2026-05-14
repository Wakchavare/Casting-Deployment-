import { Controller, Get, Header, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermissions('auditLogs.view')
  findMany(@Query() query: QueryAuditLogsDto) {
    return this.auditLogs.findMany(query);
  }

  @Get('export')
  @RequirePermissions('auditLogs.export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  exportCsv(@Query() query: QueryAuditLogsDto) {
    return this.auditLogs.exportCsv(query);
  }
}

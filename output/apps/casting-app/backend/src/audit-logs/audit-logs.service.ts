import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

type AuditRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type CreateAuditLogInput = {
  user?: Pick<AuthUser, 'id' | 'username' | 'email' | 'name'>;
  action: string;
  module?: string;
  stage?: string;
  internalTreeNumber?: string;
  oldValue?: unknown;
  newValue?: unknown;
  notes?: string;
  request?: AuditRequest;
};

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAuditLogInput) {
    const data: Prisma.AuditLogCreateInput = {
      user: input.user?.id ? { connect: { id: input.user.id } } : undefined,
      username: input.user?.username ?? input.user?.email,
      action: input.action,
      module: input.module,
      stage: input.stage,
      internalTreeNumber: input.internalTreeNumber,
      oldValue: this.toJson(input.oldValue),
      newValue: this.toJson(input.newValue),
      notes: input.notes,
      ipAddress: input.request?.ip,
      userAgent: this.getUserAgent(input.request),
    };

    return this.prisma.auditLog.create({ data });
  }

  async findMany(query: QueryAuditLogsDto) {
    return this.prisma.auditLog.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async exportCsv(query: QueryAuditLogsDto) {
    const logs = await this.findMany(query);
    const header = [
      'Audit ID',
      'Date and Time',
      'User ID',
      'Username',
      'Action',
      'Module',
      'Stage',
      'Internal Tree Number',
      'Old Value',
      'New Value',
      'IP Address',
      'User Agent',
      'Notes',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.createdAt.toISOString(),
      log.userId ?? '',
      log.username ?? '',
      log.action,
      log.module ?? '',
      log.stage ?? '',
      log.internalTreeNumber ?? '',
      this.stringifyJson(log.oldValue),
      this.stringifyJson(log.newValue),
      log.ipAddress ?? '',
      log.userAgent ?? '',
      log.notes ?? '',
    ]);

    return [header, ...rows].map((row) => row.map(this.escapeCsv).join(',')).join('\n');
  }

  private buildWhere(query: QueryAuditLogsDto): Prisma.AuditLogWhereInput {
    return {
      userId: query.userId,
      username: query.username ? { contains: query.username, mode: 'insensitive' } : undefined,
      action: query.action ? { contains: query.action, mode: 'insensitive' } : undefined,
      module: query.module ? { contains: query.module, mode: 'insensitive' } : undefined,
      stage: query.stage ? { contains: query.stage, mode: 'insensitive' } : undefined,
      internalTreeNumber: query.internalTreeNumber
        ? { contains: query.internalTreeNumber, mode: 'insensitive' }
        : undefined,
      createdAt:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private stringifyJson(value: Prisma.JsonValue | null) {
    if (value === null) {
      return '';
    }

    return JSON.stringify(value);
  }

  private escapeCsv(value: string) {
    if (!/[",\n]/.test(value)) {
      return value;
    }

    return `"${value.replace(/"/g, '""')}"`;
  }

  private getUserAgent(request?: AuditRequest) {
    const userAgent = request?.headers?.['user-agent'];
    return Array.isArray(userAgent) ? userAgent.join(' ') : userAgent;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMetalReceivingDto } from './dto/create-metal-receiving.dto';
import { UpdateMetalReceivingDto } from './dto/update-metal-receiving.dto';

@Injectable()
export class MetalReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany() {
    const entries = await this.prisma.metalReceiving.findMany({
      where: { deletedAt: null },
      orderBy: { receivingDate: 'desc' },
    });
    return entries.map(this.toResponse);
  }

  async create(dto: CreateMetalReceivingDto, user: AuthUser, request?: AuthenticatedRequest) {
    const entry = await this.prisma.metalReceiving.create({
      data: {
        receivingDate: new Date(dto.receivingDate),
        vendor: dto.vendor ?? '',
        invoiceNo: dto.invoiceNo ?? '',
        metalKt: dto.metalKt ?? '',
        color: dto.color ?? '',
        metalSource: dto.metalSource ?? '',
        grossWeight: dto.grossWeight ? new Prisma.Decimal(dto.grossWeight) : null,
        netWeight: dto.netWeight ? new Prisma.Decimal(dto.netWeight) : null,
        notes: dto.notes ?? '',
        createdByUserId: user.id,
        createdByUsername: user.username || user.email,
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
    });

    await this.auditLogs.create({
      user,
      action: 'Metal receiving entry created',
      module: 'Metal Receiving',
      newValue: this.toResponse(entry),
      request,
    });

    return this.toResponse(entry);
  }

  async update(
    id: string,
    dto: UpdateMetalReceivingDto,
    user: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const before = await this.prisma.metalReceiving.findFirst({
      where: { id, deletedAt: null },
    });

    if (!before) throw new NotFoundException('Metal receiving entry not found');

    const updated = await this.prisma.metalReceiving.update({
      where: { id },
      data: {
        ...(dto.receivingDate && { receivingDate: new Date(dto.receivingDate) }),
        ...(dto.vendor !== undefined && { vendor: dto.vendor }),
        ...(dto.invoiceNo !== undefined && { invoiceNo: dto.invoiceNo }),
        ...(dto.metalKt !== undefined && { metalKt: dto.metalKt }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.metalSource !== undefined && { metalSource: dto.metalSource }),
        ...(dto.grossWeight !== undefined && {
          grossWeight: dto.grossWeight ? new Prisma.Decimal(dto.grossWeight) : null,
        }),
        ...(dto.netWeight !== undefined && {
          netWeight: dto.netWeight ? new Prisma.Decimal(dto.netWeight) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
    });

    await this.auditLogs.create({
      user,
      action: 'Metal receiving entry updated',
      module: 'Metal Receiving',
      oldValue: this.toResponse(before),
      newValue: this.toResponse(updated),
      request,
    });

    return this.toResponse(updated);
  }

  async delete(id: string, user: AuthUser, request?: AuthenticatedRequest) {
    const before = await this.prisma.metalReceiving.findFirst({
      where: { id, deletedAt: null },
    });

    if (!before) throw new NotFoundException('Metal receiving entry not found');

    await this.prisma.metalReceiving.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.create({
      user,
      action: 'Metal receiving entry deleted',
      module: 'Metal Receiving',
      oldValue: this.toResponse(before),
      request,
    });

    return { success: true };
  }

  private toResponse(entry: any) {
    return {
      id: entry.id,
      receivingDate: entry.receivingDate ? entry.receivingDate.toISOString().slice(0, 10) : '',
      vendor: entry.vendor,
      invoiceNo: entry.invoiceNo,
      metalKt: entry.metalKt,
      color: entry.color,
      metalSource: entry.metalSource,
      grossWeight: entry.grossWeight ? entry.grossWeight.toString() : '',
      netWeight: entry.netWeight ? entry.netWeight.toString() : '',
      notes: entry.notes,
      createdByUserId: entry.createdByUserId ?? '',
      createdByUsername: entry.createdByUsername ?? '',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }
}

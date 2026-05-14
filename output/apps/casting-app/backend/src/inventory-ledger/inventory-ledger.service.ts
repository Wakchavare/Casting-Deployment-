import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { PostInventoryDto } from './dto/post-inventory.dto';

const VALID_ENTRY_TYPES = ['metal_issue', 'casting_return', 'final_post'] as const;

@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll() {
    const entries = await this.prisma.inventoryLedger.findMany({
      orderBy: { postedAt: 'desc' },
    });
    return entries.map(this.toResponse);
  }

  async findByTree(internalTreeNumber: string) {
    const entries = await this.prisma.inventoryLedger.findMany({
      where: { internalTreeNumber },
      orderBy: { postedAt: 'asc' },
    });
    return entries.map(this.toResponse);
  }

  async post(dto: PostInventoryDto, user: AuthUser, request?: AuthenticatedRequest) {
    if (!VALID_ENTRY_TYPES.includes(dto.entryType as any)) {
      throw new BadRequestException(`Invalid entry type: ${dto.entryType}`);
    }

    // Duplicate prevention: check if final_post already exists for this tree
    if (dto.entryType === 'final_post') {
      const existing = await this.prisma.inventoryLedger.findFirst({
        where: {
          internalTreeNumber: dto.internalTreeNumber,
          entryType: 'final_post',
          isDuplicate: false,
        },
      });

      if (existing) {
        // Mark this posting as duplicate but still record it
        const duplicate = await this.prisma.inventoryLedger.create({
          data: {
            ...this.buildLedgerData(dto, user),
            isDuplicate: true,
          },
        });

        await this.auditLogs.create({
          user,
          action: 'Duplicate inventory posting blocked',
          module: 'Inventory',
          internalTreeNumber: dto.internalTreeNumber,
          newValue: this.toResponse(duplicate),
          notes: `Duplicate final post attempt for ${dto.internalTreeNumber}`,
          request,
        });

        throw new ConflictException(
          `Final inventory already posted for tree ${dto.internalTreeNumber}`,
        );
      }
    }

    const entry = await this.prisma.inventoryLedger.create({
      data: this.buildLedgerData(dto, user),
    });

    await this.auditLogs.create({
      user,
      action: `Inventory posted (${dto.entryType})`,
      module: 'Inventory',
      internalTreeNumber: dto.internalTreeNumber,
      newValue: this.toResponse(entry),
      request,
    });

    return this.toResponse(entry);
  }

  async postBatch(
    entries: PostInventoryDto[],
    user: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const results = [];

    for (const dto of entries) {
      const result = await this.post(dto, user, request);
      results.push(result);
    }

    return results;
  }

  private buildLedgerData(dto: PostInventoryDto, user: AuthUser): Prisma.InventoryLedgerCreateInput {
    return {
      internalTreeNumber: dto.internalTreeNumber,
      entryType: dto.entryType,
      metalKt: dto.metalKt ?? '',
      color: dto.color ?? '',
      metalSource: dto.metalSource ?? '',
      fineGoldWeight: dto.fineGoldWeight ? new Prisma.Decimal(dto.fineGoldWeight) : null,
      alloyWeight: dto.alloyWeight ? new Prisma.Decimal(dto.alloyWeight) : null,
      recycledWeight: dto.recycledWeight ? new Prisma.Decimal(dto.recycledWeight) : null,
      issuedWeight: dto.issuedWeight ? new Prisma.Decimal(dto.issuedWeight) : null,
      returnedWeight: dto.returnedWeight ? new Prisma.Decimal(dto.returnedWeight) : null,
      finishedWeight: dto.finishedWeight ? new Prisma.Decimal(dto.finishedWeight) : null,
      spruWeight: dto.spruWeight ? new Prisma.Decimal(dto.spruWeight) : null,
      scrapWeight: dto.scrapWeight ? new Prisma.Decimal(dto.scrapWeight) : null,
      isDuplicate: false,
      postedByUserId: user.id,
      postedByUsername: user.username || user.email,
      notes: dto.notes ?? '',
      rawPayload: (dto.rawPayload as any) ?? Prisma.JsonNull,
    };
  }

  private toResponse(entry: any) {
    const decStr = (v: any) => (v ? v.toString() : '');
    return {
      id: entry.id,
      internalTreeNumber: entry.internalTreeNumber,
      entryType: entry.entryType,
      metalKt: entry.metalKt,
      color: entry.color,
      metalSource: entry.metalSource,
      fineGoldWeight: decStr(entry.fineGoldWeight),
      alloyWeight: decStr(entry.alloyWeight),
      recycledWeight: decStr(entry.recycledWeight),
      issuedWeight: decStr(entry.issuedWeight),
      returnedWeight: decStr(entry.returnedWeight),
      finishedWeight: decStr(entry.finishedWeight),
      spruWeight: decStr(entry.spruWeight),
      scrapWeight: decStr(entry.scrapWeight),
      isDuplicate: entry.isDuplicate,
      postedByUserId: entry.postedByUserId ?? '',
      postedByUsername: entry.postedByUsername ?? '',
      notes: entry.notes,
      rawPayload: entry.rawPayload,
      postedAt: entry.postedAt,
    };
  }
}

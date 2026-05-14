import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCastingWorkflowDto } from './dto/update-casting-workflow.dto';

const VALID_STAGES = [
  'Awaiting Metal',
  'Ready for Casting',
  'Casting Completed',
  'QC Completed',
  'Received at Store',
] as const;

@Injectable()
export class CastingWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll() {
    const workflows = await this.prisma.castingWorkflow.findMany({
      include: {
        waxEntry: {
          where: { deletedAt: null },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Only return workflows for non-deleted wax entries
    return workflows
      .filter((w) => w.waxEntry !== null)
      .map((w) => this.toResponse(w));
  }

  async findOne(id: string) {
    const workflow = await this.prisma.castingWorkflow.findUnique({
      where: { id },
      include: { waxEntry: true },
    });

    if (!workflow || workflow.waxEntry.deletedAt) {
      throw new NotFoundException('Casting workflow not found');
    }

    return this.toResponse(workflow);
  }

  async upsertForWaxEntry(
    waxEntryId: string,
    dto: UpdateCastingWorkflowDto,
    user: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const waxEntry = await this.prisma.waxEntry.findFirst({
      where: { id: waxEntryId, deletedAt: null },
    });

    if (!waxEntry) {
      throw new NotFoundException('Wax entry not found');
    }

    if (dto.stage && !VALID_STAGES.includes(dto.stage as any)) {
      throw new BadRequestException(`Invalid stage: ${dto.stage}`);
    }

    const before = await this.prisma.castingWorkflow.findUnique({
      where: { waxEntryId },
    });

    const workflow = await this.prisma.castingWorkflow.upsert({
      where: { waxEntryId },
      create: {
        waxEntryId,
        internalTreeNumber: waxEntry.internalTreeNumber,
        stage: dto.stage ?? 'Awaiting Metal',
        notes: dto.notes ?? '',
        metalIssue: dto.metalIssue ?? Prisma.JsonNull,
        castingIssue: dto.castingIssue ?? Prisma.JsonNull,
        castingVerification: dto.castingVerification ?? Prisma.JsonNull,
        qcVerification: dto.qcVerification ?? Prisma.JsonNull,
        finalOrderPosted: dto.finalOrderPosted ?? false,
        finalStatus: dto.finalStatus ?? null,
        removedFromBoard: dto.removedFromBoard ?? false,
        isDamaged: dto.isDamaged ?? false,
        damagedTree: dto.damagedTree ?? Prisma.JsonNull,
        inventoryLedgerIds: dto.inventoryLedgerIds ?? Prisma.JsonNull,
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
      update: {
        ...(dto.stage !== undefined && { stage: dto.stage }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.metalIssue !== undefined && {
          metalIssue: dto.metalIssue === null ? Prisma.JsonNull : dto.metalIssue,
        }),
        ...(dto.castingIssue !== undefined && {
          castingIssue: dto.castingIssue === null ? Prisma.JsonNull : dto.castingIssue,
        }),
        ...(dto.castingVerification !== undefined && {
          castingVerification:
            dto.castingVerification === null ? Prisma.JsonNull : dto.castingVerification,
        }),
        ...(dto.qcVerification !== undefined && {
          qcVerification: dto.qcVerification === null ? Prisma.JsonNull : dto.qcVerification,
        }),
        ...(dto.finalOrderPosted !== undefined && { finalOrderPosted: dto.finalOrderPosted }),
        ...(dto.finalStatus !== undefined && { finalStatus: dto.finalStatus }),
        ...(dto.removedFromBoard !== undefined && { removedFromBoard: dto.removedFromBoard }),
        ...(dto.isDamaged !== undefined && { isDamaged: dto.isDamaged }),
        ...(dto.damagedTree !== undefined && {
          damagedTree: dto.damagedTree === null ? Prisma.JsonNull : dto.damagedTree,
        }),
        ...(dto.inventoryLedgerIds !== undefined && {
          inventoryLedgerIds:
            dto.inventoryLedgerIds === null ? Prisma.JsonNull : dto.inventoryLedgerIds,
        }),
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
      include: { waxEntry: true },
    });

    const action = before
      ? `Casting workflow updated (${dto.stage ?? before.stage})`
      : 'Casting workflow created';

    await this.auditLogs.create({
      user,
      action,
      module: 'Casting Process',
      stage: workflow.stage,
      internalTreeNumber: waxEntry.internalTreeNumber,
      oldValue: before ? this.toResponse({ ...before, waxEntry }) : null,
      newValue: this.toResponse(workflow),
      request,
    });

    return this.toResponse(workflow);
  }

  private toResponse(workflow: any) {
    return {
      id: workflow.id,
      waxEntryId: workflow.waxEntryId,
      internalTreeNumber: workflow.internalTreeNumber,
      stage: workflow.stage,
      notes: workflow.notes,
      metalIssue: workflow.metalIssue,
      castingIssue: workflow.castingIssue,
      castingVerification: workflow.castingVerification,
      qcVerification: workflow.qcVerification,
      finalOrderPosted: workflow.finalOrderPosted,
      finalStatus: workflow.finalStatus,
      removedFromBoard: workflow.removedFromBoard,
      isDamaged: workflow.isDamaged,
      damagedTree: workflow.damagedTree,
      inventoryLedgerIds: workflow.inventoryLedgerIds,
      updatedByUserId: workflow.updatedByUserId,
      updatedByUsername: workflow.updatedByUsername,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };
  }
}

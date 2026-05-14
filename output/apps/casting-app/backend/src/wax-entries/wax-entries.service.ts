import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WaxEntry } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWaxEntryDto } from './dto/create-wax-entry.dto';
import { UpdateWaxEntryDto } from './dto/update-wax-entry.dto';

type NextInternalTreeSequence = {
  currentAlphabetIndex: number;
  currentCycle: number;
  currentNumber: number;
  currentPrefix: string;
  internalTreeNumber: string;
};

@Injectable()
export class WaxEntriesService {
  private readonly sequenceId = 'global';
  private readonly maxNumberPerPrefix = 150;
  private readonly maxSequenceRetries = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany() {
    const entries = await this.prisma.waxEntry.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return entries.map((entry) => this.toResponse(entry));
  }

  async create(dto: CreateWaxEntryDto, user: AuthUser, request?: AuthenticatedRequest) {
    const entry = await this.runWithSequenceRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const sequence = await tx.internalTreeSequence.upsert({
            where: { id: this.sequenceId },
            update: {},
            create: { id: this.sequenceId },
          });
          const nextSequence = this.getNextSequence(sequence);

          await tx.internalTreeSequence.update({
            where: { id: this.sequenceId },
            data: {
              currentAlphabetIndex: nextSequence.currentAlphabetIndex,
              currentCycle: nextSequence.currentCycle,
              currentNumber: nextSequence.currentNumber,
              currentPrefix: nextSequence.currentPrefix,
            },
          });

          return tx.waxEntry.create({
            data: {
              ...this.mapCreateDto(dto),
              internalTreeNumber: nextSequence.internalTreeNumber,
              internalTreePrefix: nextSequence.currentPrefix,
              internalTreeSequence: nextSequence.currentNumber,
              internalTreeCycle: nextSequence.currentCycle,
              createdByUserId: user.id,
              createdByUsername: user.username || user.email,
              updatedByUserId: user.id,
              updatedByUsername: user.username || user.email,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );

    const response = this.toResponse(entry);

    await this.auditLogs.create({
      user,
      action: 'Internal Tree Number Generated',
      module: 'Wax Entries',
      internalTreeNumber: response.internalTreeNumber,
      newValue: { internalTreeNumber: response.internalTreeNumber },
      request,
    });
    await this.auditLogs.create({
      user,
      action: 'Wax Entry created',
      module: 'Wax Entries',
      internalTreeNumber: response.internalTreeNumber,
      newValue: response,
      request,
    });

    return response;
  }

  async update(id: string, dto: UpdateWaxEntryDto, user: AuthUser, request?: AuthenticatedRequest) {
    const before = await this.prisma.waxEntry.findFirst({
      where: { id, deletedAt: null },
    });

    if (!before) {
      throw new NotFoundException('Wax Entry not found');
    }

    const updated = await this.prisma.waxEntry.update({
      where: { id },
      data: {
        ...this.mapUpdateDto(dto),
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
    });

    await this.auditLogs.create({
      user,
      action: 'Wax Entry edited',
      module: 'Wax Entries',
      internalTreeNumber: updated.internalTreeNumber,
      oldValue: this.toResponse(before),
      newValue: this.toResponse(updated),
      request,
    });

    return this.toResponse(updated);
  }

  async delete(id: string, user: AuthUser, request?: AuthenticatedRequest) {
    const before = await this.prisma.waxEntry.findFirst({
      where: { id, deletedAt: null },
    });

    if (!before) {
      throw new NotFoundException('Wax Entry not found');
    }

    const deleted = await this.prisma.waxEntry.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedByUserId: user.id,
        updatedByUsername: user.username || user.email,
      },
    });

    await this.auditLogs.create({
      user,
      action: 'Wax Entry deleted',
      module: 'Wax Entries',
      internalTreeNumber: deleted.internalTreeNumber,
      oldValue: this.toResponse(before),
      request,
    });

    return { success: true };
  }

  private getNextSequence(sequence: {
    currentAlphabetIndex: number;
    currentCycle: number;
    currentNumber: number;
  }): NextInternalTreeSequence {
    let currentAlphabetIndex = this.clampAlphabetIndex(sequence.currentAlphabetIndex);
    let currentCycle = Math.max(Number(sequence.currentCycle) || 0, 0);
    let currentNumber = Math.max(Number(sequence.currentNumber) || 0, 0);

    if (currentNumber < this.maxNumberPerPrefix) {
      currentNumber += 1;
    } else if (currentAlphabetIndex < 25) {
      currentAlphabetIndex += 1;
      currentNumber = 1;
    } else {
      currentAlphabetIndex = 0;
      currentCycle += 1;
      currentNumber = 1;
    }

    const currentPrefix = this.formatPrefix(currentAlphabetIndex, currentCycle);

    return {
      currentAlphabetIndex,
      currentCycle,
      currentNumber,
      currentPrefix,
      internalTreeNumber: `${currentPrefix}-${currentNumber}`,
    };
  }

  private formatPrefix(alphabetIndex: number, cycle: number) {
    const letter = String.fromCharCode(65 + this.clampAlphabetIndex(alphabetIndex));
    return cycle === 0 ? letter : `${letter}${cycle}`;
  }

  private clampAlphabetIndex(value: number) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) {
      return 0;
    }

    return Math.min(Math.max(Math.trunc(parsedValue), 0), 25);
  }

  private async runWithSequenceRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxSequenceRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isRetryableSequenceError(error) || attempt === this.maxSequenceRetries) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private isRetryableSequenceError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }

  private mapCreateDto(dto: CreateWaxEntryDto) {
    return {
      vendorCustomerName: this.cleanString(dto.vendorCustomerName),
      date: this.parseDate(dto.date),
      waxInvoiceNo: this.cleanString(dto.waxInvoiceNo),
      customerVendorTreeNo: this.cleanString(dto.customerVendorTreeNo),
      metalKt: this.cleanString(dto.metalKt),
      color: this.cleanString(dto.color),
      waxWeight: this.parseDecimal(dto.waxWeight) ?? undefined,
      isRush: Boolean(dto.isRush),
    };
  }

  private mapUpdateDto(dto: UpdateWaxEntryDto): Prisma.WaxEntryUncheckedUpdateInput {
    return {
      vendorCustomerName:
        dto.vendorCustomerName === undefined ? undefined : this.cleanString(dto.vendorCustomerName),
      date: dto.date === undefined ? undefined : this.parseDate(dto.date),
      waxInvoiceNo: dto.waxInvoiceNo === undefined ? undefined : this.cleanString(dto.waxInvoiceNo),
      customerVendorTreeNo:
        dto.customerVendorTreeNo === undefined ? undefined : this.cleanString(dto.customerVendorTreeNo),
      metalKt: dto.metalKt === undefined ? undefined : this.cleanString(dto.metalKt),
      color: dto.color === undefined ? undefined : this.cleanString(dto.color),
      waxWeight: dto.waxWeight === undefined ? undefined : this.parseDecimal(dto.waxWeight),
      isRush: dto.isRush,
    };
  }

  private cleanString(value?: string) {
    return String(value || '').trim();
  }

  private parseDate(value?: string) {
    const dateValue = this.cleanString(value);
    if (!dateValue) {
      return undefined;
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? new Date(`${dateValue}T00:00:00.000Z`)
      : new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date must be valid.');
    }

    return date;
  }

  private parseDecimal(value?: string): Prisma.Decimal | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    const cleanedValue = this.cleanString(value);
    if (!cleanedValue) {
      return null;
    }

    const numericValue = Number(cleanedValue);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      throw new BadRequestException('Wax Weight must be a valid positive number.');
    }

    return new Prisma.Decimal(cleanedValue);
  }

  private toResponse(entry: WaxEntry) {
    const { alphabet, number } = this.parseInternalTreeNumber(entry.internalTreeNumber);

    return {
      id: entry.id,
      internalTreeNumber: entry.internalTreeNumber,
      alphabet,
      number,
      vendorCustomerName: entry.vendorCustomerName,
      date: entry.date ? entry.date.toISOString().slice(0, 10) : '',
      waxInvoiceNo: entry.waxInvoiceNo,
      customerVendorTreeNo: entry.customerVendorTreeNo,
      metalKt: entry.metalKt,
      color: entry.color,
      waxWeight: entry.waxWeight ? entry.waxWeight.toString() : '',
      isRush: entry.isRush,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      createdByUserId: entry.createdByUserId || '',
      createdByUsername: entry.createdByUsername || '',
    };
  }

  private parseInternalTreeNumber(internalTreeNumber: string) {
    const [alphabet, number] = String(internalTreeNumber || '').split('-');

    return {
      alphabet: alphabet || '',
      number: number || '',
    };
  }
}

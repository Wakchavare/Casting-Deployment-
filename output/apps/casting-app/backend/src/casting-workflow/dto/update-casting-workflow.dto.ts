import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

const VALID_STAGES = [
  'Awaiting Metal',
  'Ready for Casting',
  'Casting Completed',
  'QC Completed',
  'Received at Store',
];

export class UpdateCastingWorkflowDto {
  @IsOptional()
  @IsString()
  @IsIn(VALID_STAGES)
  stage?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  metalIssue?: Record<string, any> | null;

  @IsOptional()
  castingIssue?: Record<string, any> | null;

  @IsOptional()
  castingVerification?: Record<string, any> | null;

  @IsOptional()
  qcVerification?: Record<string, any> | null;

  @IsOptional()
  @IsBoolean()
  finalOrderPosted?: boolean;

  @IsOptional()
  @IsString()
  finalStatus?: string | null;

  @IsOptional()
  @IsBoolean()
  removedFromBoard?: boolean;

  @IsOptional()
  @IsBoolean()
  isDamaged?: boolean;

  @IsOptional()
  damagedTree?: Record<string, any> | null;

  @IsOptional()
  inventoryLedgerIds?: string[] | null;
}

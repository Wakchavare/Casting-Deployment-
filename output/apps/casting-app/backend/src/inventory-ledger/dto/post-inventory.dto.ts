import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class PostInventoryDto {
  @IsString()
  internalTreeNumber: string;

  @IsString()
  @IsIn(['metal_issue', 'casting_return', 'final_post'])
  entryType: string;

  @IsOptional()
  @IsString()
  metalKt?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  metalSource?: string;

  @IsOptional()
  @IsString()
  fineGoldWeight?: string;

  @IsOptional()
  @IsString()
  alloyWeight?: string;

  @IsOptional()
  @IsString()
  recycledWeight?: string;

  @IsOptional()
  @IsString()
  issuedWeight?: string;

  @IsOptional()
  @IsString()
  returnedWeight?: string;

  @IsOptional()
  @IsString()
  finishedWeight?: string;

  @IsOptional()
  @IsString()
  spruWeight?: string;

  @IsOptional()
  @IsString()
  scrapWeight?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  rawPayload?: Record<string, any>;
}

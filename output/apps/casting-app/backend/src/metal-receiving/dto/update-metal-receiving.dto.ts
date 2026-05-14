import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateMetalReceivingDto {
  @IsOptional()
  @IsDateString()
  receivingDate?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  invoiceNo?: string;

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
  grossWeight?: string;

  @IsOptional()
  @IsString()
  netWeight?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

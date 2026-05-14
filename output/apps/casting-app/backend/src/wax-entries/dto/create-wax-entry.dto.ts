import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateWaxEntryDto {
  @IsOptional()
  @IsString()
  vendorCustomerName?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  waxInvoiceNo?: string;

  @IsOptional()
  @IsString()
  customerVendorTreeNo?: string;

  @IsOptional()
  @IsString()
  metalKt?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  waxWeight?: string;

  @IsOptional()
  @IsBoolean()
  isRush?: boolean;
}

import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds: string[];
}

import { IsString, Matches, MinLength } from 'class-validator';

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @Matches(passwordPattern, {
    message:
      'Password must include uppercase, lowercase, number, and special character.',
  })
  newPassword: string;

  @IsString()
  confirmPassword: string;
}

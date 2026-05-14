import { IsString, Matches, MinLength } from 'class-validator';

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @Matches(passwordPattern, {
    message:
      'Password must include uppercase, lowercase, number, and special character.',
  })
  password: string;

  @IsString()
  confirmPassword: string;
}

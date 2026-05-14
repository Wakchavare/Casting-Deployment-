import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { AuthService } from './auth.service';
import { AuthUser } from './types/auth-user';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: AuthenticatedRequest) {
    return this.auth.login(dto, request);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() request: AuthenticatedRequest) {
    return this.auth.refresh(dto, request);
  }

  @Post('logout')
  logout(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: LogoutDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.logout(user, dto, request);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.changePassword(user, dto, request);
  }
}

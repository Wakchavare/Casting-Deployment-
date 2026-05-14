import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.manage')
  findMany() {
    return this.users.findMany();
  }

  @Get(':id')
  @RequirePermissions('users.manage')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermissions('users.manage')
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.create(dto, user, request);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, dto, user, request);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users.manage')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.resetPassword(id, dto, user, request);
  }

  @Post(':id/assign-roles')
  @RequirePermissions('roles.assign')
  assignRoles(
    @Param('id') id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.assignRoles(id, dto, user, request);
  }

  @Post(':id/deactivate')
  @RequirePermissions('users.manage')
  deactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.setActive(id, false, user, request);
  }

  @Post(':id/activate')
  @RequirePermissions('users.manage')
  activate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.setActive(id, true, user, request);
  }
}

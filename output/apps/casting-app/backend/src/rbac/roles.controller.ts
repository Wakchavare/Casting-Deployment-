import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RbacService } from './rbac.service';

@Controller('roles')
@RequirePermissions('roles.manage')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  listRoles() {
    return this.rbac.listRoles();
  }

  @Post()
  createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbac.createRole(dto, user, request);
  }

  @Get(':id')
  getRole(@Param('id') id: string) {
    return this.rbac.getRole(id);
  }

  @Patch(':id')
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbac.updateRole(id, dto, user, request);
  }

  @Put(':id/permissions')
  replaceRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbac.replaceRolePermissions(id, dto, user, request);
  }

  @Delete(':id')
  deleteRole(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbac.deleteRole(id, user, request);
  }
}

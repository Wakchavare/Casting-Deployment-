import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CreateWaxEntryDto } from './dto/create-wax-entry.dto';
import { UpdateWaxEntryDto } from './dto/update-wax-entry.dto';
import { WaxEntriesService } from './wax-entries.service';

@Controller('wax-entries')
export class WaxEntriesController {
  constructor(private readonly waxEntries: WaxEntriesService) {}

  @Get()
  @RequirePermissions('waxEntries.view')
  findMany() {
    return this.waxEntries.findMany();
  }

  @Post()
  @RequirePermissions('waxEntries.create')
  create(
    @Body() dto: CreateWaxEntryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.waxEntries.create(dto, user, request);
  }

  @Patch(':id')
  @RequirePermissions('waxEntries.edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWaxEntryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.waxEntries.update(id, dto, user, request);
  }

  @Delete(':id')
  @RequirePermissions('waxEntries.delete')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.waxEntries.delete(id, user, request);
  }
}

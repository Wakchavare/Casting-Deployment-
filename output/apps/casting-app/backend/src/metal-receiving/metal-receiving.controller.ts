import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CreateMetalReceivingDto } from './dto/create-metal-receiving.dto';
import { UpdateMetalReceivingDto } from './dto/update-metal-receiving.dto';
import { MetalReceivingService } from './metal-receiving.service';

@Controller('metal-receiving')
export class MetalReceivingController {
  constructor(private readonly service: MetalReceivingService) {}

  @Get()
  @RequirePermissions('metalReceiving.view')
  findMany() {
    return this.service.findMany();
  }

  @Post()
  @RequirePermissions('metalReceiving.create')
  create(
    @Body() dto: CreateMetalReceivingDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(dto, user, request);
  }

  @Patch(':id')
  @RequirePermissions('metalReceiving.edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMetalReceivingDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(id, dto, user, request);
  }

  @Delete(':id')
  @RequirePermissions('metalReceiving.delete')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.delete(id, user, request);
  }
}

import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PostInventoryDto } from './dto/post-inventory.dto';
import { InventoryLedgerService } from './inventory-ledger.service';

@Controller('inventory-ledger')
export class InventoryLedgerController {
  constructor(private readonly service: InventoryLedgerService) {}

  @Get()
  @RequirePermissions('inventoryLedger.view')
  findAll() {
    return this.service.findAll();
  }

  @Get('by-tree/:internalTreeNumber')
  @RequirePermissions('inventoryLedger.view')
  findByTree(@Param('internalTreeNumber') internalTreeNumber: string) {
    return this.service.findByTree(internalTreeNumber);
  }

  @Post()
  @RequirePermissions('inventory.postFinal')
  post(
    @Body() dto: PostInventoryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.post(dto, user, request);
  }

  @Post('batch')
  @RequirePermissions('inventory.postFinal')
  postBatch(
    @Body() dto: PostInventoryDto[],
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.postBatch(dto, user, request);
  }
}

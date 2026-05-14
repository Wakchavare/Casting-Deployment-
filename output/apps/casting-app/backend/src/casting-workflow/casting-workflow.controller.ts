import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CastingWorkflowService } from './casting-workflow.service';
import { UpdateCastingWorkflowDto } from './dto/update-casting-workflow.dto';

@Controller('casting-workflow')
export class CastingWorkflowController {
  constructor(private readonly service: CastingWorkflowService) {}

  @Get()
  @RequirePermissions('castingProcess.view')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('castingProcess.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put('by-wax-entry/:waxEntryId')
  @RequirePermissions('castingProcess.edit')
  upsert(
    @Param('waxEntryId') waxEntryId: string,
    @Body() dto: UpdateCastingWorkflowDto,
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.upsertForWaxEntry(waxEntryId, dto, user, request);
  }
}

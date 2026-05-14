import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { RbacService } from './rbac.service';

@Controller('permissions')
@RequirePermissions('roles.manage')
export class PermissionsController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  listPermissions() {
    return this.rbac.listPermissions();
  }
}

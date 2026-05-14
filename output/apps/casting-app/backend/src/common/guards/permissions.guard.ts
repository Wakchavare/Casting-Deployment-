import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthUser } from '../../auth/types/auth-user';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      route?: { path?: string };
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const userPermissions = new Set(request.user?.permissions ?? []);
    const missingPermissions = requiredPermissions.filter((permission) => !userPermissions.has(permission));

    if (!request.user || missingPermissions.length) {
      await this.auditLogs
        .create({
          user: request.user,
          action: 'Unauthorized access attempt',
          module: 'Authorization',
          newValue: { requiredPermissions, missingPermissions },
          notes: request.route?.path,
          request,
        })
        .catch(() => undefined);

      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}

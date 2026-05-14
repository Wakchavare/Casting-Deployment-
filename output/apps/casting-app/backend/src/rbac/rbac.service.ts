import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleWithPermissionsInclude = Prisma.validator<Prisma.RoleInclude>()({
  rolePermissions: {
    include: {
      permission: true,
    },
  },
});

type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: typeof roleWithPermissionsInclude;
}>;

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: roleWithPermissionsInclude,
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
    });

    return roles.map((role) => this.toRoleResponse(role));
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: roleWithPermissionsInclude,
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.toRoleResponse(role);
  }

  async createRole(dto: CreateRoleDto, actor: AuthUser, request?: AuthenticatedRequest) {
    await this.assertRoleNameIsUnique(dto.name);
    const permissions = await this.findPermissionsByKeys(dto.permissionKeys ?? []);
    const rolePermissions = permissions.map((permission) => ({
      permissionId: permission.id,
    }));

    const role = await this.prisma.role.create({
      data: {
        key: await this.createUniqueRoleKey(dto.name),
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        system: false,
        rolePermissions: rolePermissions.length ? { create: rolePermissions } : undefined,
      },
      include: roleWithPermissionsInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'Role created',
      module: 'Role Management',
      newValue: this.toRoleResponse(role),
      request,
    });

    return this.toRoleResponse(role);
  }

  async updateRole(
    id: string,
    dto: UpdateRoleDto,
    actor: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const before = await this.prisma.role.findUnique({
      where: { id },
      include: roleWithPermissionsInclude,
    });

    if (!before) {
      throw new NotFoundException('Role not found');
    }

    if (dto.name && dto.name !== before.name) {
      await this.assertRoleNameIsUnique(dto.name, id);
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
      },
      include: roleWithPermissionsInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'Role edited',
      module: 'Role Management',
      oldValue: this.toRoleResponse(before),
      newValue: this.toRoleResponse(updated),
      request,
    });

    return this.toRoleResponse(updated);
  }

  async replaceRolePermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
    actor: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const before = await this.prisma.role.findUnique({
      where: { id },
      include: roleWithPermissionsInclude,
    });

    if (!before) {
      throw new NotFoundException('Role not found');
    }

    const permissions = await this.findPermissionsByKeys(dto.permissionKeys);

    if (!permissions.length) {
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
    } else {
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        this.prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: id,
            permissionId: permission.id,
          })),
          skipDuplicates: true,
        }),
      ]);
    }

    const updated = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: roleWithPermissionsInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'Role permissions edited',
      module: 'Role Management',
      oldValue: this.toRoleResponse(before),
      newValue: this.toRoleResponse(updated),
      request,
    });

    return this.toRoleResponse(updated);
  }

  async deleteRole(id: string, actor: AuthUser, request?: AuthenticatedRequest) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: roleWithPermissionsInclude,
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.system) {
      throw new BadRequestException('System roles cannot be deleted.');
    }

    await this.prisma.role.delete({ where: { id } });

    await this.auditLogs.create({
      user: actor,
      action: 'Role deleted',
      module: 'Role Management',
      oldValue: this.toRoleResponse(role),
      request,
    });

    return { success: true };
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
  }

  async userHasPermission(userId: string, permissionKey: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user?.isActive) {
      return false;
    }

    return user.userRoles.some(
      (userRole) =>
        userRole.role.isActive &&
        userRole.role.rolePermissions.some(
          (rolePermission) => rolePermission.permission.key === permissionKey,
        ),
    );
  }

  private async findPermissionsByKeys(permissionKeys: string[]) {
    if (!permissionKeys.length) {
      return [];
    }

    const uniqueKeys = [...new Set(permissionKeys)];
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: uniqueKeys } },
    });

    if (permissions.length !== uniqueKeys.length) {
      throw new BadRequestException('One or more permissions are invalid.');
    }

    return permissions;
  }

  private async assertRoleNameIsUnique(name: string, ignoredRoleId?: string) {
    const existingRole = await this.prisma.role.findFirst({
      where: {
        name,
        id: ignoredRoleId ? { not: ignoredRoleId } : undefined,
      },
      select: { id: true },
    });

    if (existingRole) {
      throw new BadRequestException('Role name is already in use.');
    }
  }

  private async createUniqueRoleKey(name: string) {
    const sanitizedName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const baseKey = `role_${sanitizedName || 'custom'}`;

    let key = baseKey;
    let suffix = 2;

    while (await this.prisma.role.findUnique({ where: { key }, select: { id: true } })) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    return key;
  }

  private toRoleResponse(role: RoleWithPermissions) {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isActive: role.isActive,
      system: role.system,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: role.rolePermissions.map((rolePermission) => rolePermission.permission),
      permissionKeys: role.rolePermissions.map((rolePermission) => rolePermission.permission.key),
    };
  }
}

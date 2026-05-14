import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../auth/types/auth-user';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const userWithRolesInclude = Prisma.validator<Prisma.UserInclude>()({
  userRoles: {
    include: {
      role: true,
    },
  },
});

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRolesInclude }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany() {
    const users = await this.prisma.user.findMany({
      include: userWithRolesInclude,
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.toResponse(user));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toResponse(user);
  }

  async create(dto: CreateUserDto, actor: AuthUser, request?: AuthenticatedRequest) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Confirm password must match.');
    }

    const username = dto.username ?? dto.email;
    await this.assertUserIsUnique(dto.email, username);
    await this.assertRolesExist(dto.assignedRoleIds ?? []);
    const assignedRoles = (dto.assignedRoleIds ?? []).map((roleId) => ({ roleId }));

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        username,
        passwordHash: await bcrypt.hash(dto.password, 12),
        isActive: dto.isActive ?? true,
        userRoles: assignedRoles.length ? { create: assignedRoles } : undefined,
      },
      include: userWithRolesInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'User created',
      module: 'User Management',
      newValue: this.redactUser(user),
      request,
    });

    return this.toResponse(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, request?: AuthenticatedRequest) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });

    if (!before) {
      throw new NotFoundException('User not found');
    }

    const nextEmail = dto.email ?? before.email;
    const nextUsername = dto.username ?? before.username;
    await this.assertUserIsUnique(nextEmail, nextUsername, id);

    if (dto.assignedRoleIds) {
      await this.assertRolesExist(dto.assignedRoleIds);
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        username: dto.username,
        isActive: dto.isActive,
      },
    });

    if (dto.assignedRoleIds) {
      await this.syncUserRoles(id, dto.assignedRoleIds);
    }

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: userWithRolesInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'User edited',
      module: 'User Management',
      oldValue: this.redactUser(before),
      newValue: this.redactUser(updated),
      request,
    });

    return this.toResponse(updated);
  }

  async assignRoles(
    id: string,
    dto: AssignRolesDto,
    actor: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });

    if (!before) {
      throw new NotFoundException('User not found');
    }

    await this.assertRolesExist(dto.roleIds);
    await this.syncUserRoles(id, dto.roleIds);

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: userWithRolesInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: 'Roles assigned to user',
      module: 'User Management',
      oldValue: this.redactUser(before),
      newValue: this.redactUser(updated),
      request,
    });

    return this.toResponse(updated);
  }

  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actor: AuthUser,
    request?: AuthenticatedRequest,
  ) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Confirm password must match.');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash: await bcrypt.hash(dto.password, 12) },
      }),
      this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLogs.create({
      user: actor,
      action: 'Password reset',
      module: 'User Management',
      newValue: { userId: id, username: user.username },
      request,
    });

    return { success: true };
  }

  async deactivate(id: string, actor: AuthUser, request?: AuthenticatedRequest) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });

    if (!before) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      include: userWithRolesInclude,
    });

    await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.auditLogs.create({
      user: actor,
      action: 'User deactivated',
      module: 'User Management',
      oldValue: this.redactUser(before),
      newValue: this.redactUser(updated),
      request,
    });

    return this.toResponse(updated);
  }

  private async syncUserRoles(userId: string, roleIds: string[]) {
    if (!roleIds.length) {
      await this.prisma.userRole.deleteMany({ where: { userId } });
      return;
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId })),
        skipDuplicates: true,
      }),
    ]);
  }

  async setActive(id: string, isActive: boolean, actor: AuthUser, request?: AuthenticatedRequest) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userWithRolesInclude });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      include: userWithRolesInclude,
    });

    await this.auditLogs.create({
      user: actor,
      action: isActive ? 'User activated' : 'User deactivated',
      module: 'Users',
      newValue: { userId: id, isActive },
      request,
    });

    return this.toResponse(updated);
  }

    private async assertRolesExist(roleIds: string[]) {
    if (!roleIds.length) {
      return;
    }

    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });

    if (roles.length !== new Set(roleIds).size) {
      throw new BadRequestException('One or more roles are invalid.');
    }
  }

  private async assertUserIsUnique(email: string, username: string, ignoredUserId?: string) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        id: ignoredUserId ? { not: ignoredUserId } : undefined,
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('Email or username is already in use.');
    }
  }

  private toResponse(user: UserWithRoles) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      assignedRoles: user.userRoles.map((userRole) => userRole.role),
    };
  }

  private redactUser(user: UserWithRoles) {
    return this.toResponse(user);
  }
}

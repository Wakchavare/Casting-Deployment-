import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthUser } from './types/auth-user';

const userWithRolesInclude = Prisma.validator<Prisma.UserInclude>()({
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
});

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRolesInclude }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async login(dto: LoginDto, request?: AuthenticatedRequest) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.username }, { username: dto.username }],
      },
      include: userWithRolesInclude,
    });

    if (!user) {
      await this.auditLogs.create({
        action: 'Failed login attempt',
        module: 'Authentication',
        newValue: { username: dto.username },
        notes: 'Invalid username or password',
        request,
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      await this.auditLogs.create({
        user,
        action: 'Failed login attempt',
        module: 'Authentication',
        notes: 'Invalid username or password',
        request,
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    if (!user.isActive) {
      await this.auditLogs.create({
        user,
        action: 'Failed login attempt',
        module: 'Authentication',
        notes: 'Inactive user attempted login',
        request,
      });
      throw new ForbiddenException('Your account is inactive. Please contact Admin.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user, undefined, request);

    await this.auditLogs.create({
      user,
      action: 'User logged in',
      module: 'Authentication',
      request,
    });

    return {
      user: this.toAuthUser(user, tokens.sessionId),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  async refresh(dto: RefreshTokenDto, request?: AuthenticatedRequest) {
    const { tokenId, secret } = this.parseRefreshToken(dto.refreshToken);
    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
      include: {
        session: {
          include: {
            user: {
              include: userWithRolesInclude,
            },
          },
        },
      },
    });

    if (!refreshToken || refreshToken.revokedAt || refreshToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (
      refreshToken.session.revokedAt ||
      refreshToken.session.expiresAt <= new Date() ||
      !refreshToken.session.user.isActive
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const tokenMatches = await bcrypt.compare(secret, refreshToken.tokenHash);

    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(
      refreshToken.session.user,
      refreshToken.sessionId,
      request,
    );

    return {
      user: this.toAuthUser(refreshToken.session.user, tokens.sessionId),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  async logout(user: AuthUser | undefined, dto: LogoutDto, request?: AuthenticatedRequest) {
    const sessionId = dto.refreshToken
      ? await this.getSessionIdFromRefreshToken(dto.refreshToken)
      : user?.sessionId;

    if (sessionId) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.session.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    }

    await this.auditLogs.create({
      user,
      action: 'User logged out',
      module: 'Authentication',
      request,
    });

    return { success: true };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto, request?: AuthenticatedRequest) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Confirm password must match.');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });

    if (!dbUser) {
      throw new UnauthorizedException('Invalid user');
    }

    const passwordMatches = await bcrypt.compare(dto.currentPassword, dbUser.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid current password');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
      }),
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLogs.create({
      user,
      action: 'Password changed',
      module: 'Authentication',
      request,
    });

    return { success: true };
  }

  private async issueTokens(
    user: UserWithRoles,
    sessionId?: string,
    request?: AuthenticatedRequest,
  ) {
    const refreshTokenDays = Number(this.config.get<string>('REFRESH_TOKEN_DAYS') ?? 7);
    const refreshExpiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const session = await this.prisma.session.create({
        data: {
          userId: user.id,
          expiresAt: refreshExpiresAt,
          ipAddress: request?.ip,
          userAgent: this.getUserAgent(request),
        },
      });
      activeSessionId = session.id;
    }

    const refreshTokenId = randomUUID();
    const refreshSecret = randomBytes(48).toString('base64url');
    const refreshToken = `${refreshTokenId}.${refreshSecret}`;

    await this.prisma.refreshToken.create({
      data: {
        id: refreshTokenId,
        sessionId: activeSessionId,
        tokenHash: await bcrypt.hash(refreshSecret, 12),
        expiresAt: refreshExpiresAt,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        sessionId: activeSessionId,
      },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '15m',
      },
    );

    return {
      accessToken,
      refreshToken,
      sessionId: activeSessionId,
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '15m',
    };
  }

  private async getSessionIdFromRefreshToken(refreshToken: string) {
    const { tokenId } = this.parseRefreshToken(refreshToken);
    const dbToken = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
      select: { sessionId: true },
    });

    return dbToken?.sessionId;
  }

  private parseRefreshToken(refreshToken: string) {
    const [tokenId, secret] = refreshToken.split('.');

    if (!tokenId || !secret) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return { tokenId, secret };
  }

  private toAuthUser(user: UserWithRoles, sessionId?: string): AuthUser {
    const activeRoles = user.userRoles
      .map((userRole) => userRole.role)
      .filter((role) => role.isActive);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      sessionId,
      roles: activeRoles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
      })),
      roleIds: activeRoles.map((role) => role.id),
      permissions: Array.from(
        new Set(
          activeRoles.flatMap((role) =>
            role.rolePermissions.map((rolePermission) => rolePermission.permission.key),
          ),
        ),
      ),
    };
  }

  private getUserAgent(request?: AuthenticatedRequest) {
    const userAgent = request?.headers?.['user-agent'];
    return Array.isArray(userAgent) ? userAgent.join(' ') : userAgent;
  }
}

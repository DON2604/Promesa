import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role, TenantKind } from '@promesa/contracts';
import { AppError } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { type AuthedRequest, IS_PUBLIC, REQUIRED_ROLES } from './principal';
import { SESSION_COOKIE, verifySessionToken } from './session';

/**
 * Global guard: every route is authenticated unless marked @Public(). The session's
 * (tenant, role) claim is re-checked against live memberships on each request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      // Public routes may still personalise for a signed-in viewer (e.g. marketplace match scores).
      await this.authenticate(request).catch(() => undefined);
      return true;
    }
    await this.authenticate(request);

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required && !required.includes(request.principal!.role)) {
      throw AppError.forbidden(
        `This action requires one of: ${required.join(', ')}. Switch role explicitly if you hold it.`,
      );
    }
    return true;
  }

  private async authenticate(request: AuthedRequest): Promise<void> {
    const claims = verifySessionToken(
      request.cookies?.[SESSION_COOKIE],
      this.env.AUTH_SESSION_SECRET,
    );
    if (!claims) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { memberships: { include: { tenant: true } } },
    });
    if (!user || user.disabledAt)
      throw new AppError('UNAUTHENTICATED', 'Session is no longer valid.', 401);
    const active = user.memberships.find(
      (m) => m.tenantId === claims.tid && m.role === claims.role,
    );
    if (!active)
      throw new AppError(
        'UNAUTHENTICATED',
        'Your role in this workspace has changed. Sign in again.',
        401,
      );

    request.principal = {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      tenantId: active.tenantId,
      tenantName: active.tenant.name,
      tenantKind: active.tenant.kind as TenantKind,
      tenantTimezone: active.tenant.timezone,
      role: active.role as Role,
      memberships: user.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantKind: m.tenant.kind as TenantKind,
        role: m.role as Role,
      })),
    };
  }
}

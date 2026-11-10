import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type Me, type Persona, RoleSchema } from '@promesa/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodPipe } from '../../common/zod';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PERSONAS } from '../demo/fixtures';
import { CorrelationId, CurrentPrincipal, type Principal, Public } from './principal';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, issueSessionToken } from './session';

const SessionRequestSchema = z.object({ personaKey: z.string().min(1).max(40) });
const RoleSwitchSchema = z.object({ tenantId: z.string().uuid(), role: RoleSchema });

/**
 * Demo identity provider (Phase 1). It is refused at startup in production; OIDC replaces it in Phase 6.
 * Personas are fictional and pre-provisioned; there are no passwords to store.
 */
@ApiTags('auth')
@Controller('v1')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setCookie(reply: FastifyReply, token: string) {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  @Public()
  @Get('auth/personas')
  personas(): { identityProvider: 'DEMO'; enabled: boolean; personas: Persona[] } {
    return {
      identityProvider: 'DEMO',
      enabled: this.env.DEMO_AUTH_ENABLED,
      personas: this.env.DEMO_AUTH_ENABLED
        ? PERSONAS.map(({ key, displayName, title, tenantName, tenantKind, roles, summary }) => ({
            key,
            displayName,
            title,
            tenantName,
            tenantKind,
            roles,
            summary,
          }))
        : [],
    };
  }

  @Public()
  @Post('auth/session')
  @HttpCode(200)
  async createSession(
    @Body(new ZodPipe(SessionRequestSchema)) body: z.infer<typeof SessionRequestSchema>,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.env.DEMO_AUTH_ENABLED) throw AppError.forbidden('Demo sign-in is disabled.');
    const persona = PERSONAS.find((p) => p.key === body.personaKey);
    if (!persona) throw new AppError('UNKNOWN_PERSONA', 'That demo persona does not exist.', 422);
    const membership = await this.prisma.membership.findFirst({
      where: { userId: persona.userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership)
      throw new AppError('NOT_PROVISIONED', 'Run the demo seed first (npm run demo:seed).', 409);
    this.setCookie(
      reply,
      issueSessionToken(
        { sub: persona.userId, tid: membership.tenantId, role: membership.role },
        this.env.AUTH_SESSION_SECRET,
      ),
    );
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        tenantId: membership.tenantId,
        actorType: 'USER',
        actorId: persona.userId,
        action: 'auth.session.create',
        resourceType: 'session',
        resourceId: persona.userId,
        policyDecision: 'DEMO_IDP',
        correlationId,
      }),
    );
    return { ok: true };
  }

  @Delete('auth/session')
  @HttpCode(200)
  signOut(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Post('auth/role')
  @HttpCode(200)
  async switchRole(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodPipe(RoleSwitchSchema)) body: z.infer<typeof RoleSwitchSchema>,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const allowed = principal.memberships.some(
      (m) => m.tenantId === body.tenantId && m.role === body.role,
    );
    if (!allowed) throw AppError.forbidden('You do not hold that role in that workspace.');
    this.setCookie(
      reply,
      issueSessionToken(
        { sub: principal.userId, tid: body.tenantId, role: body.role },
        this.env.AUTH_SESSION_SECRET,
      ),
    );
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        tenantId: body.tenantId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'auth.role.switch',
        resourceType: 'session',
        resourceId: principal.userId,
        before: { tenantId: principal.tenantId, role: principal.role },
        after: body,
        correlationId,
      }),
    );
    return { ok: true };
  }

  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Me {
    return {
      user: { id: principal.userId, displayName: principal.displayName, email: principal.email },
      activeTenant: {
        id: principal.tenantId,
        name: principal.tenantName,
        kind: principal.tenantKind,
        timezone: principal.tenantTimezone,
      },
      activeRole: principal.role,
      memberships: principal.memberships,
      identityProvider: 'DEMO',
    };
  }
}

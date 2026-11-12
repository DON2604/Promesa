import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, TenantKind } from '@promesa/contracts';
import type { FastifyRequest } from 'fastify';

export type Principal = {
  userId: string;
  displayName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  tenantKind: TenantKind;
  tenantTimezone: string;
  role: Role;
  memberships: Array<{ tenantId: string; tenantName: string; tenantKind: TenantKind; role: Role }>;
  identityProvider: 'DEMO' | 'PASSWORD';
};

export type AuthedRequest = FastifyRequest & { principal?: Principal };

export const IS_PUBLIC = 'promesa:isPublic';
export const REQUIRED_ROLES = 'promesa:requiredRoles';

/** Route needs no session (health, persona list, sign-in, PayPal webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Active role must be one of these. Tenant ownership is still checked in each service query. */
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.principal) throw new Error('Principal missing on an authenticated route');
    return request.principal;
  },
);

/** On @Public() routes: the signed-in viewer if there is a valid session, otherwise null. */
export const OptionalPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal | null =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal ?? null,
);

export const CorrelationId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return String(ctx.switchToHttp().getRequest<FastifyRequest>().id);
});

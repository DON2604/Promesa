import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role } from '@promesa/contracts';

export const SESSION_COOKIE = 'promesa_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionClaims = { v: 1; sub: string; tid: string; role: Role; exp: number };

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function issueSessionToken(
  claims: Omit<SessionClaims, 'v' | 'exp'>,
  secret: string,
  now = Date.now(),
): string {
  const full: SessionClaims = {
    v: 1,
    ...claims,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionClaims | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    if (claims.v !== 1 || typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

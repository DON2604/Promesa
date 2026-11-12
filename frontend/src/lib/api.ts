import type { ApiErrorBody } from '@promesa/contracts';

/**
 * Absolute API origin, or '' when the browser should call this same site (the Next server
 * proxies /v1). An empty or `same-origin` value is how the Render deploy stays first-party.
 */
const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
export const API_BASE_URL =
  configured === undefined
    ? 'http://localhost:4000'
    : configured === '' || configured === 'same-origin'
      ? ''
      : configured.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string | null,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal };

/**
 * Typed fetch wrapper. Session is an HTTP-only cookie (credentials: 'include'); unsafe methods carry
 * the CSRF header the API requires. No secrets ever pass through the browser.
 */
export async function api<T>(
  path: string,
  { method = 'GET', body, signal }: Options = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Promesa-Csrf'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_UNREACHABLE', 'The Promesa API could not be reached.', null);
  }

  const text = await res.text();
  const data: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const e = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      e?.code ?? `HTTP_${res.status}`,
      e?.message ?? res.statusText ?? 'Request failed',
      e?.correlationId ?? res.headers.get('x-correlation-id'),
      e?.details,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: { code: 'INVALID_RESPONSE', message: 'The API returned a non-JSON response.' },
    };
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/**
 * Forwards a browser request to the API. Used when the site and the API are separate Render
 * services: the browser only talks to this origin, so the session cookie stays first-party.
 * `*.onrender.com` is a public suffix, so a cookie set by the API host would not be sent back.
 */

const HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'host',
  'content-length',
  'content-encoding',
]);

function apiOrigin(): string | null {
  // Dynamic lookup so Next does not inline the value at build time.
  const raw = process.env['API_PROXY_URL'];
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

export async function proxyRequest(request: Request, pathname: string): Promise<Response> {
  const api = apiOrigin();
  if (!api) {
    return Response.json(
      { error: { code: 'PROXY_NOT_CONFIGURED', message: 'API_PROXY_URL is not set.' } },
      { status: 502 },
    );
  }

  const incoming = new URL(request.url);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${api}${pathname}${incoming.search}`, init);
  } catch {
    return Response.json(
      { error: { code: 'NETWORK_UNREACHABLE', message: 'The Promesa API could not be reached.' } },
      { status: 502 },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP.has(key.toLowerCase()) || key.toLowerCase() === 'set-cookie') return;
    out.set(key, value);
  });
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) out.append('set-cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

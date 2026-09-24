/**
 * Wspólny proxy Pages → Worker. Plik z _ nie jest trasą HTTP.
 */

/**
 * @param {{ request: Request, env: Record<string, string> }} context
 * @param {'/api/transport' | '/api/formatka'} workerPath
 */
export async function proxyToWorker(context, workerPath) {
  const { request, env } = context;
  const base = String(env.GAS_PROXY_BASE || '').trim().replace(/\/+$/, '');
  const password = String(env.CFP_PASSWORD || '').trim();

  if (!base) {
    return json({ ok: false, error: 'GAS_PROXY_BASE not set on Pages' }, 500);
  }
  if (!password) {
    return json({ ok: false, error: 'CFP_PASSWORD not set on Pages' }, 500);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const incoming = new URL(request.url);
  const target = base + workerPath + incoming.search;

  const headers = {
    'X-Site-Password': password,
  };

  /** @type {RequestInit} */
  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
    headers['Content-Type'] =
      request.headers.get('Content-Type') || 'text/plain;charset=utf-8';
  }

  let res;
  try {
    res = await fetch(target, init);
  } catch (err) {
    return json({ ok: false, error: 'proxy_upstream', message: String(err) }, 502);
  }

  if (res.status === 401) {
    return json(
      {
        ok: false,
        error: 'proxy_auth_mismatch',
        message: 'CFP_PASSWORD na Pages ≠ SITE_PASSWORD na Workerze',
      },
      503,
    );
  }

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

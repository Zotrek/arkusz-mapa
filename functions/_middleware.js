/**
 * Cloudflare Pages Function — wspólne hasło zespołu + cookie (ta przeglądarka).
 *
 * Skopiuj katalog functions/ do każdego projektu Pages.
 *
 * Sekrety w CF Pages → Settings → Environment variables (Production):
 *   CFP_PASSWORD     = to samo co SITE_PASSWORD na Workerze
 *   GAS_PROXY_BASE   = https://…workers.dev  (bez ścieżki /api/…)
 *
 * Opcjonalnie:
 *   CFP_COOKIE_NAME (domyślnie zwrotka_auth)
 *   CFP_COOKIE_DAYS (domyślnie 30)
 *
 * Front woła same-origin /api/transport|formatka — cookie Pages wystarczy.
 * Hasła NIE trzymamy w localStorage (XSS / TTL / storage zablokowany).
 */

const DEFAULT_COOKIE = 'zwrotka_auth';
const DEFAULT_DAYS = 30;
const LEGACY_PASS_KEY = 'zwrotka_site_password';

export async function onRequest(context) {
  const { request, env, next } = context;
  const password = String(env.CFP_PASSWORD || '').trim();
  if (!password) {
    return new Response('Brak CFP_PASSWORD w ustawieniach Pages.', { status: 500 });
  }

  const cookieName = env.CFP_COOKIE_NAME || DEFAULT_COOKIE;
  const days = Number(env.CFP_COOKIE_DAYS || DEFAULT_DAYS);
  const url = new URL(request.url);
  const token = await authToken(password);
  const cookies = parseCookie(request.headers.get('Cookie') || '');
  const isApi = url.pathname === '/api/transport' || url.pathname === '/api/formatka'
    || url.pathname.startsWith('/api/transport/') || url.pathname.startsWith('/api/formatka/');

  if (url.pathname === '/logout') {
    return new Response(logoutHtml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': clearCookie(cookieName),
      },
    });
  }

  if (request.method === 'POST' && url.pathname === '/__login') {
    const form = await request.formData();
    const submitted = String(form.get('password') || '').trim();
    if (submitted !== password) {
      return loginHtml(true, url.searchParams.get('next') || '/');
    }
    const nextPath = sanitizeNext(url.searchParams.get('next'));
    return new Response(postLoginHtml(nextPath), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': setCookie(cookieName, token, days),
      },
    });
  }

  if (cookies[cookieName] === token) {
    return next();
  }

  if (isApi) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  return loginHtml(false, url.pathname + url.search);
}

function sanitizeNext(next) {
  const raw = String(next || '/');
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw.replace(/"/g, '');
}

function postLoginHtml(next) {
  const safeKey = JSON.stringify(LEGACY_PASS_KEY);
  return `<!DOCTYPE html>
<html lang="pl"><meta charset="utf-8"><title>OK</title>
<body>
<p>Zalogowano…</p>
<script>
(function () {
  var key = ${safeKey};
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch (e) {}
  location.replace(${JSON.stringify(next)});
})();
</script>
</body></html>`;
}

function logoutHtml() {
  const safeKey = JSON.stringify(LEGACY_PASS_KEY);
  return `<!DOCTYPE html>
<html lang="pl"><meta charset="utf-8"><title>Wylogowano</title>
<body>
<p>Wylogowano…</p>
<script>
(function () {
  var key = ${safeKey};
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch (e) {}
  location.replace('/');
})();
</script>
</body></html>`;
}

function loginHtml(bad, nextPath) {
  const next = sanitizeNext(nextPath);
  const action = next === '/' ? '/__login' : `/__login?next=${encodeURIComponent(next)}`;
  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hasło</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 22rem; margin: 4rem auto; padding: 0 1rem; }
    label { display: block; margin-bottom: 0.35rem; }
    input { width: 100%; padding: 0.5rem; box-sizing: border-box; }
    button { margin-top: 0.75rem; padding: 0.5rem 1rem; }
    .err { color: #b91c1c; }
  </style>
</head>
<body>
  <h1>Hasło zespołu</h1>
  ${bad ? '<p class="err">Złe hasło.</p>' : ''}
  <form method="post" action="${action}">
    <label for="password">Hasło</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Wejdź</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: bad ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function authToken(password) {
  const data = new TextEncoder().encode(`zwrotka|${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookie(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function setCookie(name, value, days) {
  const maxAge = Math.max(1, Math.floor(days * 86400));
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

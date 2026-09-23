/**
 * Cloudflare Pages Function — wspólne hasło zespołu + cookie (ta przeglądarka).
 *
 * Skopiuj ten plik do każdego projektu Pages jako:
 *   functions/_middleware.js
 *
 * Sekret w CF Pages → Settings → Environment variables:
 *   CFP_PASSWORD = (to samo co SITE_PASSWORD na Workerze)
 *
 * Opcjonalnie:
 *   CFP_COOKIE_NAME (domyślnie zwrotka_auth)
 *   CFP_COOKIE_DAYS (domyślnie 30)
 *
 * Po zalogowaniu zapisuje też sessionStorage.zwrotka_site_password —
 * front może wysłać X-Site-Password do Workera (cookie Pages ≠ cookie workers.dev).
 */

const DEFAULT_COOKIE = 'zwrotka_auth';
const DEFAULT_DAYS = 30;

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

  if (url.pathname === '/logout') {
    return new Response('Wylogowano.', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Set-Cookie': clearCookie(cookieName),
      },
    });
  }

  if (request.method === 'POST' && url.pathname === '/__login') {
    const form = await request.formData();
    const submitted = String(form.get('password') || '').trim();
    if (submitted !== password) {
      return loginHtml(true);
    }
    return new Response(postLoginHtml(password, url.searchParams.get('next') || '/'), {
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

  return loginHtml(false);
}

function postLoginHtml(password, next) {
  const safeNext = String(next || '/').replace(/"/g, '');
  const safePass = JSON.stringify(password);
  return `<!DOCTYPE html>
<html lang="pl"><meta charset="utf-8"><title>OK</title>
<body>
<p>Zalogowano…</p>
<script>
sessionStorage.setItem('zwrotka_site_password', ${safePass});
location.replace(${JSON.stringify(safeNext)});
</script>
</body></html>`;
}

function loginHtml(bad) {
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
  <form method="post" action="/__login">
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

/**
 * Fetch wrapper:
 * - same-origin /api/* → cookie Pages (credentials), bez hasła w storage
 * - legacy workers.dev → opcjonalny X-Site-Password z localStorage (TTL), bez pętli przy mismatch
 * - 401 → duży popup, potem /logout
 */
export const SITE_PASSWORD_FETCH_SNIPPET = `(function () {
  var KEY = 'zwrotka_site_password';
  var reauthPending = false;
  var mismatchAlerted = false;

  function isProxyUrl(url) {
    return url.indexOf('/api/transport') !== -1 ||
      url.indexOf('/api/formatka') !== -1 ||
      url.indexOf('workers.dev') !== -1;
  }

  function isWorkersDev(url) {
    return url.indexOf('workers.dev') !== -1;
  }

  function readLegacyPass() {
    try {
      var raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
      if (!raw) return '';
      if (raw.charAt(0) === '{') {
        var obj = JSON.parse(raw);
        if (!obj || !obj.p) return '';
        if (obj.exp && Date.now() > Number(obj.exp)) {
          clearLegacyPass();
          return '';
        }
        return String(obj.p);
      }
      return raw;
    } catch (e) {
      return '';
    }
  }

  function clearLegacyPass() {
    try {
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function showUnauthorizedPopup(onConfirm) {
    if (document.getElementById('zwrotka-auth-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'zwrotka-auth-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'zwrotka-auth-title');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(15,23,42,0.72);padding:1.25rem;box-sizing:border-box;font-family:system-ui,sans-serif;';
    var box = document.createElement('div');
    box.style.cssText =
      'max-width:28rem;width:100%;background:#fff;color:#0f172a;border-radius:12px;' +
      'padding:1.75rem 1.5rem;box-shadow:0 25px 50px rgba(0,0,0,0.35);text-align:center;';
    var title = document.createElement('h2');
    title.id = 'zwrotka-auth-title';
    title.textContent = 'Brak uprawnień (401)';
    title.style.cssText = 'margin:0 0 0.75rem;font-size:1.5rem;font-weight:700;line-height:1.25;';
    var msg = document.createElement('p');
    msg.textContent =
      'Sesja wygasła lub hasło jest nieaktualne. Zaloguj się ponownie, aby kontynuować.';
    msg.style.cssText = 'margin:0 0 1.5rem;font-size:1.05rem;line-height:1.45;color:#334155;';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Zaloguj ponownie';
    btn.style.cssText =
      'display:inline-block;padding:0.75rem 1.5rem;font-size:1.05rem;font-weight:600;' +
      'border:0;border-radius:8px;background:#0f172a;color:#fff;cursor:pointer;';
    btn.addEventListener('click', function () {
      onConfirm();
    });
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    try {
      btn.focus();
    } catch (e) {}
  }

  function forceReauth() {
    if (reauthPending) return;
    reauthPending = true;
    clearLegacyPass();
    showUnauthorizedPopup(function () {
      location.assign('/logout');
    });
  }

  function maybeMismatchAlert(res) {
    if (mismatchAlerted || res.status !== 503) return;
    mismatchAlerted = true;
    res.clone().json().then(function (body) {
      if (body && body.error === 'proxy_auth_mismatch') {
        alert('Błąd konfiguracji serwera: hasło Pages i Worker się różnią. Skontaktuj się z administratorem.');
      }
    }).catch(function () {});
  }

  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init ? Object.assign({}, init) : {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var proxy = isProxyUrl(url);
    if (proxy) {
      if (isWorkersDev(url)) {
        var pass = readLegacyPass();
        if (pass) {
          var h = init.headers;
          if (!h) {
            init.headers = { 'X-Site-Password': pass };
          } else if (typeof Headers !== 'undefined' && h instanceof Headers) {
            h.set('X-Site-Password', pass);
          } else {
            init.headers = Object.assign({}, h, { 'X-Site-Password': pass });
          }
        }
      }
      if (init.credentials == null) init.credentials = 'include';
    }
    return _fetch(input, init).then(function (res) {
      if (!proxy) return res;
      if (res.status === 401) {
        forceReauth();
        return res;
      }
      maybeMismatchAlert(res);
      return res;
    });
  };
})();
`;

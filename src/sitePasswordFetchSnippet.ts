/** IIFE: sessionStorage/localStorage hasło → nagłówek X-Site-Password przy fetch do Workera. */
export const SITE_PASSWORD_FETCH_SNIPPET = `(function () {
  var KEY = 'zwrotka_site_password';
  var reauthPending = false;
  function readPass() {
    try {
      var s = sessionStorage.getItem(KEY) || '';
      if (s) return s;
      var l = localStorage.getItem(KEY) || '';
      if (l) {
        try { sessionStorage.setItem(KEY, l); } catch (e) {}
        return l;
      }
    } catch (e) {}
    return '';
  }
  function clearPass() {
    try {
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function forceReauth() {
    if (reauthPending) return;
    reauthPending = true;
    clearPass();
    location.assign('/logout');
  }
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init ? Object.assign({}, init) : {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isProxy =
      url.indexOf('/api/transport') !== -1 ||
      url.indexOf('/api/formatka') !== -1 ||
      url.indexOf('workers.dev') !== -1;
    if (isProxy) {
      var pass = readPass();
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
      if (init.credentials == null) init.credentials = 'include';
    }
    return _fetch(input, init).then(function (res) {
      if (isProxy && res.status === 401) {
        forceReauth();
      }
      return res;
    });
  };
})();
`;

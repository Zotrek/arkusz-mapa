/** IIFE: sessionStorage hasło → nagłówek X-Site-Password przy fetch do Workera. */
export const SITE_PASSWORD_FETCH_SNIPPET = `(function () {
  var KEY = 'zwrotka_site_password';
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init ? Object.assign({}, init) : {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isProxy =
      url.indexOf('/api/transport') !== -1 ||
      url.indexOf('/api/formatka') !== -1 ||
      url.indexOf('workers.dev') !== -1;
    if (isProxy) {
      var pass = '';
      try { pass = sessionStorage.getItem(KEY) || ''; } catch (e) {}
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
    return _fetch(input, init);
  };
})();
`;

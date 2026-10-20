/** Skrypt mapy: Biblioteki Word i składanie pliku .docx. */

export function docxRenderBrowserScript(): string {
  return `    function b64ToUint8(b64) {
      var bin = atob(b64);
      var n = bin.length;
      var u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    var wordTemplateBytesCache = null;
    function getWordTemplateBytes() {
      if (!wordTemplateBytesCache) {
        wordTemplateBytesCache = b64ToUint8(WORD_TEMPLATE_B64);
      }
      return wordTemplateBytesCache;
    }
    function prewarmDocxTemplateCache() {
      if (!wordDocEnabled || !WORD_TEMPLATE_B64) return;
      try { getWordTemplateBytes(); } catch (e) {
        console.warn(e);
        showMapErrorCard({
          code: 'MAP-E-TEMPLATE-BYTES',
          summary: 'Szablon Word jest uszkodzony.',
          effect: 'Protokół nie powstanie, dopóki plik szablonu nie da się odczytać.',
          place: 'map/browser/docxRender.ts prewarmDocxTemplateCache',
          technical: String(e && e.message || e)
        });
      }
    }
    var docxLibsPromise = null;
    function loadScriptOnce(src) {
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
          if (existing.getAttribute('data-loaded') === '1') {
            resolve();
            return;
          }
          existing.addEventListener('load', function () { resolve(); });
          existing.addEventListener('error', function () { reject(new Error('script: ' + src)); });
          return;
        }
        var s = document.createElement('script');
        s.src = src;
        s.crossOrigin = '';
        s.onload = function () { s.setAttribute('data-loaded', '1'); resolve(); };
        s.onerror = function () {
          if (s.parentNode) s.parentNode.removeChild(s);
          reject(new Error('script: ' + src));
        };
        document.head.appendChild(s);
      });
    }
    function ensureDocxLibrariesLoaded() {
      if (typeof PizZip !== 'undefined' && typeof docxtemplater !== 'undefined' && typeof saveAs !== 'undefined') {
        return Promise.resolve();
      }
      if (!docxLibsPromise) {
        docxLibsPromise = loadScriptOnce('https://unpkg.com/pizzip@3.1.7/dist/pizzip.min.js')
          .then(function () { return loadScriptOnce('https://unpkg.com/docxtemplater@3.50.0/build/docxtemplater.js'); })
          .then(function () { return loadScriptOnce('https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js'); })
          .catch(function (err) {
            docxLibsPromise = null;
            throw err;
          });
      }
      return docxLibsPromise;
    }
    function sanitizeFileNamePart(text) {
      return String(text)
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }
    function buildDocxDownloadName(przewoznikLabel, dataDdMmRr, adresSklepu) {
      var base = [sanitizeFileNamePart(przewoznikLabel), dataDdMmRr, sanitizeFileNamePart(adresSklepu)]
        .filter(function (x) { return x.length > 0; })
        .join(' ');
      if (base.length === 0) {
        base = 'dokument';
      }
      var maxLen = 220;
      if (base.length > maxLen) {
        base = base.slice(0, maxLen - 3).trim() + '...';
      }
      return base + '.docx';
    }
    function renderDocxAndDownload(p, pr, md, prOpt, dz, dzPlik, numerZlecenia, filteredSeals, preparedLists, options) {
      var opts = options || {};
      var lists = preparedLists || buildDocListsFromSealRows(filteredSeals);
      var rodzajZbiorki = aggregateRodzajZbiorkiFromSealRows(filteredSeals);
      var zip = new PizZip(getWordTemplateBytes());
      var Doc = window.docxtemplater;
      var doc = new Doc(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
      });
      doc.render({
        miejsce_zaladunku: p.doc.miejsce_zaladunku,
        lista_plomb: lists.lista_plomb,
        lista_plomb_xml: lists.lista_plomb_xml,
        przewoznik: pr,
        miejsce_dostawy: md,
        data_zaladunku: dz,
        numer_zlecenia_transportowego: numerZlecenia,
        rodzaj_zbiorki: rodzajZbiorki ? (' ' + rodzajZbiorki) : ''
      });
      var out = doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      var safeName = buildDocxDownloadName(prOpt.label, dzPlik, p.adres);
      saveAs(out, safeName);
      if (opts.closeModal !== false) {
        closeDocModal();
      }
    }
`;
}

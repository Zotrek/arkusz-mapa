/** Skrypt mapy: Lista plomb do Worda, combobox podwykonawców, wywołania API transportu. */

export function sealListsBrowserScript(): string {
  return `    function podwykoOptionMatchesQuery(opt, query) {
      return podwykoOptionMatchesSearch(opt.label, opt.dane, query);
    }
    var docComboboxInited = false;
    function hideDocComboboxList(listEl, inputEl) {
      if (!listEl) return;
      listEl.hidden = true;
      listEl.innerHTML = '';
      if (inputEl) inputEl.setAttribute('aria-expanded', 'false');
    }
    function showDocComboboxList(listEl, inputEl) {
      if (!listEl) return;
      listEl.hidden = false;
      if (inputEl) inputEl.setAttribute('aria-expanded', 'true');
    }
    var DOC_LS_PRZEWOZNIK = 'arkusz-mapa-doc-last-przewoznik-label';
    var DOC_LS_MIEJSCE = 'arkusz-mapa-doc-last-miejsce-label';
    function saveDocComboboxLastLabel(storageKey, label) {
      if (!storageKey || !label) return;
      try { localStorage.setItem(storageKey, label); } catch (e) {}
    }
    function parseSealClosureDateMs(raw) {
      return parseDataZamknieciaWorkaToSortMs(raw == null ? '' : String(raw));
    }
    function isDocBezListyPlombChecked() {
      var el = document.getElementById('doc-chk-bez-listy-plomb');
      return !!(el && el.checked);
    }
    function buildDocListsFromSealRows(sealRows) {
      return buildDocListaPlombFields(sealRows || [], { withoutListaPlomb: isDocBezListyPlombChecked() });
    }
    function rebuildDocPreparedLists(sealRows) {
      window.__docPreparedLists = buildDocListsFromSealRows(sealRows || []);
    }
    function refreshAllDocPreparedLists() {
      if (window.__docModalMode === 'bulk') {
        (window.__docBulkPointJobs || []).forEach(function (job) {
          job.preparedLists = buildDocListsFromSealRows(job.filteredSeals);
        });
        return;
      }
      rebuildDocPreparedLists(window.__docFilteredSeals || []);
    }
    function resetDocBezListyPlombCheckbox() {
      var el = document.getElementById('doc-chk-bez-listy-plomb');
      if (el) el.checked = false;
    }
    function formatYmdToDisplay(ymd) {
      if (!ymd) return '';
      var p = String(ymd).split('-');
      if (p.length !== 3) return String(ymd);
      return p[2] + '.' + p[1] + '.' + p[0];
    }
    function updateDocFilterInfo(total, filtered, cutoffYmd) {
      var el = document.getElementById('doc-filter-info');
      if (!el) return;
      if (filtered === total) {
        el.textContent = 'Worki w protokole: ' + filtered;
        return;
      }
      var extra = cutoffYmd ? (' (od ostatniego transportu ' + formatYmdToDisplay(cutoffYmd) + ')') : '';
      el.textContent = 'Worki w protokole: ' + filtered + ' z ' + total + extra;
    }
    function transportApiUrl(params) {
      var q = params || {};
      var parts = [];
      Object.keys(q).forEach(function (k) {
        if (q[k] != null && q[k] !== '') {
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k])));
        }
      });
      var sep = TRANSPORT_WEBAPP_URL.indexOf('?') >= 0 ? '&' : '?';
      return TRANSPORT_WEBAPP_URL + (parts.length ? sep + parts.join('&') : '');
    }
    function fetchTransportGet(params) {
      return fetch(transportApiUrl(params)).then(function (res) { return readMapJson_(res); });
    }
    function appendTransportRow(payload) {
      return fetch(TRANSPORT_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function (res) { return readMapJson_(res); });
    }
`;
}

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
    /** HTML 5xx (DEADLINE_EXCEEDED, Cloudflare 524) i zerwane połączenie (Failed to fetch) bywają chwilowe. Odczyt, więc jedna powtórka. */
    function fetchTransportGetRetry_(params) {
      function once() {
        return fetchTransportGet(params);
      }
      return once().then(function (resp) {
        if (!resp || !resp.notJson || !(resp.status >= 500)) return resp;
        return delayMs(1500).then(once);
      }, function () {
        return delayMs(1500).then(once);
      });
    }
    function newProtocolWriteId_() {
      return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    /**
     * Jedna powtórka po Failed to fetch albo HTML 5xx.
     * Najpierw GET protocolWrite z tym samym writeId. Drugi POST tylko gdy Web App
     * potwierdzi, że wiersza nie ma (albo zapis jest w toku). Inaczej nie ponawiamy:
     * stary skrypt albo drugi urwany odczyt zostawiłby ryzyko dwóch wierszy.
     */
    function appendTransportRow(payload) {
      if (payload && !payload.writeId) {
        payload.writeId = newProtocolWriteId_();
      }
      function postOnce() {
        return fetch(TRANSPORT_WEBAPP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        }).then(function (res) { return readMapJson_(res); });
      }
      function transientResponse_(resp) {
        return !!(resp && resp.notJson && resp.status >= 500);
      }
      function recover_(originalErr, originalResp) {
        return delayMs(1500).then(function () {
          return fetchTransportGet({ action: 'protocolWrite', writeId: payload.writeId });
        }).then(function (lookup) {
          if (lookup && lookup.ok && lookup.found && lookup.done && lookup.numer) {
            var recovered = { ok: true, numer: String(lookup.numer), replay: true };
            if (lookup.bolecinError) recovered.bolecinError = String(lookup.bolecinError);
            return recovered;
          }
          if (lookup && lookup.ok && lookup.found === false) return postOnce();
          if (lookup && lookup.ok && lookup.found && !lookup.done) return postOnce();
          if (originalErr) throw originalErr;
          return originalResp;
        }, function () {
          if (originalErr) throw originalErr;
          return originalResp;
        });
      }
      return postOnce().then(function (resp) {
        if (!transientResponse_(resp)) return resp;
        return recover_(null, resp);
      }, function (err) {
        return recover_(err, null);
      });
    }
`;
}

/** Skrypt mapy: Okno „Generuj dokument” (pojedyncze i zbiorcze). */

export function docModalBrowserScript(): string {
  return `    function setDocModalMode(mode) {
      window.__docModalMode = mode;
      var isBulk = mode === 'bulk';
      var titleEl = document.getElementById('doc-modal-title');
      var bulkWrap = document.getElementById('doc-bulk-points-wrap');
      var singleNumerWrap = document.getElementById('doc-single-numer-wrap');
      var bulkNumerInfo = document.getElementById('doc-bulk-numer-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (titleEl) {
        titleEl.textContent = isBulk
          ? 'Generuj dokumenty Word (' + (window.__bulkDocPointIdxs || []).length + ' punktów)'
          : 'Generuj dokument Word';
      }
      if (bulkWrap) bulkWrap.hidden = !isBulk;
      if (singleNumerWrap) singleNumerWrap.hidden = isBulk;
      if (bulkNumerInfo) bulkNumerInfo.hidden = !isBulk;
      if (okBtn) okBtn.textContent = isBulk ? 'Pobierz wszystkie .docx' : 'Pobierz .docx';
    }
    function preparePointDocSeals(pointIdx) {
      var p = adresy[pointIdx];
      if (!p) return { filteredSeals: [], cutoffYmd: null, total: 0 };
      var cutoffMs = transportApiEnabled && window.__transportDatesLoaded ? getPointTransportCutoff(p) : null;
      var all = p.sealRows || [];
      var collectible = sealRowsForCollection(all);
      var filteredSeals = filterSealRowsByMinClosureDate(collectible, cutoffMs);
      var cutoffYmd = null;
      if (cutoffMs != null) {
        var d = new Date(cutoffMs);
        cutoffYmd = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
      return { filteredSeals: filteredSeals, cutoffYmd: cutoffYmd, total: all.length };
    }
    function renderBulkPointsList(indices) {
      var listEl = document.getElementById('doc-bulk-points-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      indices.forEach(function (idx) {
        var p = adresy[idx];
        if (!p) return;
        var prep = preparePointDocSeals(idx);
        var li = document.createElement('li');
        var suffix = prep.filteredSeals.length === prep.total
          ? prep.filteredSeals.length + ' worków'
          : prep.filteredSeals.length + ' z ' + prep.total + ' worków';
        li.textContent = addressWithCommaAfterLocality(p.adres, p.miasto) + ' — ' + suffix;
        listEl.appendChild(li);
      });
    }
    function loadBulkDocModalData(indices) {
      window.__docModalDataReady = false;
      window.__docBulkPointJobs = [];
      var filterInfo = document.getElementById('doc-filter-info');
      var bulkNumerInfo = document.getElementById('doc-bulk-numer-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (filterInfo) filterInfo.textContent = 'Przygotowywanie danych…';
      if (bulkNumerInfo) bulkNumerInfo.textContent = '';
      if (okBtn) okBtn.disabled = true;
      setTransportDatesLoading(true, 'Ładowanie danych dokumentów…');
      renderBulkPointsList(indices);
      indices.forEach(function (idx) {
        var p = adresy[idx];
        if (!p) return;
        var prep = preparePointDocSeals(idx);
        window.__docBulkPointJobs.push({
          pointIdx: idx,
          filteredSeals: prep.filteredSeals,
          preparedLists: buildDocListsFromSealRows(prep.filteredSeals)
        });
      });
      var totalWorkow = 0;
      var emptyCount = 0;
      window.__docBulkPointJobs.forEach(function (job) {
        totalWorkow += job.filteredSeals.length;
        if (job.filteredSeals.length === 0) emptyCount += 1;
      });
      if (filterInfo) {
        var msg = indices.length + ' punktów · ' + totalWorkow + ' worków łącznie';
        if (emptyCount > 0) msg += ' (' + emptyCount + ' bez worków)';
        filterInfo.textContent = msg;
      }
      function finishBulkLoading(previewNumer) {
        if (bulkNumerInfo) {
          if (transportApiEnabled && previewNumer) {
            var jobCount = (window.__docBulkPointJobs || []).length;
            if (jobCount <= 1) {
              bulkNumerInfo.textContent = 'Numer zostanie nadany automatycznie.';
            } else {
              bulkNumerInfo.textContent = 'Numery zostaną nadane automatycznie kolejno (od ' + previewNumer + ').';
            }
          } else {
            bulkNumerInfo.textContent = 'Każdy punkt otrzyma osobny numer zlecenia transportowego.';
          }
        }
        window.__docModalDataReady = true;
        if (okBtn) okBtn.disabled = false;
        setTransportDatesLoading(false);
      }
      if (transportApiEnabled) {
        return fetchTransportGetRetry_({ action: 'previewNumber' }).then(function (resp) {
          if (!resp || resp.ok === false) {
            mapApiErrorCard_({
              code: 'MAP-E-BULK-DOC-NUMBER',
              summary: 'Nie udało się podejrzeć numeru protokołów zbiorczych.',
              effect: 'Modal idzie dalej bez podglądu numeru. Zapis i tak nadaje numery.',
              place: 'map/browser/docModal.ts loadBulkDocModalData',
              technical: String(resp && resp.error ? resp.error : 'ok: false')
            }, resp, null);
          }
          finishBulkLoading(resp && resp.ok ? String(resp.numer || '') : '');
        }).catch(function (err) {
          mapApiErrorCard_({
            code: 'MAP-E-BULK-DOC-NUMBER',
            summary: 'Nie udało się podejrzeć numeru protokołów zbiorczych.',
            effect: 'Modal idzie dalej bez podglądu numeru. Zapis i tak nadaje numery.',
            place: 'map/browser/docModal.ts loadBulkDocModalData',
            technical: String(err && err.message || err)
          }, null, err);
          finishBulkLoading('');
        });
      }
      finishBulkLoading('');
      return Promise.resolve();
    }
    function loadDocModalData(pointIdx) {
      var p = adresy[pointIdx];
      window.__docCutoffMs = null;
      window.__docModalDataReady = false;
      window.__docPreviewNumer = '';
      window.__docFilteredSeals = (p && p.sealRows) ? sealRowsForCollection(p.sealRows) : [];
      var filterInfo = document.getElementById('doc-filter-info');
      var okBtn = document.getElementById('doc-btn-ok');
      if (filterInfo) filterInfo.textContent = 'Ładowanie danych transportu…';
      if (okBtn) okBtn.disabled = true;
      setTransportDatesLoading(true, 'Ładowanie danych dokumentu…');
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      function finishLoading() {
        window.__docModalDataReady = true;
        if (okBtn) okBtn.disabled = false;
        setTransportDatesLoading(false);
      }
      if (!transportApiEnabled) {
        if (numEl) numEl.value = '';
        updateDocFilterInfo((p && p.sealRows ? p.sealRows.length : 0), window.__docFilteredSeals.length, null);
        rebuildDocPreparedLists(window.__docFilteredSeals);
        finishLoading();
        return Promise.resolve();
      }
      var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
      var cachedCutoff = window.__transportDatesLoaded ? getPointTransportCutoff(p) : null;
      return fetchTransportGetRetry_({ action: 'modalData', podmiot: podmiot, adres: p.adres }).then(function (resp) {
        if (!resp || resp.ok === false) {
          mapApiErrorCard_({
            code: 'MAP-E-DOC-NUMBER',
            summary: 'Nie udało się pobrać numeru protokołu.',
            effect: 'Numer zostaje pusty. Przycisk pobierania i tak się włączy.',
            place: 'map/browser/docModal.ts loadDocModalData',
            technical: String(resp && resp.error ? resp.error : 'ok: false')
          }, resp, null);
        }
        if (resp && resp.ok && numEl) {
          numEl.value = String(resp.numer || '');
          window.__docPreviewNumer = String(resp.numer || '');
        }
        var cutoffMs = cachedCutoff;
        var cutoffYmd = null;
        if (cutoffMs == null && resp && resp.ok && resp.lastTransportDateMs != null) {
          cutoffMs = resp.lastTransportDateMs;
          cutoffYmd = resp.lastTransportDateYmd || null;
        } else if (cutoffMs != null) {
          var cd = new Date(cutoffMs);
          cutoffYmd = cd.getUTCFullYear() + '-' + String(cd.getUTCMonth() + 1).padStart(2, '0') + '-' + String(cd.getUTCDate()).padStart(2, '0');
        }
        window.__docCutoffMs = cutoffMs;
        var all = p.sealRows || [];
        window.__docFilteredSeals = filterSealRowsByMinClosureDate(sealRowsForCollection(all), cutoffMs);
        updateDocFilterInfo(all.length, window.__docFilteredSeals.length, cutoffYmd);
        rebuildDocPreparedLists(window.__docFilteredSeals);
      }).catch(function (err) {
        console.error(err);
        mapApiErrorCard_({
          code: 'MAP-E-DOC-NUMBER',
          summary: 'Nie udało się pobrać danych transportu do protokołu.',
          effect: 'Użyto worków do odebrania, bez odcięcia od ostatniego transportu. Numer zostaje pusty.',
          place: 'map/browser/docModal.ts loadDocModalData',
          technical: String(err && err.message || err)
        }, null, err);
        window.__docFilteredSeals = sealRowsForCollection(p.sealRows || []);
        updateDocFilterInfo((p.sealRows || []).length, window.__docFilteredSeals.length, null);
        rebuildDocPreparedLists(window.__docFilteredSeals);
      }).then(function () {
        finishLoading();
      });
    }
    function findPodwykoIdxByLabel(label) {
      if (!label) return -1;
      var i;
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (PODWYKOLISTA[i].label === label) return i;
      }
      var q = normalizeForAddressSearch(label);
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (normalizeForAddressSearch(PODWYKOLISTA[i].label) === q) return i;
      }
      return -1;
    }
    function selectDocComboboxOption(inputEl, hiddenEl, listEl, idx, storageKey) {
      var opt = PODWYKOLISTA[idx];
      if (!opt || !inputEl || !hiddenEl) return;
      inputEl.value = opt.label;
      hiddenEl.value = String(idx);
      if (storageKey) saveDocComboboxLastLabel(storageKey, opt.label);
      hideDocComboboxList(listEl, inputEl);
      if (hiddenEl.id === 'doc-val-przewoznik') refreshRouteNameField();
    }
    function renderDocComboboxList(listEl, inputEl, hiddenEl, query, storageKey) {
      if (!listEl || !inputEl || !hiddenEl) return;
      listEl.innerHTML = '';
      if (PODWYKOLISTA.length === 0) {
        var emptyLi = document.createElement('li');
        emptyLi.className = 'doc-combobox-empty';
        emptyLi.textContent = '(Brak listy — dodaj docs/podwyko lista.xlsx lub ustaw PODWYKOLISTA_ODS_PATH)';
        listEl.appendChild(emptyLi);
        showDocComboboxList(listEl, inputEl);
        return;
      }
      var shown = 0;
      var maxShow = 80;
      PODWYKOLISTA.forEach(function (opt, idx) {
        if (!podwykoOptionMatchesQuery(opt, query)) return;
        if (shown >= maxShow) return;
        shown += 1;
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('data-idx', String(idx));
        li.textContent = opt.label;
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          selectDocComboboxOption(inputEl, hiddenEl, listEl, idx, storageKey);
        });
        listEl.appendChild(li);
      });
      if (shown === 0) {
        var noLi = document.createElement('li');
        noLi.className = 'doc-combobox-empty';
        noLi.textContent = 'Brak dopasowań';
        listEl.appendChild(noLi);
      }
      showDocComboboxList(listEl, inputEl);
    }
    function tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey) {
      if (!inputEl || !hiddenEl) return;
      var text = String(inputEl.value).trim();
      if (!text) {
        hiddenEl.value = '';
        return;
      }
      var q = normalizeForAddressSearch(text);
      var i;
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (normalizeForAddressSearch(PODWYKOLISTA[i].label) === q) {
          selectDocComboboxOption(inputEl, hiddenEl, null, i, storageKey);
          return;
        }
      }
      var matches = [];
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (podwykoOptionMatchesQuery(PODWYKOLISTA[i], text)) matches.push(i);
      }
      if (matches.length === 1) {
        selectDocComboboxOption(inputEl, hiddenEl, null, matches[0], storageKey);
        return;
      }
      hiddenEl.value = '';
    }
    function restoreDocComboboxFromSavedLabel(inputId, hiddenId, listId, storageKey) {
      resetDocCombobox(inputId, hiddenId, listId);
      var saved = '';
      try { saved = localStorage.getItem(storageKey) || ''; } catch (e) {}
      saved = String(saved).trim();
      if (!saved) return;
      var idx = findPodwykoIdxByLabel(saved);
      if (idx < 0) return;
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      selectDocComboboxOption(inputEl, hiddenEl, listEl, idx);
    }
    function resetDocCombobox(inputId, hiddenId, listId) {
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      if (!inputEl || !hiddenEl) return;
      inputEl.value = '';
      hiddenEl.value = '';
      hideDocComboboxList(listEl, inputEl);
    }
    function setupDocCombobox(inputId, hiddenId, listId, storageKey) {
      var inputEl = document.getElementById(inputId);
      var hiddenEl = document.getElementById(hiddenId);
      var listEl = document.getElementById(listId);
      if (!inputEl || !hiddenEl || !listEl) return;
      inputEl.addEventListener('focus', function () {
        renderDocComboboxList(listEl, inputEl, hiddenEl, inputEl.value, storageKey);
      });
      inputEl.addEventListener('input', function () {
        hiddenEl.value = '';
        renderDocComboboxList(listEl, inputEl, hiddenEl, inputEl.value, storageKey);
      });
      inputEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey);
          hideDocComboboxList(listEl, inputEl);
        }, 150);
      });
      inputEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          hideDocComboboxList(listEl, inputEl);
          return;
        }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          var items = listEl.querySelectorAll('li[data-idx]');
          if (!items.length) return;
          ev.preventDefault();
          var active = listEl.querySelector('li.doc-combobox-active');
          var nextIdx = 0;
          if (active) {
            for (var j = 0; j < items.length; j++) {
              if (items[j] === active) {
                nextIdx = ev.key === 'ArrowDown' ? Math.min(j + 1, items.length - 1) : Math.max(j - 1, 0);
                break;
              }
            }
          } else if (ev.key === 'ArrowUp') {
            nextIdx = items.length - 1;
          }
          for (var k = 0; k < items.length; k++) {
            items[k].classList.toggle('doc-combobox-active', k === nextIdx);
          }
          items[nextIdx].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (ev.key === 'Enter') {
          var pick = listEl.querySelector('li.doc-combobox-active') || listEl.querySelector('li[data-idx]');
          if (pick && pick.getAttribute('data-idx') != null) {
            ev.preventDefault();
            selectDocComboboxOption(inputEl, hiddenEl, listEl, parseInt(pick.getAttribute('data-idx'), 10), storageKey);
          } else {
            tryResolveDocComboboxFromInput(inputEl, hiddenEl, storageKey);
            hideDocComboboxList(listEl, inputEl);
          }
        }
      });
    }
    function initDocComboboxes() {
      if (docComboboxInited) return;
      docComboboxInited = true;
      setupDocCombobox('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      setupDocCombobox('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
    }
    function openDocModal(pointIdx) {
      if (!wordDocEnabled) return;
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        showMapFormError_(
          'MAP-E-TRANSPORT-WAIT',
          'Poczekaj na pobranie danych transportu.',
          'Protokół otworzy się, gdy zniknie pasek ładowania u góry mapy.',
          'map/browser/docModal.ts openDocModal',
          '__transportDatesLoaded === false'
        );
        return;
      }
      window.__currentDocPointIdx = pointIdx;
      window.__bulkDocPointIdxs = [];
      window.__bolecinAwizacjaChoice = null;
      window.__bolecinAwizacjaForm = null;
      setDocModalMode('single');
      resetRouteFormForOpen();
      var m = document.getElementById('doc-modal');
      initDocComboboxes();
      restoreDocComboboxFromSavedLabel('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      restoreDocComboboxFromSavedLabel('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      if (dateEl) dateEl.value = defaultDateZaladunkuYmd();
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      if (numEl) numEl.value = '';
      var kom1 = document.getElementById('doc-inp-komentarz-1');
      if (kom1) kom1.value = '';
      var kom2 = document.getElementById('doc-inp-komentarz-2');
      if (kom2) kom2.value = '';
      resetDocBezListyPlombCheckbox();
      ensureDocxLibrariesLoaded();
      prewarmDocxTemplateCache();
      loadDocModalData(pointIdx);
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function openBulkDocModal(indices) {
      if (!wordDocEnabled || !indices || indices.length === 0) return;
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        showMapFormError_(
          'MAP-E-TRANSPORT-WAIT',
          'Poczekaj na pobranie danych transportu.',
          'Protokół zbiorczy otworzy się, gdy zniknie pasek ładowania u góry mapy.',
          'map/browser/docModal.ts openBulkDocModal',
          '__transportDatesLoaded === false'
        );
        return;
      }
      window.__currentDocPointIdx = null;
      window.__bulkDocPointIdxs = indices.slice();
      window.__bolecinAwizacjaChoice = null;
      window.__bolecinAwizacjaForm = null;
      setDocModalMode('bulk');
      resetRouteFormForOpen();
      var m = document.getElementById('doc-modal');
      initDocComboboxes();
      restoreDocComboboxFromSavedLabel('doc-sel-przewoznik', 'doc-val-przewoznik', 'doc-sel-przewoznik-list', DOC_LS_PRZEWOZNIK);
      restoreDocComboboxFromSavedLabel('doc-sel-miejsce', 'doc-val-miejsce', 'doc-sel-miejsce-list', DOC_LS_MIEJSCE);
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      if (dateEl) dateEl.value = defaultDateZaladunkuYmd();
      var kom1 = document.getElementById('doc-inp-komentarz-1');
      if (kom1) kom1.value = '';
      var kom2 = document.getElementById('doc-inp-komentarz-2');
      if (kom2) kom2.value = '';
      resetDocBezListyPlombCheckbox();
      ensureDocxLibrariesLoaded();
      prewarmDocxTemplateCache();
      loadBulkDocModalData(indices);
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function closeDocModal() {
      var m = document.getElementById('doc-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
      window.__bolecinAwizacjaChoice = null;
      window.__bolecinAwizacjaForm = null;
      var aw = document.getElementById('bolecin-aw-modal');
      if (aw) {
        aw.style.display = 'none';
        aw.setAttribute('aria-hidden', 'true');
      }
    }
`;
}

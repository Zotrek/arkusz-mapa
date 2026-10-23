/** Skrypt mapy: Pola „Odbiór z trasy”: nazwa i stawka trasy. */

export function routeFormBrowserScript(): string {
  return `    function isManualTransportNumer(inputValue, previewNumer) {
      var v = String(inputValue || '').trim();
      if (!v) return false;
      return v !== String(previewNumer || '');
    }
    function isRouteChecked() {
      var el = document.getElementById('doc-chk-odbior-z-trasy');
      return !!(el && el.checked);
    }
    function setRouteFieldsVisible(on) {
      var wrap = document.getElementById('doc-route-fields');
      if (!wrap) return;
      if (on) wrap.removeAttribute('hidden');
      else wrap.setAttribute('hidden', '');
    }
    function readRouteNameInput() {
      var nameEl = document.getElementById('doc-inp-trasa');
      return nameEl ? String(nameEl.value) : '';
    }
    function readRouteRateInput() {
      var rateEl = document.getElementById('doc-inp-stawka-trasy');
      return rateEl ? String(rateEl.value) : '';
    }
    function contractorShortNameForRoute() {
      var prVal = document.getElementById('doc-val-przewoznik');
      var idx = prVal ? parseInt(prVal.value, 10) : NaN;
      var opt = !isNaN(idx) ? PODWYKOLISTA[idx] : null;
      if (opt && opt.label) return String(opt.label);
      // Widoczny tekst bez ukrytego indeksu (wpis / autofill) — dociągnij z listy bez refresh.
      var inputEl = document.getElementById('doc-sel-przewoznik');
      var text = inputEl ? String(inputEl.value || '').trim() : '';
      if (!text) return '';
      var found = findPodwykoIdxByLabel(text);
      if (found < 0) {
        var q = normalizeForAddressSearch(text);
        var matches = [];
        var i;
        for (i = 0; i < PODWYKOLISTA.length; i++) {
          if (podwykoOptionMatchesQuery(PODWYKOLISTA[i], text)) matches.push(i);
          else if (normalizeForAddressSearch(PODWYKOLISTA[i].label) === q) matches.push(i);
        }
        if (matches.length === 1) found = matches[0];
      }
      if (found < 0) return '';
      if (prVal) prVal.value = String(found);
      return String(PODWYKOLISTA[found].label || '');
    }
    function pickupDateForRoute() {
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      return dateEl ? String(dateEl.value || '').trim() : '';
    }
    function routeNameMissingDepsHint(contractor, date) {
      if (!contractor) return 'Najpierw wybierz kto odbiera';
      if (!date) return 'Uzupełnij datę załadunku';
      return '';
    }
    function resetRouteFormForOpen() {
      routeNameMode = 'continue';
      routeRateBaseline = '';
      routeRateBaselineName = '';
      routeNameTouched = false;
      routeRateTouched = false;
      routeRateRequest += 1;
      if (typeof routeNameProposeTicket !== 'undefined') routeNameProposeTicket += 1;
      if (routeRateTimer) {
        window.clearTimeout(routeRateTimer);
        routeRateTimer = 0;
      }
      var chk = document.getElementById('doc-chk-odbior-z-trasy');
      if (chk) chk.checked = false;
      var nameEl = document.getElementById('doc-inp-trasa');
      var rateEl = document.getElementById('doc-inp-stawka-trasy');
      if (nameEl) {
        nameEl.value = '';
        nameEl.placeholder = '';
        nameEl.removeAttribute('aria-busy');
      }
      if (rateEl) rateEl.value = '';
      routeNameFieldLoadDepth = 0;
      if (typeof syncMapLoaderUi === 'function') syncMapLoaderUi(null);
      setRouteFieldsVisible(false);
    }
    function lookupRouteRate(name) {
      if (typeof routeRateTimer === 'undefined') return;
      if (routeRateTimer) window.clearTimeout(routeRateTimer);
      routeRateTimer = window.setTimeout(function () {
        routeRateTimer = 0;
        lookupRouteRateNow(name);
      }, 300);
    }
    function lookupRouteRateNow(name) {
      var rateEl = document.getElementById('doc-inp-stawka-trasy');
      if (!rateEl || typeof routeRateToKeep !== 'function') return;
      var trimmed = String(name || '').trim();
      var nameEl = document.getElementById('doc-inp-trasa');
      if (nameEl && String(nameEl.value).trim() !== trimmed) return;
      if (!trimmed || !transportApiEnabled) return;
      routeRateRequest += 1;
      var ticket = routeRateRequest;
      setTransportDatesLoading(true, 'Pobieranie stawki trasy…');
      // Strona HTML 5xx od Google (np. DEADLINE_EXCEEDED) bywa chwilowa. Odczyt, więc jedna powtórka.
      function fetchRate() {
        return fetchTransportGet({ action: 'routeRateByName', name: trimmed });
      }
      fetchRate().then(function (resp) {
        if (!resp || !resp.notJson || !(resp.status >= 500) || ticket !== routeRateRequest) return resp;
        return delayMs(1500).then(function () {
          return ticket === routeRateRequest ? fetchRate() : resp;
        });
      }).then(function (resp) {
        if (ticket !== routeRateRequest) return;
        var current = document.getElementById('doc-inp-trasa');
        if (!current || String(current.value).trim() !== trimmed) return;
        if (!resp || resp.ok === false) {
          mapApiErrorCard_({
            code: 'MAP-E-ROUTE-RATE',
            summary: 'Nie udało się pobrać stawki trasy.',
            effect: 'Pole stawki zostaje puste. Zapis może nie znać stawki już zapisanej na tej trasie.',
            place: 'map/browser/routeForm.ts lookupRouteRateNow',
            technical: String(resp && resp.error ? resp.error : 'ok: false')
          }, resp, null);
          return;
        }
        var looked = typeof routeRateFromLookup === 'function' ? routeRateFromLookup(resp && resp.stawka) : '';
        if (looked !== '') {
          routeRateBaselineName = trimmed;
          routeRateBaseline = looked;
        }
        rateEl.value = routeRateToKeep(rateEl.value, resp && resp.stawka, routeRateTouched);
      }).catch(function (err) {
        if (ticket !== routeRateRequest) return;
        mapApiErrorCard_({
          code: 'MAP-E-ROUTE-RATE',
          summary: 'Nie udało się pobrać stawki trasy.',
          effect: 'Pole stawki zostaje puste. Zapis może nie znać stawki już zapisanej na tej trasie.',
          place: 'map/browser/routeForm.ts lookupRouteRateNow',
          technical: String(err && err.message || err)
        }, null, err);
      }).then(function () {
        setTransportDatesLoading(false);
      });
    }
    function applyShownRouteName(shown) {
      var nameEl = document.getElementById('doc-inp-trasa');
      if (!nameEl || routeNameTouched) return;
      var next = shown == null ? '' : String(shown);
      // Pusta propozycja ze starego fetcha nie kasuje już wyliczonej nazwy.
      if (!next.trim() && String(nameEl.value || '').trim()) return;
      var changed = nameEl.value !== next;
      if (changed) {
        routeRateTouched = false;
        nameEl.value = next;
        if (routeNameMode === 'new') {
          var clearRate = document.getElementById('doc-inp-stawka-trasy');
          if (clearRate) clearRate.value = '';
          routeRateBaseline = '';
          routeRateBaselineName = '';
        }
      }
      if (!routeRateTouched && typeof routeRateFromSession === 'function') {
        var rateEl = document.getElementById('doc-inp-stawka-trasy');
        if (rateEl) {
          var filled = routeRateFromSession(next, rateEl.value, lastRouteName, lastRouteRate);
          rateEl.value = filled;
          if (String(filled || '').trim()) {
            routeRateBaselineName = String(next || '').trim();
            routeRateBaseline = String(filled).trim();
          }
        }
      }
      if (changed || !readRouteRateInput()) lookupRouteRate(next);
    }
    function updateRouteSessionUi() {
      var btn = document.getElementById('doc-btn-nowa-trasa');
      var hint = document.getElementById('doc-route-continue-hint');
      var remembered = String(lastRouteName || '').trim();
      var continuing = sessionContinuesSameContractor();
      if (btn) {
        btn.hidden = !remembered;
        btn.textContent = continuing ? 'Nowa trasa' : ('Dołącz do ' + remembered);
      }
      if (hint) {
        hint.hidden = !continuing;
        hint.textContent = continuing
          ? ('Kontynuacja ' + remembered + '. Inna stawka nie nadpisze poprzednich sklepów — zapis zapyta, czy to nowa trasa.')
          : '';
      }
    }
    function setRouteNameFieldLoading(on) {
      if (on) routeNameFieldLoadDepth += 1;
      else routeNameFieldLoadDepth = Math.max(0, routeNameFieldLoadDepth - 1);
      var busy = routeNameFieldLoadDepth > 0;
      var nameEl = document.getElementById('doc-inp-trasa');
      if (nameEl) {
        nameEl.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (busy) {
          if (!String(nameEl.value || '').trim()) nameEl.placeholder = 'Ładowanie nazwy trasy…';
        } else if (nameEl.placeholder === 'Ładowanie nazwy trasy…') {
          nameEl.placeholder = '';
        }
      }
      // Pulsujące logo (ten sam overlay co transport), ale depth osobny od mapLoaderDepth.
      syncMapLoaderUi(null);
    }
    /** Kontynuacja tylko gdy sesja i wybrany podwykonawca to ta sama trasa. */
    function sessionContinuesSameContractor() {
      if (routeNameMode === 'new') return false;
      var remembered = String(lastRouteName || '').trim();
      if (!remembered) return false;
      var contractor = contractorShortNameForRoute();
      if (!contractor) return true;
      if (typeof routeNameBelongsToContractor === 'function') {
        return routeNameBelongsToContractor(remembered, contractor);
      }
      return true;
    }
    function refreshRouteNameField() {
      if (!isRouteChecked() || typeof routeNameToShow !== 'function' || typeof lastRouteName === 'undefined') return;
      updateRouteSessionUi();
      if (routeNameTouched) {
        lookupRouteRate(readRouteNameInput());
        return;
      }
      if (sessionContinuesSameContractor()) {
        applyShownRouteName(routeNameToShow({
          sessionLastName: lastRouteName,
          proposal: '',
          currentInput: readRouteNameInput(),
          inputTouched: false
        }));
        return;
      }
      function propose(names) {
        if (!isRouteChecked() || routeNameTouched || sessionContinuesSameContractor()) return;
        // Odczyt w momencie apply — nie z domknięcia sprzed fetcha (kto odbiera mógł dojść w trakcie).
        var contractor = contractorShortNameForRoute();
        var date = pickupDateForRoute();
        var missing = routeNameMissingDepsHint(contractor, date);
        if (missing) {
          var emptyEl = document.getElementById('doc-inp-trasa');
          if (emptyEl && !String(emptyEl.value || '').trim()) {
            emptyEl.placeholder = missing;
          }
          return;
        }
        var occupied = names || [];
        try {
          if (typeof namesBlockingNewRoute === 'function') {
            occupied = namesBlockingNewRoute(names || [], routeNameMode === 'new' ? lastRouteName : '');
          }
        } catch (eOcc) {
          showMapErrorCard({
            code: 'MAP-E-ROUTE-NAME',
            summary: 'Nie udało się sprawdzić zajętych nazw tras.',
            effect: 'Nazwa nie została zaproponowana, żeby nie wziąć numeru, który już jest.',
            place: 'map/browser/routeForm.ts refreshRouteNameField',
            technical: String(eOcc && eOcc.message || eOcc)
          });
          return;
        }
        var proposal = '';
        try {
          if (typeof proposeRouteName === 'function') {
            proposal = proposeRouteName(occupied, contractor, date);
          }
        } catch (eProp) {
          showMapErrorCard({
            code: 'MAP-E-ROUTE-NAME',
            summary: 'Nie udało się wyliczyć nazwy trasy.',
            effect: 'Pole nazwy zostaje puste, żeby nie zaproponować numeru, który już jest.',
            place: 'map/browser/routeForm.ts refreshRouteNameField',
            technical: String(eProp && eProp.message || eProp)
          });
          return;
        }
        applyShownRouteName(routeNameToShow({
          sessionLastName: '',
          proposal: proposal,
          currentInput: readRouteNameInput(),
          inputTouched: false
        }));
      }
      // Inny podwykonawca niż w sesji: nie ciągnij starej stawki do nowej nazwy.
      if (String(lastRouteName || '').trim() && !routeRateTouched) {
        var clearRate = document.getElementById('doc-inp-stawka-trasy');
        if (clearRate) clearRate.value = '';
        routeRateBaseline = '';
        routeRateBaselineName = '';
      }
      var contractorNow = contractorShortNameForRoute();
      var dateNow = pickupDateForRoute();
      var missingNow = routeNameMissingDepsHint(contractorNow, dateNow);
      if (missingNow) {
        var hintEl = document.getElementById('doc-inp-trasa');
        if (hintEl) {
          hintEl.value = '';
          hintEl.placeholder = missingNow;
        }
        return;
      }
      if (!transportApiEnabled) {
        propose([]);
        return;
      }
      // Osobny stan pola — nie mapLoaderDepth. Ticket odrzuca spóźnione apply; loading zawsze zdejmij.
      routeNameProposeTicket += 1;
      var ticket = routeNameProposeTicket;
      setRouteNameFieldLoading(true);
      fetchTransportGetRetry_({ action: 'routeNameProposal' }).then(function (resp) {
        if (resp && resp.status === 401) return { failed: true, status: 401, technical: 'HTTP 401' };
        if (!resp || !Array.isArray(resp.names)) {
          return {
            failed: true,
            notJson: !!(resp && resp.notJson),
            status: resp && resp.status,
            technical: resp && resp.notJson
              ? String(resp.technical || 'nie-JSON')
              : String(resp && resp.error ? resp.error : 'brak listy names')
          };
        }
        return resp.names;
      }).catch(function (err) {
        return { failed: true, technical: String(err && err.message || err) };
      }).then(function (names) {
        setRouteNameFieldLoading(false);
        if (ticket !== routeNameProposeTicket) return;
        if (names && names.failed) {
          mapApiErrorCard_({
            code: 'MAP-E-ROUTE-NAME',
            summary: 'Nie udało się pobrać zajętych nazw tras.',
            effect: 'Nazwa nie została zaproponowana, żeby nie wziąć numeru, który już jest.',
            place: 'map/browser/routeForm.ts refreshRouteNameField',
            technical: names.technical
          }, names, null);
          return;
        }
        propose(names);
      });
    }
    function onNowaTrasaClick() {
      if (!String(lastRouteName || '').trim()) return;
      routeNameTouched = false;
      routeRateTouched = false;
      if (routeNameMode === 'new') {
        routeNameMode = 'continue';
      } else {
        routeNameMode = 'new';
        var rateEl = document.getElementById('doc-inp-stawka-trasy');
        if (rateEl) rateEl.value = '';
      }
      refreshRouteNameField();
    }
    function onRouteCheckboxChange() {
      setRouteFieldsVisible(isRouteChecked());
      if (!isRouteChecked()) return;
      refreshRouteNameField();
    }
    function onRouteNameInput() {
      routeNameTouched = true;
      routeRateTouched = false;
      lookupRouteRate(readRouteNameInput());
    }
    function onRouteRateInput() {
      routeRateTouched = true;
    }
    function rememberRouteAfterSuccessfulSave(routeFields) {
      if (!routeFields || typeof routeNameRememberedAfterSave !== 'function' || typeof lastRouteName === 'undefined') return;
      var remembered = routeNameRememberedAfterSave(routeFields.trasa);
      if (!remembered) return;
      lastRouteName = remembered;
      var rememberedRate = String(routeFields.stawkaTrasy || '').trim();
      if (rememberedRate) lastRouteRate = rememberedRate;
    }
    function routeFieldsForPayload() {
      if (typeof routeBodyFields !== 'function') return null;
      return routeBodyFields(isRouteChecked(), readRouteNameInput(), readRouteRateInput());
    }
    function parseDocFormValues() {
      var prInput = document.getElementById('doc-sel-przewoznik');
      var mdInput = document.getElementById('doc-sel-miejsce');
      var prVal = document.getElementById('doc-val-przewoznik');
      var mdVal = document.getElementById('doc-val-miejsce');
      if (prInput && prVal) tryResolveDocComboboxFromInput(prInput, prVal);
      if (mdInput && mdVal) tryResolveDocComboboxFromInput(mdInput, mdVal);
      var prIdx = prVal ? prVal.value : '';
      var mdIdx = mdVal ? mdVal.value : '';
      if (prIdx === '' || mdIdx === '') {
        showMapFormError_(
          'MAP-E-DOC-FORM',
          'Wybierz przewoźnika i miejsce dostawy.',
          'Protokół nie powstanie bez obu pozycji z listy.',
          'map/browser/routeForm.ts parseDocFormValues',
          'pusty przewoźnik albo miejsce'
        );
        return null;
      }
      var pi = parseInt(prIdx, 10);
      var mi = parseInt(mdIdx, 10);
      var prOpt = PODWYKOLISTA[pi];
      var mdOpt = PODWYKOLISTA[mi];
      if (!prOpt || !mdOpt) {
        showMapFormError_(
          'MAP-E-DOC-FORM',
          'Błąd wyboru z listy.',
          'Protokół nie powstanie. Wybierz przewoźnika i miejsce jeszcze raz.',
          'map/browser/routeForm.ts parseDocFormValues',
          'indeks spoza PODWYKOLISTA'
        );
        return null;
      }
      var dateEl = document.getElementById('doc-inp-data-zaladunku');
      var ymd = dateEl ? String(dateEl.value).trim() : '';
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(ymd)) {
        showMapFormError_(
          'MAP-E-DOC-DATE',
          'Wybierz datę załadunku.',
          'Protokół nie powstanie bez daty z kalendarza.',
          'map/browser/routeForm.ts parseDocFormValues',
          'data nie jest RRRR-MM-DD'
        );
        return null;
      }
      var pe = ymd.split('-');
      var y = parseInt(pe[0], 10);
      var mo = parseInt(pe[1], 10) - 1;
      var d = parseInt(pe[2], 10);
      var chk = new Date(y, mo, d);
      if (chk.getFullYear() !== y || chk.getMonth() !== mo || chk.getDate() !== d) {
        showMapFormError_(
          'MAP-E-DOC-DATE',
          'Nieprawidłowa data załadunku.',
          'Protokół nie powstanie. Wybierz istniejącą datę.',
          'map/browser/routeForm.ts parseDocFormValues',
          'data spoza kalendarza'
        );
        return null;
      }
      var dd = String(d).padStart(2, '0');
      var mm = String(mo + 1).padStart(2, '0');
      var yyyy = String(y);
      var rr = yyyy.slice(-2);
      var kom1El = document.getElementById('doc-inp-komentarz-1');
      var kom2El = document.getElementById('doc-inp-komentarz-2');
      return {
        pr: prOpt.dane,
        md: mdOpt.dane,
        prOpt: prOpt,
        mdOpt: mdOpt,
        dz: dd + '.' + mm + '.' + yyyy,
        dzPlik: dd + '.' + mm + '.' + rr,
        komentarz1: kom1El ? String(kom1El.value).trim() : '',
        komentarz2: kom2El ? String(kom2El.value).trim() : '',
        routeFields: routeFieldsForPayload()
      };
    }
    function updateTransportCutoffAfterAppend(p, dz, ktoOdbiera) {
      if (!window.__transportDateByKey) window.__transportDateByKey = {};
      if (!window.__transportKtoOdbieraByKey) window.__transportKtoOdbieraByKey = {};
      var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
      var key = buildTransportShopKey(podmiot, p.adres);
      var ms = parseSealClosureDateMs(dz);
      if (isFinite(ms) && ms !== Number.NEGATIVE_INFINITY) {
        window.__transportDateByKey[key] = ms;
      }
      var kto = String(ktoOdbiera || '').trim();
      if (kto) {
        window.__transportKtoOdbieraByKey[key] = kto;
      }
    }
    function delayMs(ms) {
      return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }
    function existingRouteRateFor(name) {
      var trimmed = String(name || '').trim();
      if (!trimmed) return '';
      if (trimmed === String(routeRateBaselineName || '').trim()) return String(routeRateBaseline || '').trim();
      if (trimmed === String(lastRouteName || '').trim()) return String(lastRouteRate || '').trim();
      return '';
    }
    function askDifferentRouteRate(name, existingRate, nextRate) {
      var asNew = window.confirm(
        'Stawka ' + nextRate + ' jest inna niż zapisana na trasie ' + name + ' (' + existingRate + ').\\n\\n' +
        'OK — zapisz jako nową trasę z następnym numerem. Sklepy trasy ' + name + ' zostają przy ' + existingRate + '.\\n' +
        'Anuluj — zapytam, czy zmienić stawkę na wszystkich sklepach tej trasy.'
      );
      if (asNew) return 'new-route';
      var updateAll = window.confirm(
        'Zmienić stawkę na ' + nextRate + ' na wszystkich nierozliczonych sklepach trasy ' + name + '?\\n\\nAnuluj przerywa zapis. Poprzednia stawka zostaje.'
      );
      return updateAll ? 'update-all' : 'cancel';
    }
    function proposeFreshRouteName(currentName) {
      var contractor = contractorShortNameForRoute();
      var date = pickupDateForRoute();
      function failFresh(technical, resp, summary) {
        mapApiErrorCard_({
          code: 'MAP-E-ROUTE-NAME-FRESH',
          summary: summary || 'Nie udało się pobrać zajętych nazw tras.',
          effect: 'Zapis przerwany, żeby nie nadać numeru, który już jest. Stawka poprzedniej trasy nie została zmieniona.',
          place: 'map/browser/routeForm.ts proposeFreshRouteName',
          technical: String(technical || 'brak listy names')
        }, resp || null, null);
        return null;
      }
      function fromNames(names) {
        try {
          var occupied = typeof namesBlockingNewRoute === 'function'
            ? namesBlockingNewRoute(names || [], currentName)
            : (names || []).concat([currentName]);
          return proposeRouteName(occupied, contractor, date);
        } catch (err) {
          return failFresh(err && err.message || err, null, 'Nie udało się wyliczyć nazwy nowej trasy.');
        }
      }
      if (!transportApiEnabled) return Promise.resolve(fromNames([]));
      return fetchTransportGetRetry_({ action: 'routeNameProposal' }).then(function (resp) {
        if (resp && resp.status === 401) return null;
        if (!resp || !Array.isArray(resp.names)) {
          return failFresh(resp && resp.notJson ? resp.technical : (resp && resp.error), resp);
        }
        return fromNames(resp.names);
      }).catch(function (err) { return failFresh(err && err.message || err, null); });
    }
    function resolveRouteFieldsBeforeSave(fields) {
      if (!fields || typeof routeRateConflictsWithExisting !== 'function') return Promise.resolve(fields);
      var name = String(fields.trasa || '').trim();
      var nextRate = String(fields.stawkaTrasy || '').trim();
      var existing = existingRouteRateFor(name);
      if (!routeRateConflictsWithExisting(name, nextRate, existing)) return Promise.resolve(fields);
      var choice = askDifferentRouteRate(name, existing, nextRate);
      if (choice === 'cancel') return Promise.resolve(null);
      if (choice === 'update-all') return Promise.resolve(fields);
      return proposeFreshRouteName(name).then(function (proposal) {
        if (proposal == null) return null;
        if (!proposal) {
          showMapErrorCard({
            code: 'MAP-E-ROUTE-FULL',
            summary: 'Brak wolnego numeru trasy (01–99).',
            effect: 'Zapis przerwany. Stawka poprzedniej trasy nie została zmieniona.',
            place: 'map/browser/routeForm.ts resolveRouteFieldsBeforeSave',
            technical: 'numery 01–99 zajęte'
          });
          return null;
        }
        var nameEl = document.getElementById('doc-inp-trasa');
        if (nameEl) nameEl.value = proposal;
        routeNameMode = 'new';
        routeRateBaseline = '';
        routeRateBaselineName = '';
        return routeBodyFields(true, proposal, nextRate);
      });
    }
    function docGenerateCrashed_(err, place) {
      console.error(err);
      var okBtn = document.getElementById('doc-btn-ok');
      if (okBtn) okBtn.disabled = false;
      setTransportDatesLoading(false);
      showMapErrorCard({
        code: 'MAP-E-DOC-GENERATE',
        summary: 'Generowanie przerwał nieoczekiwany błąd.',
        effect: 'Dokument mógł się nie pobrać, a wiersz rejestru mógł nie wejść. Sprawdź arkusz i spróbuj ponownie.',
        place: place,
        technical: String(err && err.message || err)
      });
    }
`;
}

/** Skrypt mapy: Okno „Ustaw stawki” dla zaznaczonych sklepów. */

import { saveRateRulesSource } from '../../saveRate.js';

export function bulkRatesBrowserScript(): string {
  return `    function uniqueBulkShopEntries(indices) {
      var seen = {};
      var out = [];
      var i;
      for (i = 0; i < indices.length; i++) {
        var p = adresy[indices[i]];
        if (!p) continue;
        var adres = String(p.adres || '').trim();
        if (!adres || seen[adres]) continue;
        seen[adres] = true;
        var sklep = String(p.sklep || '').trim();
        var shown = addressWithCommaAfterLocality(adres, p.miasto);
        var label = sklep && sklep !== adres && sklep !== shown ? sklep + ' — ' + shown : shown;
        out.push({
          adres: adres,
          label: label,
          dniHarmonogramu: String(p.dniHarmonogramu || '').trim(),
          firmaTransportowa: String(p.firmaTransportowa || '').trim()
        });
      }
      return out;
    }
    function getBulkRatesTarget() {
      var el = document.querySelector('input[name="bulk-rates-target"]:checked');
      return el && el.value === 'harmonogram' ? 'harmonogram' : 'stawki';
    }
    function syncBulkRatesTargetUi() {
      var isHarm = getBulkRatesTarget() === 'harmonogram';
      var dniWrap = document.getElementById('bulk-rates-dni-wrap');
      if (dniWrap) dniWrap.hidden = !isHarm;
      var trasaWrap = document.getElementById('bulk-rates-trasa-wrap');
      if (trasaWrap) trasaWrap.hidden = !isHarm;
      var hint = document.getElementById('bulk-rates-hint');
      if (hint) {
        hint.textContent = isHarm
          ? 'Te same wartości trafią do Bazy cen harmonogram dla każdego zaznaczonego sklepu (zapis po adresie + dni transportu).'
          : 'Te same wartości trafią do Bazy stawek dla każdego zaznaczonego sklepu (zapis po adresie).';
      }
      var footer = document.getElementById('bulk-rates-footer-hint');
      if (footer) {
        footer.textContent = isHarm
          ? 'Pusta data znaczy od zawsze. Puste kwoty i 0 są dozwolone. Nazwa trasy i cena za trasę razem albo obie puste.'
          : 'Pusta data znaczy od zawsze. Puste kwoty i 0 są dozwolone.';
      }
      validateBulkRatesFields();
    }
${saveRateRulesSource}
    /** Kwota: puste OK; inaczej tylko cyfry, opcjonalnie przecinek/kropka i do 2 miejsc. */
    function isValidBulkRateAmount(text) {
      return parseRateAmount_(text) !== null;
    }
    function setBulkRateFieldInvalid(el, invalid) {
      if (!el) return;
      if (invalid) {
        el.classList.add('is-invalid');
        el.setAttribute('aria-invalid', 'true');
      } else {
        el.classList.remove('is-invalid');
        el.removeAttribute('aria-invalid');
      }
    }
    /** Podświetla błędne pola i pokazuje komunikat od razu (input/change). Zwraca true gdy OK. */
    function validateBulkRatesFields() {
      var podjazdEl = document.getElementById('bulk-rates-podjazd');
      var worekEl = document.getElementById('bulk-rates-worek');
      var trasaEl = document.getElementById('bulk-rates-trasa');
      var kwotaTrasyEl = document.getElementById('bulk-rates-kwota-trasy');
      var kwotaPodjazd = String((podjazdEl || {}).value || '');
      var kwotaWorek = String((worekEl || {}).value || '');
      var podjazdOk = isValidBulkRateAmount(kwotaPodjazd);
      var worekOk = isValidBulkRateAmount(kwotaWorek);
      setBulkRateFieldInvalid(podjazdEl, !podjazdOk);
      setBulkRateFieldInvalid(worekEl, !worekOk);
      var routePairOk = true;
      var routePriceOk = true;
      var isHarm = getBulkRatesTarget() === 'harmonogram';
      if (isHarm) {
        var nazwaTrasy = String((trasaEl || {}).value || '').trim();
        var kwotaTrasy = String((kwotaTrasyEl || {}).value || '');
        var kwotaTrasyTrim = kwotaTrasy.trim();
        routePairOk = !((nazwaTrasy && !kwotaTrasyTrim) || (!nazwaTrasy && kwotaTrasyTrim));
        routePriceOk = isValidBulkRateAmount(kwotaTrasy);
        setBulkRateFieldInvalid(trasaEl, !routePairOk);
        setBulkRateFieldInvalid(kwotaTrasyEl, !routePairOk || !routePriceOk);
      } else {
        setBulkRateFieldInvalid(trasaEl, false);
        setBulkRateFieldInvalid(kwotaTrasyEl, false);
      }
      var ok = podjazdOk && worekOk && routePairOk && routePriceOk;
      if (!ok) {
        if (!podjazdOk || !worekOk || (isHarm && !routePriceOk && routePairOk)) {
          setBulkRatesStatus('Kwoty mogą zawierać tylko liczby (opcjonalnie z przecinkiem/kropką).', 'error', 'validation');
        } else {
          setBulkRatesStatus('Nazwa trasy i cena za trasę muszą być razem albo obie puste.', 'error', 'validation');
        }
      } else {
        var statusEl = document.getElementById('bulk-rates-status');
        if (statusEl && statusEl.getAttribute('data-status-source') === 'validation') setBulkRatesStatus('');
      }
      return ok;
    }
    function commonBulkShopField(shops, field) {
      var value = null;
      var i;
      for (i = 0; i < shops.length; i++) {
        var v = String(shops[i][field] || '').trim();
        if (!v) continue;
        if (value === null) value = v;
        else if (value !== v) return '';
      }
      return value || '';
    }
    function setBulkRatesStatus(msg, kind, source) {
      var el = document.getElementById('bulk-rates-status');
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = kind === 'error' ? '#b02a37' : '';
      if (!msg) el.removeAttribute('data-status-source');
      else el.setAttribute('data-status-source', source || (kind === 'error' ? 'save' : 'info'));
    }
    function renderBulkRatesPointsList(shops) {
      var listEl = document.getElementById('bulk-rates-points-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      var i;
      for (i = 0; i < shops.length; i++) {
        var li = document.createElement('li');
        li.textContent = shops[i].label;
        listEl.appendChild(li);
      }
    }
    function openBulkRatesModal(indices) {
      if (!transportApiEnabled || !indices || indices.length === 0) return;
      if (typeof postReferencePayload !== 'function') {
        showMapFormError_(
          'MAP-E-RATES-OFFLINE',
          'Brak połączenia z bazą stawek.',
          'Stawki zbiorcze nie zapiszą się, dopóki mapa nie ma adresu TRANSPORT_WEBAPP_URL.',
          'map/browser/bulkRates.ts openBulkRatesModal',
          'brak postReferencePayload'
        );
        return;
      }
      var shops = uniqueBulkShopEntries(indices);
      if (shops.length === 0) {
        showMapFormError_(
          'MAP-E-RATES-NO-ADDRESS',
          'Brak adresów sklepów w zaznaczeniu.',
          'Nie ma czego zapisać. Zaznacz pinezki, które mają adres sklepu.',
          'map/browser/bulkRates.ts openBulkRatesModal',
          'uniqueBulkShopEntries puste'
        );
        return;
      }
      window.__bulkRatesShops = shops;
      renderBulkRatesPointsList(shops);
      var titleEl = document.getElementById('bulk-rates-modal-title');
      if (titleEl) {
        titleEl.textContent = 'Ustaw stawki w bazie (' + shops.length + ' sklepów)';
      }
      var targetStawki = document.querySelector('input[name="bulk-rates-target"][value="stawki"]');
      if (targetStawki) targetStawki.checked = true;
      var commonFirma = commonBulkShopField(shops, 'firmaTransportowa');
      var podInput = document.getElementById('bulk-rates-podwykonawca');
      var podValue = document.getElementById('bulk-rates-podwykonawca-value');
      if (podInput) podInput.value = commonFirma;
      if (podValue) podValue.value = commonFirma;
      var podjazd = document.getElementById('bulk-rates-podjazd');
      var worek = document.getElementById('bulk-rates-worek');
      var trasa = document.getElementById('bulk-rates-trasa');
      var kwotaTrasy = document.getElementById('bulk-rates-kwota-trasy');
      var odKiedy = document.getElementById('bulk-rates-od-kiedy');
      if (podjazd) podjazd.value = '';
      if (worek) worek.value = '';
      if (trasa) trasa.value = '';
      if (kwotaTrasy) kwotaTrasy.value = '';
      if (odKiedy) odKiedy.value = '';
      setDayMultiValue('bulk-rates-dni', commonBulkShopField(shops, 'dniHarmonogramu'));
      syncBulkRatesTargetUi();
      validateBulkRatesFields();
      setBulkRatesStatus('');
      if (typeof fillRateContractorOptions === 'function') fillRateContractorOptions();
      var m = document.getElementById('bulk-rates-modal');
      if (!m) return;
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function closeBulkRatesModal() {
      var m = document.getElementById('bulk-rates-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
      window.__bulkRatesShops = [];
    }
    function saveRateErrorMessage(code) {
      if (code === 'tie') return 'Więcej niż jeden wiersz tej daty. Zapisu nie ma.';
      if (code === 'date') return 'Data w formacie dd.mm.yyyy albo puste.';
      if (code === 'amount') return 'Nieprawidłowa kwota.';
      if (code === 'route') return 'Nazwa trasy i cena za trasę muszą być razem albo obie puste.';
      if (code === 'shop') return 'Wybierz podwykonawcę.';
      if (code === 'no_webapp') return 'Brak adresu Web App.';
      if (code) return 'Zapis nieudany (' + String(code) + ').';
      return 'Zapis nieudany.';
    }
    function runBulkRatesSave() {
      var shops = window.__bulkRatesShops || [];
      if (shops.length === 0) {
        setBulkRatesStatus('Brak zaznaczonych sklepów.', 'error');
        showMapFormError_(
          'MAP-E-BULK-RATES-FORM',
          'Brak zaznaczonych sklepów.',
          'Zapis nie ruszył. Zaznacz pinezki i otwórz stawki ponownie.',
          'map/browser/bulkRates.ts runBulkRatesSave',
          'pusta lista sklepów'
        );
        return;
      }
      if (typeof postReferencePayload !== 'function' || typeof rateValidFromFromPicker !== 'function') {
        setBulkRatesStatus('Brak połączenia z bazą stawek.', 'error');
        showMapFormError_(
          'MAP-E-BULK-RATES-FORM',
          'Brak połączenia z bazą stawek.',
          'Zapis nie ruszył. Mapa nie ma połączenia z rejestrem stawek.',
          'map/browser/bulkRates.ts runBulkRatesSave',
          'brak postReferencePayload albo rateValidFromFromPicker'
        );
        return;
      }
      var target = getBulkRatesTarget();
      var podwykonawca = String((document.getElementById('bulk-rates-podwykonawca-value') || {}).value || '').trim();
      if (!podwykonawca) {
        var podInput = document.getElementById('bulk-rates-podwykonawca');
        if (podInput && typeof tryResolveRateCombobox === 'function' && typeof rateContractorOptions !== 'undefined') {
          tryResolveRateCombobox(podInput, document.getElementById('bulk-rates-podwykonawca-value'), rateContractorOptions);
          podwykonawca = String((document.getElementById('bulk-rates-podwykonawca-value') || {}).value || '').trim();
        }
      }
      if (!podwykonawca) {
        setBulkRatesStatus('Wybierz podwykonawcę z listy.', 'error');
        showMapFormError_(
          'MAP-E-BULK-RATES-FORM',
          'Wybierz podwykonawcę z listy.',
          'Zapis nie ruszył. Wpisz fragment nazwy i wybierz pozycję z listy.',
          'map/browser/bulkRates.ts runBulkRatesSave',
          'pusty podwykonawca'
        );
        return;
      }
      if (!validateBulkRatesFields()) {
        var ratesStatusEl = document.getElementById('bulk-rates-status');
        var ratesSummary = ratesStatusEl ? String(ratesStatusEl.textContent || '').trim() : '';
        showMapFormError_(
          'MAP-E-BULK-RATES-FORM',
          ratesSummary || 'Popraw pola stawek.',
          'Zapis nie ruszył. Popraw podświetlone pola.',
          'map/browser/bulkRates.ts runBulkRatesSave',
          'walidacja formularza stawek'
        );
        return;
      }
      var kwotaPodjazd = String((document.getElementById('bulk-rates-podjazd') || {}).value || '');
      var kwotaWorek = String((document.getElementById('bulk-rates-worek') || {}).value || '');
      var nazwaTrasy = '';
      var kwotaTrasy = '';
      if (target === 'harmonogram') {
        nazwaTrasy = String((document.getElementById('bulk-rates-trasa') || {}).value || '').trim();
        kwotaTrasy = String((document.getElementById('bulk-rates-kwota-trasy') || {}).value || '');
      }
      var odKiedy = rateValidFromFromPicker((document.getElementById('bulk-rates-od-kiedy') || {}).value);
      var dniOdbiorow = String((document.getElementById('bulk-rates-dni') || {}).value || '').trim();
      var okBtn = document.getElementById('bulk-rates-btn-ok');
      if (okBtn) okBtn.disabled = true;
      setBulkRatesStatus('Zapisuję 0/' + shops.length + '…');
      setTransportDatesLoading(true, 'Zapisuję stawki…');
      var done = 0;
      function finishBulkRatesSave(ok) {
        setTransportDatesLoading(false);
        if (okBtn) okBtn.disabled = false;
        if (!ok) return;
        var savedCount = shops.length;
        closeBulkRatesModal();
        clearBulkSelection();
        showMapNotice(
          'Zapisano stawki dla ' + savedCount + ' sklepów.\\nPodwykonawca: ' + podwykonawca +
            (target === 'harmonogram' ? '\\nŹródło: baza cen harmonogram' : '\\nŹródło: baza stawek'),
          'ok'
        );
      }
      function reportBulkRatesStop_(shop, resp, err) {
        if ((resp && resp.status === 401) || (err && err.status === 401)) return;
        var savedBefore = done;
        var label = shop && (shop.label || shop.adres) ? String(shop.label || shop.adres) : '';
        var reason = err
          ? String(err && err.message || err)
          : saveRateErrorMessage(resp && resp.error);
        var partial = savedBefore > 0;
        setBulkRatesStatus(reason, 'error', 'save');
        mapApiErrorCard_({
          code: partial ? 'MAP-E-BULK-RATES-PARTIAL' : 'MAP-E-BULK-RATES',
          summary: partial
            ? 'Zapis stawek przerwany. Wcześniejsze sklepy są już w arkuszu.'
            : 'Nie udało się zapisać stawek.',
          effect: 'Przerwano przy sklepie ' + (savedBefore + 1) + '/' + shops.length
            + (label ? ' (' + label + ')' : '')
            + (partial ? '. Zapisane wcześniej: ' + savedBefore + '.' : '. Żaden sklep z tej serii nie został zapisany.'),
          place: 'map/browser/bulkRates.ts runBulkRatesSave',
          technical: String((resp && resp.notJson && resp.technical) || (resp && resp.error) || reason)
        }, resp, err);
      }
      function saveNext() {
        if (done >= shops.length) {
          finishBulkRatesSave(true);
          return;
        }
        var shop = shops[done];
        var progress = 'Zapisuję ' + (done + 1) + '/' + shops.length + '…';
        setBulkRatesStatus(progress);
        syncMapLoaderUi(progress);
        var payload = {
          mode: target === 'harmonogram' ? 'saveRateHarmonogram' : 'saveRate',
          sklep: shop.adres,
          podwykonawca: podwykonawca,
          kwotaPodjazd: kwotaPodjazd,
          kwotaWorek: kwotaWorek,
          odKiedy: odKiedy
        };
        if (target === 'harmonogram') {
          payload.dniOdbiorow = dniOdbiorow;
          payload.nazwaTrasy = nazwaTrasy;
          payload.kwotaTrasy = kwotaTrasy;
        }
        postReferencePayload(payload).then(function (resp) {
          if (!resp || !resp.ok) {
            finishBulkRatesSave(false);
            reportBulkRatesStop_(shop, resp, null);
            return;
          }
          done += 1;
          saveNext();
        }).catch(function (err) {
          finishBulkRatesSave(false);
          reportBulkRatesStop_(shop, null, err);
        });
      }
      saveNext();
    }
`;
}

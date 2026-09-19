/**
 * Panel ręcznego dodawania do wspólnej listy podwykonawców i poprawek adresów (mapa plomb).
 */

import { referenceFormatsBrowserScript } from './referenceFormats.js';
import { POLISH_VOIVODESHIPS } from './polishVoivodeships.js';

function wojewodztwoSelectOptionsHtml(): string {
  return (
    '<option value="">— wybierz —</option>' +
    POLISH_VOIVODESHIPS.map((w) => `<option value="${w}">${w}</option>`).join('')
  );
}

export function manualAdminCss(): string {
  return `
    .map-manual-add-btn {
      width: 100%;
      padding: 10px 12px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 10px;
      border: 1px solid #0f766e;
      background: #0d9488;
      color: #fff;
      cursor: pointer;
      margin-top: 10px;
      box-shadow: 0 1px 3px rgba(15, 118, 110, 0.28);
    }
    .map-manual-add-btn:hover { background: #0f766e; border-color: #0f766e; color: #fff; filter: brightness(1.03); }
    .map-popraw-adres-btn {
      width: 100%;
      margin-top: 8px;
      padding: 8px 12px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 10px;
      border: 1px solid rgba(13, 148, 136, 0.45);
      background: var(--map-accent-soft);
      color: var(--map-accent-deep);
      cursor: pointer;
    }
    .map-popraw-adres-btn:hover { background: var(--map-accent); border-color: var(--map-accent-deep); color: #fff; }
    #manual-admin-modal .doc-modal-panel { padding: 20px 22px 18px; }
    .manual-admin-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
    .manual-admin-tabs button {
      flex: 1; min-width: 0; padding: 9px 8px; font-size: 12px; font-weight: 600;
      border: 1px solid transparent; background: rgba(148, 163, 184, 0.16); color: #475569; border-radius: 8px; cursor: pointer;
    }
    .manual-admin-tabs button.active { background: var(--map-accent); color: #fff; border-color: var(--map-accent-deep); }
    .manual-admin-panel { display: none; }
    .manual-admin-panel.active { display: block; }
    .manual-admin-panel label { display: block; font-size: 12px; font-weight: 600; margin: 10px 0 5px; }
    .manual-admin-panel input, .manual-admin-panel textarea, .manual-admin-panel select {
      width: 100%; padding: 9px 11px; font-size: 13px; border: 1px solid rgba(148, 163, 184, 0.55); border-radius: 10px;
      box-sizing: border-box; background: rgba(255,255,255,0.92); color: var(--map-ink); outline: none;
    }
    .manual-admin-panel input:focus, .manual-admin-panel textarea:focus, .manual-admin-panel select:focus {
      border-color: var(--map-accent); box-shadow: 0 0 0 3px var(--map-accent-soft);
    }
    .manual-admin-coords-row { display: flex; gap: 10px; }
    .manual-admin-coords-row > div { flex: 1; }
    .manual-admin-status { font-size: 12px; margin: 12px 0 0; min-height: 1.2em; color: var(--map-accent-deep); }
    .manual-admin-status.is-error { color: #b02a37; }
    .manual-admin-submit {
      width: 100%; margin-top: 14px; padding: 10px 14px; font-size: 13px; font-weight: 600;
      border-radius: 10px; border: 1px solid var(--map-accent-deep); background: var(--map-accent); color: #fff; cursor: pointer;
      box-shadow: 0 1px 3px rgba(15, 118, 110, 0.28);
    }
    .manual-admin-submit:hover { background: var(--map-accent-deep); }
    .manual-admin-submit:disabled { opacity: 0.75; cursor: wait; }
    .manual-admin-hint { font-size: 11px; color: #64748b; margin: 8px 0 0; line-height: 1.4; }
  `;
}

export function manualAdminHtml(): string {
  return `  <div id="manual-admin-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="manual-admin-title">
      <h3 id="manual-admin-title">Dodaj dane ręcznie</h3>
      <p class="doc-modal-hint">Wspólna lista podwykonawców (Kto odbiera / Miejsce dostawy) oraz poprawki adresów — zapis w arkuszu transportów.</p>
      <div class="manual-admin-tabs" role="tablist">
        <button type="button" id="manual-admin-tab-lista" class="active" data-tab="lista">Lista podwykonawców</button>
        <button type="button" id="manual-admin-tab-popraw" data-tab="popraw">Popraw adres</button>
        <button type="button" id="manual-admin-tab-stawki" data-tab="stawki">Baza stawek</button>
      </div>
      <div id="manual-admin-panel-lista" class="manual-admin-panel active">
        <label for="manual-admin-lista-nazwa">Nazwa (combobox)</label>
        <input type="text" id="manual-admin-lista-nazwa" autocomplete="off" placeholder="np. BLUECARGO" />
        <label for="manual-admin-lista-protokol">Nazwa do protokołu</label>
        <input type="text" id="manual-admin-lista-protokol" autocomplete="off" placeholder="np. BLUECARGO Sp. z o.o." />
        <label for="manual-admin-lista-adres">Adres</label>
        <input type="text" id="manual-admin-lista-adres" autocomplete="off" placeholder="np. Rajska 3, 54-028 Wrocław" />
        <label for="manual-admin-lista-nip">NIP</label>
        <input type="text" id="manual-admin-lista-nip" autocomplete="off" />
        <label for="manual-admin-lista-bdo">BDO</label>
        <input type="text" id="manual-admin-lista-bdo" autocomplete="off" />
        <p class="manual-admin-hint">Pola są sklejane do kolumny „Dane do Worda” w arkuszu (nazwa, adres, BDO, NIP).</p>
        <button type="button" id="manual-admin-lista-submit" class="manual-admin-submit">Zapisz na liście</button>
      </div>
      <div id="manual-admin-panel-popraw" class="manual-admin-panel">
        <label for="manual-admin-popraw-podmiot">Podmiot handlowy</label>
        <input type="text" id="manual-admin-popraw-podmiot" autocomplete="off" />
        <label for="manual-admin-popraw-sklep">Sklep</label>
        <input type="text" id="manual-admin-popraw-sklep" autocomplete="off" />
        <label for="manual-admin-popraw-adres">Adres (kanoniczny)</label>
        <input type="text" id="manual-admin-popraw-adres" autocomplete="off" />
        <div class="manual-admin-coords-row">
          <div>
            <label for="manual-admin-popraw-lat">Lat</label>
            <input type="text" id="manual-admin-popraw-lat" inputmode="decimal" autocomplete="off" />
          </div>
          <div>
            <label for="manual-admin-popraw-lon">Lon</label>
            <input type="text" id="manual-admin-popraw-lon" inputmode="decimal" autocomplete="off" />
          </div>
        </div>
        <label for="manual-admin-popraw-wojewodztwo">Województwo</label>
        <select id="manual-admin-popraw-wojewodztwo" aria-label="Województwo">
          ${wojewodztwoSelectOptionsHtml()}
        </select>
        <label for="manual-admin-popraw-uwagi">Uwagi</label>
        <input type="text" id="manual-admin-popraw-uwagi" autocomplete="off" />
        <button type="button" id="manual-admin-popraw-submit" class="manual-admin-submit">Zapisz poprawkę adresu</button>
      </div>
      <div id="manual-admin-panel-stawki" class="manual-admin-panel">
        <label for="manual-admin-stawki-sklep">Sklep</label>
        <select id="manual-admin-stawki-sklep" aria-label="Sklep">
          <option value="">— wybierz adres —</option>
        </select>
        <label for="manual-admin-stawki-podwykonawca">Podwykonawca</label>
        <select id="manual-admin-stawki-podwykonawca" aria-label="Podwykonawca">
          <option value="">— wybierz podwykonawcę —</option>
        </select>
        <label for="manual-admin-stawki-podjazd">Kwota za podjazd</label>
        <input type="text" id="manual-admin-stawki-podjazd" inputmode="decimal" autocomplete="off" />
        <label for="manual-admin-stawki-worek">Kwota za worek</label>
        <input type="text" id="manual-admin-stawki-worek" inputmode="decimal" autocomplete="off" />
        <label for="manual-admin-stawki-od-kiedy">Od kiedy obowiązuje</label>
        <input type="text" id="manual-admin-stawki-od-kiedy" autocomplete="off" placeholder="dd.mm.yyyy" />
        <p class="manual-admin-hint">Adres z pinezek mapy, podwykonawca z nazw krótkich. Zapis od razu, bez przebudowy mapy. Pusta data znaczy od zawsze.</p>
        <button type="button" id="manual-admin-stawki-submit" class="manual-admin-submit">Zapisz stawkę</button>
      </div>
      <p id="manual-admin-status" class="manual-admin-status" aria-live="polite"></p>
      <div class="doc-modal-actions">
        <button type="button" id="manual-admin-close">Zamknij</button>
      </div>
    </div>
  </div>
`;
}

export function manualAdminBrowserScript(): string {
  return `
${referenceFormatsBrowserScript()}
    function setManualAdminStatus(msg, kind) {
      var el = document.getElementById('manual-admin-status');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.remove('is-error');
      if (kind === 'error') el.classList.add('is-error');
    }

    function postReferencePayload(payload) {
      if (!TRANSPORT_WEBAPP_URL) {
        return Promise.resolve({ ok: false, error: 'no_webapp' });
      }
      return fetch(TRANSPORT_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function(res) { return res.json(); });
    }

    function hasPodwykoLabel(label) {
      var i;
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        if (PODWYKOLISTA[i].label === label) return true;
      }
      return false;
    }

    function applyReferencePodwykoEntry(entry) {
      if (!entry) return;
      var label = entry.nazwa || entry.label;
      var dane = entry.dane || label;
      if (!label) return;
      if (hasPodwykoLabel(label)) return;
      PODWYKOLISTA.push({ label: label, dane: dane });
    }

    function loadReferenceDataFromWebApp() {
      if (!TRANSPORT_WEBAPP_URL) return Promise.resolve();
      var sep = TRANSPORT_WEBAPP_URL.indexOf('?') >= 0 ? '&' : '?';
      return fetch(TRANSPORT_WEBAPP_URL + sep + 'action=listReferenceData')
        .then(function(r) { return r.json(); })
        .then(function(resp) {
          if (!resp || !resp.ok || !resp.data) return;
          if (resp.data.podwykoLista) {
            (resp.data.podwykoLista || []).forEach(applyReferencePodwykoEntry);
          } else {
            (resp.data.przewoznicy || []).forEach(function(item) {
              applyReferencePodwykoEntry({
                nazwa: item.nazwaWyswietlana,
                dane: item.nazwaDoProtokolu || item.nazwaWyswietlana
              });
            });
            (resp.data.miejscaDostawy || []).forEach(applyReferencePodwykoEntry);
          }
          fillRateContractorOptions();
        })
        .catch(function() {});
    }

    function parseManualLatLon(latId, lonId) {
      var latRaw = String((document.getElementById(latId) || {}).value || '').trim();
      var lonRaw = String((document.getElementById(lonId) || {}).value || '').trim();
      if (!latRaw || !lonRaw) return { error: 'Podaj Lat i Lon.' };
      var lat = parseFloat(latRaw.replace(',', '.'));
      var lon = parseFloat(lonRaw.replace(',', '.'));
      if (isNaN(lat) || isNaN(lon)) return { error: 'Nieprawidłowe współrzędne.' };
      return { lat: lat, lon: lon };
    }

    function setPoprawWojewodztwoSelect(value) {
      var sel = document.getElementById('manual-admin-popraw-wojewodztwo');
      if (!sel) return;
      var v = String(value || '').trim();
      if (v === 'Nieznane') v = '';
      sel.value = v;
      if (sel.value !== v) sel.value = '';
    }

    function openManualAdminModal(tab) {
      var modal = document.getElementById('manual-admin-modal');
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      setManualAdminTab(tab || 'lista');
      setManualAdminStatus('');
    }

    function closeManualAdminModal() {
      var modal = document.getElementById('manual-admin-modal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function uniqueSortedLabels(list) {
      var seen = {};
      var out = [];
      var i;
      for (i = 0; i < list.length; i++) {
        var value = String(list[i] || '').trim();
        if (!value || seen[value]) continue;
        seen[value] = true;
        out.push(value);
      }
      out.sort(function(a, b) { return a.localeCompare(b, 'pl'); });
      return out;
    }

    function fillRateSelect(selectId, values, placeholder) {
      var sel = document.getElementById(selectId);
      if (!sel) return;
      var current = sel.value;
      sel.innerHTML = '';
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = placeholder;
      sel.appendChild(empty);
      var i;
      for (i = 0; i < values.length; i++) {
        var opt = document.createElement('option');
        opt.value = values[i];
        opt.textContent = values[i];
        sel.appendChild(opt);
      }
      if (current) sel.value = current;
    }

    function fillRateShopOptions() {
      var addrs = [];
      var i;
      if (typeof adresy === 'undefined' || !adresy) {
        fillRateSelect('manual-admin-stawki-sklep', [], '— wybierz adres —');
        return;
      }
      for (i = 0; i < adresy.length; i++) {
        addrs.push(adresy[i] && adresy[i].adres);
      }
      fillRateSelect('manual-admin-stawki-sklep', uniqueSortedLabels(addrs), '— wybierz adres —');
    }

    function fillRateContractorOptions() {
      var names = [];
      var i;
      if (typeof PODWYKOLISTA === 'undefined' || !PODWYKOLISTA) {
        fillRateSelect('manual-admin-stawki-podwykonawca', [], '— wybierz podwykonawcę —');
        return;
      }
      for (i = 0; i < PODWYKOLISTA.length; i++) {
        names.push(PODWYKOLISTA[i] && PODWYKOLISTA[i].label);
      }
      fillRateSelect('manual-admin-stawki-podwykonawca', uniqueSortedLabels(names), '— wybierz podwykonawcę —');
    }

    function setManualAdminTab(tab) {
      ['lista', 'popraw', 'stawki'].forEach(function(name) {
        var panel = document.getElementById('manual-admin-panel-' + name);
        var btn = document.getElementById('manual-admin-tab-' + name);
        var active = name === tab;
        if (panel) panel.classList.toggle('active', active);
        if (btn) btn.classList.toggle('active', active);
      });
      if (tab === 'stawki') {
        fillRateShopOptions();
        fillRateContractorOptions();
      }
    }

    function openPoprawAdresFromPoint(point) {
      openManualAdminModal('popraw');
      var podmiot = document.getElementById('manual-admin-popraw-podmiot');
      var sklep = document.getElementById('manual-admin-popraw-sklep');
      var adres = document.getElementById('manual-admin-popraw-adres');
      var lat = document.getElementById('manual-admin-popraw-lat');
      var lon = document.getElementById('manual-admin-popraw-lon');
      if (podmiot) podmiot.value = point && point.podmiotHandlowy ? point.podmiotHandlowy : '';
      if (sklep) sklep.value = point && point.sklep ? point.sklep : '';
      if (adres) adres.value = point && point.adres ? point.adres : '';
      if (lat) lat.value = point && point.lat != null ? String(point.lat) : '';
      if (lon) lon.value = point && point.lng != null ? String(point.lng) : '';
      setPoprawWojewodztwoSelect(point && point.woj ? point.woj : '');
    }

    function bindManualAdminUi() {
      ['manual-admin-tab-lista', 'manual-admin-tab-popraw', 'manual-admin-tab-stawki'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', function() {
          setManualAdminTab(btn.getAttribute('data-tab') || 'lista');
        });
      });
      var closeBtn = document.getElementById('manual-admin-close');
      if (closeBtn) closeBtn.addEventListener('click', closeManualAdminModal);
      var openBtn = document.getElementById('map-manual-admin-open');
      if (openBtn) openBtn.addEventListener('click', function() { openManualAdminModal('lista'); });

      var listaSubmit = document.getElementById('manual-admin-lista-submit');
      if (listaSubmit) {
        listaSubmit.addEventListener('click', function() {
          var nazwa = String((document.getElementById('manual-admin-lista-nazwa') || {}).value || '').trim();
          var protokol = String((document.getElementById('manual-admin-lista-protokol') || {}).value || '').trim();
          var adres = String((document.getElementById('manual-admin-lista-adres') || {}).value || '').trim();
          var nip = String((document.getElementById('manual-admin-lista-nip') || {}).value || '').trim();
          var bdo = String((document.getElementById('manual-admin-lista-bdo') || {}).value || '').trim();
          if (!nazwa && !protokol && !adres && !nip && !bdo) {
            setManualAdminStatus('Podaj co najmniej nazwę lub dane podwykonawcy.', 'error');
            return;
          }
          if (!nazwa) nazwa = protokol || adres;
          if (!protokol) protokol = nazwa;
          var dane = formatPodwykoForWordJs({
            nazwaDoProtokolu: protokol,
            adres: adres,
            nip: nip,
            bdo: bdo
          });
          listaSubmit.disabled = true;
          postReferencePayload({
            mode: 'addReferencePodwyko',
            nazwa: nazwa,
            nazwaDoProtokolu: protokol,
            adres: adres,
            nip: nip,
            bdo: bdo,
            dane: dane
          }).then(function(resp) {
            listaSubmit.disabled = false;
            if (!resp || !resp.ok) {
              setManualAdminStatus(resp && resp.error === 'duplicate' ? 'Duplikat na liście.' : 'Zapis nieudany.', 'error');
              return;
            }
            applyReferencePodwykoEntry(resp.entry);
            setManualAdminStatus('Zapisano na liście podwykonawców.', 'ok');
            document.getElementById('manual-admin-lista-nazwa').value = '';
            document.getElementById('manual-admin-lista-protokol').value = '';
            document.getElementById('manual-admin-lista-adres').value = '';
            document.getElementById('manual-admin-lista-nip').value = '';
            document.getElementById('manual-admin-lista-bdo').value = '';
          });
        });
      }

      var poprawSubmit = document.getElementById('manual-admin-popraw-submit');
      if (poprawSubmit) {
        poprawSubmit.addEventListener('click', function() {
          var adres = String((document.getElementById('manual-admin-popraw-adres') || {}).value || '').trim();
          if (!adres) { setManualAdminStatus('Podaj adres.', 'error'); return; }
          var coords = parseManualLatLon('manual-admin-popraw-lat', 'manual-admin-popraw-lon');
          if (coords.error) { setManualAdminStatus(coords.error, 'error'); return; }
          var wojewodztwo = String((document.getElementById('manual-admin-popraw-wojewodztwo') || {}).value || '').trim();
          poprawSubmit.disabled = true;
          postReferencePayload({
            mode: 'addPoprawAdres',
            podmiotHandlowy: String((document.getElementById('manual-admin-popraw-podmiot') || {}).value || '').trim(),
            sklep: String((document.getElementById('manual-admin-popraw-sklep') || {}).value || '').trim(),
            adres: adres,
            lat: coords.lat,
            lon: coords.lon,
            wojewodztwo: wojewodztwo,
            uwagi: String((document.getElementById('manual-admin-popraw-uwagi') || {}).value || '').trim()
          }).then(function(resp) {
            poprawSubmit.disabled = false;
            if (!resp || !resp.ok) {
              setManualAdminStatus('Zapis poprawki nieudany.', 'error');
              return;
            }
            setManualAdminStatus('Zapisano poprawkę — odśwież mapę (npm run generate), aby zobaczyć pinezkę.', 'ok');
          });
        });
      }

      var stawkiSubmit = document.getElementById('manual-admin-stawki-submit');
      if (stawkiSubmit) {
        stawkiSubmit.addEventListener('click', function() {
          var sklep = String((document.getElementById('manual-admin-stawki-sklep') || {}).value || '').trim();
          var podwykonawca = String((document.getElementById('manual-admin-stawki-podwykonawca') || {}).value || '').trim();
          if (!sklep || !podwykonawca) {
            setManualAdminStatus('Wybierz sklep i podwykonawcę.', 'error');
            return;
          }
          stawkiSubmit.disabled = true;
          postReferencePayload({
            mode: 'saveRate',
            sklep: sklep,
            podwykonawca: podwykonawca,
            kwotaPodjazd: String((document.getElementById('manual-admin-stawki-podjazd') || {}).value || ''),
            kwotaWorek: String((document.getElementById('manual-admin-stawki-worek') || {}).value || ''),
            odKiedy: String((document.getElementById('manual-admin-stawki-od-kiedy') || {}).value || '')
          }).then(function(resp) {
            stawkiSubmit.disabled = false;
            if (!resp || !resp.ok) {
              var code = resp && resp.error;
              var msg = 'Zapis nieudany.';
              if (code === 'tie') msg = 'Więcej niż jeden wiersz tej daty. Zapisu nie ma.';
              if (code === 'date') msg = 'Data w formacie dd.mm.yyyy albo puste.';
              if (code === 'amount') msg = 'Nieprawidłowa kwota.';
              if (code === 'shop') msg = 'Wybierz sklep i podwykonawcę.';
              if (code === 'no_webapp') msg = 'Brak adresu Web App.';
              setManualAdminStatus(msg, 'error');
              return;
            }
            setManualAdminStatus('Zapisano stawkę.', 'ok');
            document.getElementById('manual-admin-stawki-podjazd').value = '';
            document.getElementById('manual-admin-stawki-worek').value = '';
            document.getElementById('manual-admin-stawki-od-kiedy').value = '';
          }).catch(function() {
            stawkiSubmit.disabled = false;
            setManualAdminStatus('Zapis nieudany.', 'error');
          });
        });
      }
    }

    document.addEventListener('DOMContentLoaded', function() {
      bindManualAdminUi();
      loadReferenceDataFromWebApp();
    });
`;
}

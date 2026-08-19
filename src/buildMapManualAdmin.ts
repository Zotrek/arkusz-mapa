/**
 * Panel ręcznego dodawania przewoźników, miejsc dostawy i poprawek adresów (mapa plomb).
 */

export function manualAdminCss(): string {
  return `
    .map-manual-add-btn {
      width: 100%;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px dashed #6366f1;
      background: #eef2ff;
      color: #4338ca;
      cursor: pointer;
      margin-top: 6px;
    }
    .map-manual-add-btn:hover { background: #6366f1; border-color: #6366f1; color: #fff; }
    .map-popraw-adres-btn {
      width: 100%;
      margin-top: 6px;
      padding: 7px 10px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #f59e0b;
      background: #fffbeb;
      color: #b45309;
      cursor: pointer;
    }
    .map-popraw-adres-btn:hover { background: #f59e0b; color: #fff; }
    #manual-admin-modal .doc-modal-panel { padding: 20px 22px 18px; }
    .manual-admin-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
    .manual-admin-tabs button {
      flex: 1; min-width: 0; padding: 9px 8px; font-size: 12px; font-weight: 600;
      border: 1px solid transparent; background: #f1f5f9; border-radius: 6px; cursor: pointer;
    }
    .manual-admin-tabs button.active { background: #fff; color: #0d6efd; border-color: #dbeafe; }
    .manual-admin-panel { display: none; }
    .manual-admin-panel.active { display: block; }
    .manual-admin-panel label { display: block; font-size: 12px; font-weight: 600; margin: 10px 0 5px; }
    .manual-admin-panel input, .manual-admin-panel textarea {
      width: 100%; padding: 9px 11px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px;
    }
    .manual-admin-coords-row { display: flex; gap: 10px; }
    .manual-admin-coords-row > div { flex: 1; }
    .manual-admin-status { font-size: 12px; margin: 12px 0 0; min-height: 1.2em; color: #0d6efd; }
    .manual-admin-status.is-error { color: #b02a37; }
    .manual-admin-submit {
      width: 100%; margin-top: 14px; padding: 10px 14px; font-size: 13px; font-weight: 600;
      border-radius: 6px; border: 1px solid #0d6efd; background: #0d6efd; color: #fff; cursor: pointer;
    }
    .manual-admin-submit:disabled { opacity: 0.75; cursor: wait; }
  `;
}

export function manualAdminHtml(): string {
  return `  <div id="manual-admin-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="manual-admin-title">
      <h3 id="manual-admin-title">Dodaj dane ręcznie</h3>
      <p class="doc-modal-hint">Zapis trwały w arkuszu transportów (zakładki Przewoźnicy, Miejsca dostawy, Popraw adres).</p>
      <div class="manual-admin-tabs" role="tablist">
        <button type="button" id="manual-admin-tab-prz" class="active" data-tab="prz">Przewoźnik</button>
        <button type="button" id="manual-admin-tab-dos" data-tab="dos">Miejsce dostawy</button>
        <button type="button" id="manual-admin-tab-popraw" data-tab="popraw">Popraw adres</button>
      </div>
      <div id="manual-admin-panel-prz" class="manual-admin-panel active">
        <label for="manual-admin-prz-wysw">Nazwa wyświetlana</label>
        <input type="text" id="manual-admin-prz-wysw" autocomplete="off" />
        <label for="manual-admin-prz-protokol">Nazwa do protokołu</label>
        <input type="text" id="manual-admin-prz-protokol" autocomplete="off" />
        <label for="manual-admin-prz-adres">Adres</label>
        <input type="text" id="manual-admin-prz-adres" autocomplete="off" />
        <label for="manual-admin-prz-nip">NIP</label>
        <input type="text" id="manual-admin-prz-nip" autocomplete="off" />
        <label for="manual-admin-prz-bdo">nr BDO</label>
        <input type="text" id="manual-admin-prz-bdo" autocomplete="off" />
        <button type="button" id="manual-admin-prz-submit" class="manual-admin-submit">Zapisz przewoźnika</button>
      </div>
      <div id="manual-admin-panel-dos" class="manual-admin-panel">
        <label for="manual-admin-dos-nazwa">Nazwa (combobox)</label>
        <input type="text" id="manual-admin-dos-nazwa" autocomplete="off" />
        <label for="manual-admin-dos-dane">Dane do Worda</label>
        <textarea id="manual-admin-dos-dane" autocomplete="off"></textarea>
        <button type="button" id="manual-admin-dos-submit" class="manual-admin-submit">Zapisz miejsce dostawy</button>
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
        <label for="manual-admin-popraw-uwagi">Uwagi</label>
        <input type="text" id="manual-admin-popraw-uwagi" autocomplete="off" />
        <button type="button" id="manual-admin-popraw-submit" class="manual-admin-submit">Zapisz poprawkę adresu</button>
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

    function applyReferencePrzewoznikEntry(entry) {
      if (!entry || !entry.nazwaWyswietlana) return;
      var label = entry.nazwaWyswietlana;
      var dane = entry.nazwaDoProtokolu || label;
      if (hasPodwykoLabel(label)) return;
      PODWYKOLISTA.push({ label: label, dane: dane });
    }

    function applyReferenceDostawaEntry(entry) {
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
          (resp.data.przewoznicy || []).forEach(applyReferencePrzewoznikEntry);
          (resp.data.miejscaDostawy || []).forEach(applyReferenceDostawaEntry);
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

    function openManualAdminModal(tab) {
      var modal = document.getElementById('manual-admin-modal');
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      setManualAdminTab(tab || 'prz');
      setManualAdminStatus('');
    }

    function closeManualAdminModal() {
      var modal = document.getElementById('manual-admin-modal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function setManualAdminTab(tab) {
      ['prz', 'dos', 'popraw'].forEach(function(name) {
        var panel = document.getElementById('manual-admin-panel-' + name);
        var btn = document.getElementById('manual-admin-tab-' + name);
        var active = name === tab;
        if (panel) panel.classList.toggle('active', active);
        if (btn) btn.classList.toggle('active', active);
      });
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
    }

    function bindManualAdminUi() {
      ['manual-admin-tab-prz', 'manual-admin-tab-dos', 'manual-admin-tab-popraw'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', function() {
          setManualAdminTab(btn.getAttribute('data-tab') || 'prz');
        });
      });
      var closeBtn = document.getElementById('manual-admin-close');
      if (closeBtn) closeBtn.addEventListener('click', closeManualAdminModal);
      var openBtn = document.getElementById('map-manual-admin-open');
      if (openBtn) openBtn.addEventListener('click', function() { openManualAdminModal('prz'); });

      var przSubmit = document.getElementById('manual-admin-prz-submit');
      if (przSubmit) {
        przSubmit.addEventListener('click', function() {
          var label = String((document.getElementById('manual-admin-prz-wysw') || {}).value || '').trim();
          if (!label) { setManualAdminStatus('Podaj nazwę wyświetlaną.', 'error'); return; }
          przSubmit.disabled = true;
          postReferencePayload({
            mode: 'addReferencePrzewoznik',
            nazwaWyswietlana: label,
            nazwaDoProtokolu: String((document.getElementById('manual-admin-prz-protokol') || {}).value || '').trim() || label,
            adres: String((document.getElementById('manual-admin-prz-adres') || {}).value || '').trim(),
            nip: String((document.getElementById('manual-admin-prz-nip') || {}).value || '').trim(),
            bdo: String((document.getElementById('manual-admin-prz-bdo') || {}).value || '').trim()
          }).then(function(resp) {
            przSubmit.disabled = false;
            if (!resp || !resp.ok) {
              setManualAdminStatus(resp && resp.error === 'duplicate' ? 'Ten przewoźnik już istnieje.' : 'Zapis nieudany.', 'error');
              return;
            }
            applyReferencePrzewoznikEntry(resp.entry);
            setManualAdminStatus('Zapisano przewoźnika.', 'ok');
          });
        });
      }

      var dosSubmit = document.getElementById('manual-admin-dos-submit');
      if (dosSubmit) {
        dosSubmit.addEventListener('click', function() {
          var nazwa = String((document.getElementById('manual-admin-dos-nazwa') || {}).value || '').trim();
          var dane = String((document.getElementById('manual-admin-dos-dane') || {}).value || '').trim();
          if (!nazwa && !dane) { setManualAdminStatus('Podaj nazwę lub dane.', 'error'); return; }
          dosSubmit.disabled = true;
          postReferencePayload({ mode: 'addReferenceDostawa', nazwa: nazwa, dane: dane }).then(function(resp) {
            dosSubmit.disabled = false;
            if (!resp || !resp.ok) {
              setManualAdminStatus(resp && resp.error === 'duplicate' ? 'Duplikat na liście.' : 'Zapis nieudany.', 'error');
              return;
            }
            applyReferenceDostawaEntry(resp.entry);
            setManualAdminStatus('Zapisano miejsce dostawy.', 'ok');
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
          poprawSubmit.disabled = true;
          postReferencePayload({
            mode: 'addPoprawAdres',
            podmiotHandlowy: String((document.getElementById('manual-admin-popraw-podmiot') || {}).value || '').trim(),
            sklep: String((document.getElementById('manual-admin-popraw-sklep') || {}).value || '').trim(),
            adres: adres,
            lat: coords.lat,
            lon: coords.lon,
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
    }

    document.addEventListener('DOMContentLoaded', function() {
      bindManualAdminUi();
      loadReferenceDataFromWebApp();
    });
`;
}

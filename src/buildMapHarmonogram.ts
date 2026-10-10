/**
 * Panel wspólnych harmonogramów na mapie: grupowanie sklepów, cena, awizacja do Bolęcina.
 */

export function harmonogramPanelCss(): string {
  return `
    .map-harmonogram-open-btn {
      width: 100%;
      padding: 10px 12px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 10px;
      border: 1px solid #0f766e;
      background: #fff;
      color: #0f766e;
      cursor: pointer;
      margin-top: 8px;
    }
    .map-harmonogram-open-btn:hover { background: #f0fdfa; }
    #harmonogram-group-modal.harmonogram-overlay {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 21000;
      display: flex; align-items: center; justify-content: center;
    }
    #harmonogram-group-modal[hidden] { display: none !important; }
    #harmonogram-group-modal .harmonogram-panel {
      background: #fff; padding: 18px 20px; border-radius: 14px; width: min(560px, 94vw);
      max-height: calc(100vh - 32px); overflow: auto; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
      font-family: system-ui, "Segoe UI", sans-serif; color: #0f172a;
    }
    #harmonogram-group-modal h3 { margin: 0 0 6px; font-size: 16px; }
    #harmonogram-group-modal h4 { margin: 16px 0 6px; font-size: 13px; }
    #harmonogram-group-modal .harmonogram-hint { margin: 0 0 10px; font-size: 12px; color: #64748b; line-height: 1.4; }
    #harmonogram-group-modal .harmonogram-status { min-height: 1.2em; font-size: 12px; white-space: pre-line; color: #0f766e; }
    #harmonogram-group-modal .harmonogram-status.is-error { color: #b02a37; }
    #harmonogram-group-modal .harmonogram-card {
      border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 10px; padding: 10px 12px; margin: 8px 0;
    }
    #harmonogram-group-modal .harmonogram-card h5 { margin: 0 0 6px; font-size: 13px; }
    #harmonogram-group-modal .harmonogram-bucket {
      border: 1px solid rgba(217, 119, 6, 0.28);
      border-left: 4px solid #d97706;
      border-radius: 12px;
      margin: 10px 0;
      padding: 0;
      overflow: hidden;
      background: linear-gradient(180deg, #fffbeb 0%, #fff 72px);
      box-shadow: 0 1px 2px rgba(120, 53, 15, 0.06);
    }
    #harmonogram-group-modal .harmonogram-bucket-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
      padding: 10px 12px 6px;
    }
    #harmonogram-group-modal .harmonogram-bucket h5 {
      margin: 0; font-size: 13.5px; font-weight: 700; line-height: 1.35; color: #1c1917;
    }
    #harmonogram-group-modal .harmonogram-bucket-count {
      flex-shrink: 0; padding: 3px 8px; border-radius: 999px;
      background: rgba(217, 119, 6, 0.14); color: #92400e;
      font-size: 11px; font-weight: 700; line-height: 1.3; white-space: nowrap;
    }
    #harmonogram-group-modal .harmonogram-day-chips {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 10px;
    }
    #harmonogram-group-modal .harmonogram-day-chip {
      display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
      background: #fff; border: 1px solid rgba(217, 119, 6, 0.4); color: #9a3412;
      font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-shop {
      margin: 0; padding: 8px 12px; border-top: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.72);
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-shop:hover { background: #fff7ed; }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-shop:has(.harmonogram-pick:checked) {
      background: rgba(13, 148, 136, 0.1);
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-shop label {
      display: flex; align-items: flex-start; gap: 8px; width: 100%; margin: 0;
      font-weight: 500; cursor: pointer; line-height: 1.35;
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-pick {
      margin: 2px 0 0; flex-shrink: 0; accent-color: #0d9488;
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-shop-name { min-width: 0; }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-actions {
      margin: 0; padding: 8px 12px 12px; border-top: 1px solid rgba(148, 163, 184, 0.22);
      background: #fff;
    }
    #harmonogram-group-modal .harmonogram-bucket .harmonogram-group { width: 100%; }
    #harmonogram-group-modal label { display: block; font-size: 12px; font-weight: 600; margin: 8px 0 3px; }
    #harmonogram-group-modal input[type="text"] {
      width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.55); font-size: 13px;
    }
    #harmonogram-group-modal .harmonogram-shop { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 12.5px; margin: 4px 0; }
    #harmonogram-group-modal .harmonogram-shop label { margin: 0; font-weight: 500; }
    #harmonogram-group-modal .harmonogram-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    #harmonogram-group-modal button {
      padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.55);
      background: #fff; cursor: pointer; font-size: 12px; font-weight: 600;
    }
    #harmonogram-group-modal button.primary { background: #0d9488; color: #fff; border-color: #0f766e; }
    #harmonogram-group-modal button:disabled { opacity: 0.6; cursor: wait; }
    #harmonogram-group-modal .harmonogram-dates { font-size: 12px; color: #334155; margin: 6px 0 0; }
  `;
}

export function harmonogramPanelHtml(): string {
  return `
  <div id="harmonogram-group-modal" class="harmonogram-overlay" hidden aria-hidden="true">
    <div class="harmonogram-panel" role="dialog" aria-labelledby="harmonogram-group-title">
      <h3 id="harmonogram-group-title">Harmonogramy</h3>
      <p class="harmonogram-hint">Wspólny przejazd dla sklepów z tymi samymi dniami i tym samym podwykonawcą. Cena za trasę jest jedna. Do Bolęcina idzie suma „spodziewanych worków” — puste pole zostaje puste.</p>
      <p id="harmonogram-group-status" class="harmonogram-status" aria-live="polite"></p>
      <div id="harmonogram-group-saved"></div>
      <h4>Do zgrupowania</h4>
      <div id="harmonogram-group-buckets"></div>
      <div class="harmonogram-actions">
        <button type="button" id="harmonogram-group-refresh">Odśwież</button>
        <button type="button" id="harmonogram-group-close">Zamknij</button>
      </div>
    </div>
  </div>
`;
}

export function harmonogramPanelBrowserScript(): string {
  return `
    function harmonogramSetStatus(msg, kind) {
      var el = document.getElementById('harmonogram-group-status');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('is-error', kind === 'error');
    }

    function harmonogramShopLabel(adres) {
      var i;
      if (typeof adresy === 'undefined' || !adresy) return adres;
      for (i = 0; i < adresy.length; i++) {
        if (adresy[i] && adresy[i].adres === adres) {
          return adresy[i].sklep || adresy[i].podmiotHandlowy || adres;
        }
      }
      return adres;
    }

    function harmonogramIsBolecin(text) {
      var combined = String(text || '').toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
        .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z');
      return combined.indexOf('bolecin') >= 0 || combined.indexOf('biosystem') >= 0;
    }

    function harmonogramErrorText(code) {
      var map = {
        zaznacz: 'Zaznacz sklepy z jednego zestawu dni i podwykonawcy.',
        rozne: 'Zaznaczone sklepy mają różne dni albo różnych podwykonawców.',
        brak_dni: 'Brak dni albo podwykonawcy.',
        juz: 'Te sklepy są już w różnych harmonogramach.',
        id: 'Nie ma takiego harmonogramu.',
        amount: 'Cena za trasę jest niepoprawna.',
        nie_bolecin: 'Awizacja do Bolęcina działa, gdy miejsce zrzutu to Bolęcin.',
        brak_sklepow: 'Harmonogram nie ma sklepów.',
        brak_dat: 'Brak dat odbioru w tym oknie.'
      };
      return map[code] || code || 'Nie udało się zapisać.';
    }

    function harmonogramGet() {
      var sep = TRANSPORT_WEBAPP_URL.indexOf('?') >= 0 ? '&' : '?';
      return fetch(TRANSPORT_WEBAPP_URL + sep + 'action=listHarmonogramy').then(function(res) { return res.json(); });
    }

    function harmonogramPost(payload) {
      return fetch(TRANSPORT_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function(res) { return res.json(); });
    }

    function harmonogramField(card, name) {
      var input = card.querySelector('[data-field="' + name + '"]');
      return input ? String(input.value || '') : '';
    }

    function harmonogramSyncBolecin(card) {
      var extra = card.querySelector('.harmonogram-bolecin');
      var awizuj = card.querySelector('.harmonogram-awizuj');
      var miejsce = harmonogramField(card, 'miejsceZrzutu');
      var show = harmonogramIsBolecin(miejsce);
      if (extra) extra.hidden = !show;
      if (awizuj) awizuj.hidden = !show;
    }

    function harmonogramRender(data) {
      var saved = document.getElementById('harmonogram-group-saved');
      var buckets = document.getElementById('harmonogram-group-buckets');
      if (!saved || !buckets) return;
      saved.textContent = '';
      buckets.textContent = '';
      var groups = (data && data.harmonogramy) || [];
      var loose = (data && data.doZgrupowania) || [];
      var i;
      if (!groups.length) {
        saved.appendChild(document.createTextNode('Brak zapisanych harmonogramów.'));
      }
      for (i = 0; i < groups.length; i++) {
        saved.appendChild(harmonogramGroupCard(groups[i]));
      }
      if (!loose.length) {
        var empty = document.createElement('p');
        empty.className = 'harmonogram-hint';
        empty.textContent = 'Wszystkie sklepy z dniami są już w harmonogramie albo nie mają dni.';
        buckets.appendChild(empty);
      }
      for (i = 0; i < loose.length; i++) {
        buckets.appendChild(harmonogramBucketCard(loose[i]));
      }
    }

    function harmonogramGroupCard(group) {
      var card = document.createElement('article');
      card.className = 'harmonogram-card';
      card.setAttribute('data-harm-id', group.id);
      var title = document.createElement('h5');
      title.textContent = group.id + ' · ' + (group.podwykonawca || '') + ' · ' + (group.dni || '');
      card.appendChild(title);
      var shops = group.sklepy || [];
      var s;
      for (s = 0; s < shops.length; s++) {
        var line = document.createElement('div');
        line.className = 'harmonogram-shop';
        var name = document.createElement('span');
        var label = harmonogramShopLabel(shops[s].adres);
        name.textContent = label === shops[s].adres ? label : label + ' — ' + shops[s].adres;
        var detach = document.createElement('button');
        detach.type = 'button';
        detach.className = 'harmonogram-detach';
        detach.textContent = 'Odłącz';
        detach.setAttribute('data-rows', (shops[s].rows || []).join(','));
        detach.setAttribute('data-adres', shops[s].adres || '');
        line.appendChild(name);
        line.appendChild(detach);
        card.appendChild(line);
      }
      card.appendChild(harmonogramInput('Cena za trasę', 'cenaTrasy', group.cenaTrasy || ''));
      card.appendChild(harmonogramInput('Miejsce zrzutu', 'miejsceZrzutu', group.miejsceZrzutu || ''));
      var extra = document.createElement('div');
      extra.className = 'harmonogram-bolecin';
      extra.appendChild(harmonogramInput('Okno awizacji', 'oknoAwizacji', group.oknoAwizacji || ''));
      extra.appendChild(harmonogramInput('Dane do awizacji', 'awizacja', group.awizacja || ''));
      extra.appendChild(harmonogramInput('Rodzaj zbiórki', 'rodzajZbiorki', group.rodzajZbiorki || ''));
      extra.appendChild(harmonogramInput('Rodzaj transportu', 'rodzajTransportu', group.rodzajTransportu || ''));
      extra.appendChild(harmonogramInput('Spodziewane worki', 'spodziewaneWorki', group.spodziewaneWorki || ''));
      card.appendChild(extra);
      var dates = document.createElement('p');
      dates.className = 'harmonogram-dates';
      dates.textContent = (group.daty && group.daty.length) ? 'Daty awizacji: ' + group.daty.join(', ') : 'Brak dat w tym oknie.';
      card.appendChild(dates);
      var actions = document.createElement('div');
      actions.className = 'harmonogram-actions';
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'primary harmonogram-save';
      save.textContent = 'Zapisz';
      var awizuj = document.createElement('button');
      awizuj.type = 'button';
      awizuj.className = 'harmonogram-awizuj';
      awizuj.textContent = 'Awizuj do Bolęcina';
      actions.appendChild(save);
      actions.appendChild(awizuj);
      card.appendChild(actions);
      var miejsce = card.querySelector('[data-field="miejsceZrzutu"]');
      if (miejsce) {
        miejsce.addEventListener('input', function() { harmonogramSyncBolecin(card); });
      }
      harmonogramSyncBolecin(card);
      return card;
    }

    function harmonogramInput(labelText, field, value) {
      var wrap = document.createElement('label');
      wrap.textContent = labelText;
      var input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-field', field);
      input.value = value;
      wrap.appendChild(input);
      return wrap;
    }

    function harmonogramShopCountLabel(n) {
      var abs = Math.abs(n);
      var mod10 = abs % 10;
      var mod100 = abs % 100;
      if (abs === 1) return '1 sklep';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return n + ' sklepy';
      return n + ' sklepów';
    }

    function harmonogramDayChips(dni) {
      var wrap = document.createElement('div');
      wrap.className = 'harmonogram-day-chips';
      var parts = String(dni || '').split(',');
      var i;
      for (i = 0; i < parts.length; i++) {
        var day = parts[i].trim();
        if (!day) continue;
        var chip = document.createElement('span');
        chip.className = 'harmonogram-day-chip';
        chip.textContent = day;
        wrap.appendChild(chip);
      }
      return wrap;
    }

    function harmonogramSyncGroupButton(card) {
      var button = card.querySelector('.harmonogram-group');
      if (!button) return;
      var n = card.querySelectorAll('.harmonogram-pick:checked').length;
      button.textContent = n ? 'Grupuj zaznaczone (' + n + ')' : 'Grupuj zaznaczone';
    }

    function harmonogramBucketCard(bucket) {
      var card = document.createElement('article');
      card.className = 'harmonogram-bucket';
      var shops = bucket.sklepy || [];
      var head = document.createElement('div');
      head.className = 'harmonogram-bucket-head';
      var title = document.createElement('h5');
      title.textContent = bucket.podwykonawca || 'Bez podwykonawcy';
      var count = document.createElement('span');
      count.className = 'harmonogram-bucket-count';
      count.textContent = harmonogramShopCountLabel(shops.length);
      head.appendChild(title);
      head.appendChild(count);
      card.appendChild(head);
      var chips = harmonogramDayChips(bucket.dni);
      if (chips.childNodes.length) card.appendChild(chips);
      var s;
      for (s = 0; s < shops.length; s++) {
        var line = document.createElement('div');
        line.className = 'harmonogram-shop';
        var label = document.createElement('label');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'harmonogram-pick';
        box.setAttribute('data-rows', (shops[s].rows || []).join(','));
        var text = document.createElement('span');
        text.className = 'harmonogram-shop-name';
        var shopLabel = harmonogramShopLabel(shops[s].adres);
        text.textContent = shopLabel === shops[s].adres ? shopLabel : shopLabel + ' — ' + shops[s].adres;
        label.appendChild(box);
        label.appendChild(text);
        line.appendChild(label);
        card.appendChild(line);
      }
      card.addEventListener('change', function() { harmonogramSyncGroupButton(card); });
      var actions = document.createElement('div');
      actions.className = 'harmonogram-actions';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary harmonogram-group';
      button.textContent = 'Grupuj zaznaczone';
      actions.appendChild(button);
      card.appendChild(actions);
      return card;
    }

    function harmonogramLoad() {
      harmonogramSetStatus('Ładowanie…', '');
      return harmonogramGet().then(function(data) {
        if (!data || data.ok === false) {
          harmonogramSetStatus(harmonogramErrorText(data && data.error), 'error');
          return;
        }
        harmonogramRender(data);
        harmonogramSetStatus('', '');
      }).catch(function() {
        harmonogramSetStatus('Nie udało się pobrać harmonogramów.', 'error');
      });
    }

    function harmonogramOpen() {
      var modal = document.getElementById('harmonogram-group-modal');
      if (!modal) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      harmonogramLoad();
    }

    function harmonogramClose() {
      var modal = document.getElementById('harmonogram-group-modal');
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }

    function harmonogramRowsFrom(el) {
      return String(el.getAttribute('data-rows') || '').split(',').filter(Boolean).map(function(n) { return Number(n); });
    }

    var harmonogramModal = document.getElementById('harmonogram-group-modal');
    if (harmonogramModal) {
      harmonogramModal.addEventListener('click', function(ev) {
        var target = ev.target;
        if (!(target instanceof Element)) return;
        if (target.id === 'harmonogram-group-modal') harmonogramClose();
        if (target.id === 'harmonogram-group-close') harmonogramClose();
        if (target.id === 'harmonogram-group-refresh') harmonogramLoad();
        var groupBtn = target.closest('.harmonogram-group');
        if (groupBtn) {
          var bucket = groupBtn.closest('.harmonogram-bucket');
          var boxes = bucket ? bucket.querySelectorAll('.harmonogram-pick:checked') : [];
          var rows = [];
          var b;
          for (b = 0; b < boxes.length; b++) rows = rows.concat(harmonogramRowsFrom(boxes[b]));
          groupBtn.disabled = true;
          harmonogramPost({ mode: 'groupHarmonogram', rows: rows }).then(function(resp) {
            groupBtn.disabled = false;
            if (!resp || resp.ok === false) {
              harmonogramSetStatus(harmonogramErrorText(resp && resp.error), 'error');
              return;
            }
            return harmonogramLoad().then(function() {
              harmonogramSetStatus('Zapisano harmonogram ' + (resp.id || '') + '.', '');
            });
          }).catch(function() {
            groupBtn.disabled = false;
            harmonogramSetStatus('Nie udało się zgrupować.', 'error');
          });
        }
        var detachBtn = target.closest('.harmonogram-detach');
        if (detachBtn) {
          detachBtn.disabled = true;
          harmonogramPost({ mode: 'ungroupHarmonogram', rows: harmonogramRowsFrom(detachBtn) }).then(function(resp) {
            detachBtn.disabled = false;
            if (!resp || resp.ok === false) {
              harmonogramSetStatus(harmonogramErrorText(resp && resp.error), 'error');
              return;
            }
            harmonogramLoad();
          }).catch(function() {
            detachBtn.disabled = false;
            harmonogramSetStatus('Nie udało się odłączyć sklepu.', 'error');
          });
        }
        var saveBtn = target.closest('.harmonogram-save');
        if (saveBtn) {
          var card = saveBtn.closest('.harmonogram-card');
          if (!card) return;
          saveBtn.disabled = true;
          harmonogramPost({
            mode: 'saveHarmonogram',
            id: card.getAttribute('data-harm-id'),
            cenaTrasy: harmonogramField(card, 'cenaTrasy'),
            miejsceZrzutu: harmonogramField(card, 'miejsceZrzutu'),
            oknoAwizacji: harmonogramField(card, 'oknoAwizacji'),
            awizacja: harmonogramField(card, 'awizacja'),
            rodzajZbiorki: harmonogramField(card, 'rodzajZbiorki'),
            rodzajTransportu: harmonogramField(card, 'rodzajTransportu'),
            spodziewaneWorki: harmonogramField(card, 'spodziewaneWorki')
          }).then(function(resp) {
            saveBtn.disabled = false;
            if (!resp || resp.ok === false) {
              harmonogramSetStatus(harmonogramErrorText(resp && resp.error), 'error');
              return;
            }
            return harmonogramLoad().then(function() {
              harmonogramSetStatus('Zapisano ' + (resp.id || '') + '.', '');
            });
          }).catch(function() {
            saveBtn.disabled = false;
            harmonogramSetStatus('Nie udało się zapisać harmonogramu.', 'error');
          });
        }
        var awizujBtn = target.closest('.harmonogram-awizuj');
        if (awizujBtn) {
          var awCard = awizujBtn.closest('.harmonogram-card');
          if (!awCard) return;
          var nazwy = {};
          var shopBoxes = awCard.querySelectorAll('.harmonogram-detach');
          var n;
          for (n = 0; n < shopBoxes.length; n++) {
            var adres = shopBoxes[n].getAttribute('data-adres') || '';
            if (adres) nazwy[adres] = harmonogramShopLabel(adres);
          }
          awizujBtn.disabled = true;
          harmonogramPost({
            mode: 'awizujBolecin',
            id: awCard.getAttribute('data-harm-id'),
            nazwy: nazwy
          }).then(function(resp) {
            awizujBtn.disabled = false;
            if (!resp || resp.ok === false) {
              var raw = resp && resp.error ? String(resp.error) : '';
              harmonogramSetStatus(raw.indexOf('BOLECIN_SHEETS_ID') >= 0 ? raw : harmonogramErrorText(raw), 'error');
              return;
            }
            harmonogramSetStatus('Bolęcin: dopisano ' + resp.dopisane + ', pominięto ' + resp.pominiete + ' (już były).', '');
          }).catch(function() {
            awizujBtn.disabled = false;
            harmonogramSetStatus('Nie udało się awizować do Bolęcina.', 'error');
          });
        }
      });
    }

    var harmonogramOpenBtn = document.getElementById('map-harmonogram-open');
    if (harmonogramOpenBtn) harmonogramOpenBtn.addEventListener('click', harmonogramOpen);
  `;
}

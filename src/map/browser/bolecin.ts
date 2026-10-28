/** Skrypt mapy: Awizacja do Bolęcina. */

export function bolecinBrowserScript(): string {
  return `    function miejsceIsBolecin_(mdOpt) {
      if (!mdOpt) return false;
      return isBolecinPlace(mdOpt.label) || isBolecinPlace(mdOpt.dane);
    }
    function bolecinErrorPlain_(raw) {
      var text = String(raw || '').replace(/^Error:\\s*/, '');
      if (text.indexOf('BOLECIN_SHEETS_ID') >= 0) {
        return 'W skrypcie mapy brakuje właściwości BOLECIN_SHEETS_ID.\\nUstaw ID arkusza Bolęcin: Apps Script → Project settings → Script properties.';
      }
      return text;
    }
    function bolecinResultNote_(bolecinError, choice) {
      var picked = choice || window.__bolecinAwizacjaChoice;
      if (!picked || !picked.add) return '';
      if (bolecinError) {
        return 'Protokół jest zapisany. Awizacja nie weszła do arkusza Bolęcin.\\n' + bolecinErrorPlain_(bolecinError);
      }
      return 'Awizacja dopisana do arkusza Bolęcin.';
    }
    function showAwizacjaNotice_(prefix, bolecinError, choice, forceError) {
      var note = bolecinResultNote_(bolecinError, choice);
      if (bolecinError || forceError) {
        showMapFormError_(
          'MAP-E-BOLECIN',
          bolecinError
            ? 'Protokół jest zapisany. Awizacja nie weszła do arkusza Bolęcin.'
            : (prefix || 'Awizacja do Bolęcina się nie udała.'),
          bolecinError
            ? bolecinErrorPlain_(bolecinError)
            : 'Możesz dalej pracować na mapie. Sprawdź arkusz Bolęcin.',
          'map/browser/bolecin.ts showAwizacjaNotice_',
          String(bolecinError || prefix || 'forceError')
        );
        if (prefix && bolecinError) showMapNotice(prefix, 'ok', null);
        return;
      }
      var message = prefix || '';
      if (note) message = message ? message + '\\n' + note : note;
      if (!message) return;
      showMapNotice(message, 'ok', null);
    }
    function iloscWorkowFromAwizacja_(autoCount) {
      var choice = window.__bolecinAwizacjaChoice;
      if (!choice || !choice.add) return autoCount;
      var raw = choice.worki == null ? '' : String(choice.worki).trim();
      if (raw === '') return autoCount;
      return raw;
    }
    function joinAwizacjaLabels_(values) {
      var seen = {};
      var unique = [];
      var i;
      for (i = 0; i < values.length; i++) {
        var label = String(values[i] || '').replace(/\\s+/g, ' ').trim();
        if (!label) continue;
        var key = label.toLocaleLowerCase('pl');
        if (seen[key]) continue;
        seen[key] = true;
        unique.push(label);
      }
      return unique.join('; ');
    }
    function collectBulkAwizacjaParts_() {
      var rodzajeList = [];
      var worki = 0;
      (window.__docBulkPointJobs || []).forEach(function (job) {
        worki += (job.filteredSeals || []).length;
        var point = adresy[job.pointIdx];
        if (!point) return;
        rodzajeList.push(aggregateRodzajZbiorkiFromSealRows(job.filteredSeals));
      });
      return {
        rodzaj: joinAwizacjaLabels_(rodzajeList),
        worki: String(worki)
      };
    }
    function assignBolecinAwizacja_(payload, mdOpt) {
      var choice = window.__bolecinAwizacjaChoice;
      if (!choice || !choice.add || !miejsceIsBolecin_(mdOpt)) return;
      payload.awizujBolecin = true;
      payload.oknoAwizacji = choice.okno || '';
      payload.awizacja = choice.nr || '';
      payload.rodzajTransportu = choice.rodzaj || '';
      payload.miejsceZrzutuDane = (mdOpt && mdOpt.dane) || '';
      payload.bolecinAdres = choice.adres || '';
      payload.bolecinNazwa = choice.nazwa || '';
    }
    function assignBulkBolecinAwizacja_(payload, mdOpt) {
      var choice = window.__bolecinAwizacjaChoice;
      if (!choice || !choice.add || !miejsceIsBolecin_(mdOpt)) return;
      var parts = collectBulkAwizacjaParts_();
      assignBolecinAwizacja_(payload, mdOpt);
      payload.bolecinRodzajZbiorki = parts.rodzaj;
      var edited = choice.worki == null ? '' : String(choice.worki).trim();
      payload.bolecinWorki = edited || parts.worki;
    }
    function bolecinSummaryLine_(box, label, value) {
      var p = document.createElement('p');
      var strong = document.createElement('strong');
      strong.textContent = label + ': ';
      p.appendChild(strong);
      p.appendChild(document.createTextNode(value || '—'));
      box.appendChild(p);
    }
    function fillBolecinAwizacjaSummary_(form) {
      var box = document.getElementById('bolecin-aw-summary');
      if (!box) return;
      box.innerHTML = '';
      var workiInput = document.getElementById('bolecin-aw-worki');
      var hint = document.getElementById('bolecin-aw-hint');
      var workiHint = document.getElementById('bolecin-aw-worki-hint');
      var adresInput = document.getElementById('bolecin-aw-adres');
      var nazwaInput = document.getElementById('bolecin-aw-nazwa');
      var adresLabel = document.getElementById('bolecin-aw-adres-label');
      var nazwaLabel = document.getElementById('bolecin-aw-nazwa-label');
      var isBulk = window.__docModalMode === 'bulk';
      if (adresInput) adresInput.value = '';
      if (nazwaInput) nazwaInput.value = '';
      if (adresLabel) adresLabel.textContent = isBulk ? 'Adresy odbioru' : 'Adres odbioru';
      if (nazwaLabel) nazwaLabel.textContent = isBulk ? 'Nazwy kontrahentów' : 'Nazwa kontrahenta';
      if (isBulk) {
        var parts = collectBulkAwizacjaParts_();
        if (workiInput) workiInput.value = parts.worki;
        if (hint) hint.textContent = 'Te protokoły jadą do Bolęcina razem. Do arkusza wchodzi jeden wspólny wiersz, a worki są zsumowane.';
        if (workiHint) workiHint.textContent = 'Suma worków ze wszystkich protokołów. Można ją poprawić.';
        bolecinSummaryLine_(box, 'Rodzaj zbiórki', parts.rodzaj);
        bolecinSummaryLine_(box, 'Protokoły', String((window.__docBulkPointJobs || []).length));
      } else {
        if (hint) hint.textContent = 'Ten odbiór jedzie do Bolęcina. Dopisz wiersz do arkusza Bolęcin albo wygeneruj sam protokół.';
        if (workiHint) workiHint.textContent = 'Liczba z worków na protokole. Można ją poprawić.';
        var point = adresy[window.__currentDocPointIdx];
        var seals = window.__docFilteredSeals || (point && point.sealRows) || [];
        if (workiInput) workiInput.value = String(seals.length);
        bolecinSummaryLine_(box, 'Rodzaj zbiórki', aggregateRodzajZbiorkiFromSealRows(seals));
      }
      bolecinSummaryLine_(box, 'Data odbioru', form.dz);
      bolecinSummaryLine_(box, 'Kto odbiera', form.prOpt.label);
      bolecinSummaryLine_(box, 'Miejsce zrzutu', form.mdOpt.label);
    }
    function openBolecinAwizacjaModal_(form) {
      fillBolecinAwizacjaSummary_(form);
      var m = document.getElementById('bolecin-aw-modal');
      if (!m) return;
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
      var nr = document.getElementById('bolecin-aw-nr');
      if (nr) nr.focus();
    }
    function closeBolecinAwizacjaModal_() {
      var m = document.getElementById('bolecin-aw-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    }
    function readBolecinAwizacjaInputs_() {
      function val(id) {
        var el = document.getElementById(id);
        return el ? String(el.value).trim() : '';
      }
      return {
        add: true,
        nr: val('bolecin-aw-nr'),
        okno: val('bolecin-aw-okno'),
        rodzaj: val('bolecin-aw-transport'),
        worki: val('bolecin-aw-worki'),
        adres: val('bolecin-aw-adres'),
        nazwa: val('bolecin-aw-nazwa')
      };
    }
    function formForGenerate_() {
      if (window.__bolecinAwizacjaChoice && window.__bolecinAwizacjaForm) {
        return window.__bolecinAwizacjaForm;
      }
      return parseDocFormValues();
    }
    function offerBolecinAwizacja_(form) {
      if (!transportApiEnabled || !miejsceIsBolecin_(form.mdOpt) || window.__bolecinAwizacjaChoice) return false;
      window.__bolecinAwizacjaForm = form;
      openBolecinAwizacjaModal_(form);
      return true;
    }
    function acceptBolecinAwizacja_(add) {
      window.__bolecinAwizacjaChoice = add ? readBolecinAwizacjaInputs_() : { add: false };
      closeBolecinAwizacjaModal_();
      runDocGenerate();
    }
`;
}

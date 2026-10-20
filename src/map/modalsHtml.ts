/** Okna mapy (Word, Bolęcin, stawki zbiorcze) i nakładki API transportu. */

import { harmonogramDaysPickerHtml } from '../harmonogramDays.js';

export function transportOverlayHtml(): string {
  return `  <div id="map-transport-loader" class="map-transport-loader" role="status" aria-live="polite" aria-busy="true">
    <div class="map-transport-loader-panel">
      <img class="map-transport-loader-logo" src="./favicon.svg" alt="" width="64" height="64">
      <span id="map-transport-loader-label">Pobieranie danych transportu…</span>
    </div>
  </div>
  <div id="map-app-notice" class="map-app-notice" role="status" aria-live="polite" hidden>
    <p id="map-app-notice-text" class="map-app-notice-text"></p>
    <button type="button" id="map-app-notice-close" class="map-app-notice-close" hidden>Zamknij</button>
  </div>
`;
}

export function wordModalHtml(): string {
  return `  <div id="doc-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="doc-modal-title">
      <h3 id="doc-modal-title">Generuj dokument Word</h3>
      <label for="doc-sel-przewoznik">Przewoźnik</label>
      <div class="doc-combobox-wrap">
        <input type="text" id="doc-sel-przewoznik" class="doc-combobox-input" autocomplete="off" spellcheck="false" placeholder="Wpisz fragment nazwy lub danych…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="doc-sel-przewoznik-list" />
        <input type="hidden" id="doc-val-przewoznik" value="" />
        <ul id="doc-sel-przewoznik-list" class="doc-combobox-list" role="listbox" hidden></ul>
      </div>
      <label for="doc-sel-miejsce">Miejsce dostawy</label>
      <div class="doc-combobox-wrap">
        <input type="text" id="doc-sel-miejsce" class="doc-combobox-input" autocomplete="off" spellcheck="false" placeholder="Wpisz fragment nazwy lub danych…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="doc-sel-miejsce-list" />
        <input type="hidden" id="doc-val-miejsce" value="" />
        <ul id="doc-sel-miejsce-list" class="doc-combobox-list" role="listbox" hidden></ul>
      </div>
      <label for="doc-inp-data-zaladunku">Data załadunku</label>
      <input type="date" id="doc-inp-data-zaladunku" />
      <div id="doc-bulk-points-wrap" class="doc-bulk-points-wrap" hidden>
        <p class="doc-bulk-points-title">Wybrane punkty</p>
        <ul id="doc-bulk-points-list" class="doc-bulk-points-list"></ul>
      </div>
      <div id="doc-single-numer-wrap">
        <label for="doc-inp-numer-zlecenia">Numer dokumentu (zlecenie transportowe)</label>
        <input type="text" id="doc-inp-numer-zlecenia" maxlength="120" placeholder="np. 1460" autocomplete="off" spellcheck="false" />
      </div>
      <label for="doc-inp-komentarz-1">Komentarz 1 <span class="doc-field-hint">(tylko arkusz)</span></label>
      <input type="text" id="doc-inp-komentarz-1" maxlength="500" placeholder="Opcjonalnie — trafia do rejestru transportów" autocomplete="off" spellcheck="true" />
      <label for="doc-inp-komentarz-2">Komentarz 2 <span class="doc-field-hint">(tylko arkusz)</span></label>
      <input type="text" id="doc-inp-komentarz-2" maxlength="500" placeholder="Opcjonalnie — trafia do rejestru transportów" autocomplete="off" spellcheck="true" />
      <label class="doc-checkbox-row" for="doc-chk-odbior-z-trasy">
        <input type="checkbox" id="doc-chk-odbior-z-trasy" />
        Odbiór z trasy
      </label>
      <div id="doc-route-fields" hidden>
        <label for="doc-inp-trasa">Nazwa trasy</label>
        <input type="text" id="doc-inp-trasa" maxlength="120" autocomplete="off" spellcheck="false" />
        <p id="doc-route-continue-hint" class="doc-route-continue-hint" hidden></p>
        <button type="button" id="doc-btn-nowa-trasa" hidden>Nowa trasa</button>
        <label for="doc-inp-stawka-trasy">Stawka za trasę</label>
        <input type="text" id="doc-inp-stawka-trasy" maxlength="32" inputmode="decimal" autocomplete="off" spellcheck="false" />
      </div>
      <label class="doc-checkbox-row" for="doc-chk-bez-listy-plomb">
        <input type="checkbox" id="doc-chk-bez-listy-plomb" />
        Bez listy plomb <span class="doc-field-hint">(10 wierszy kropek do wpisania)</span>
      </label>
      <p id="doc-bulk-numer-info" class="doc-bulk-numer-info" hidden aria-live="polite"></p>
      <p id="doc-filter-info" class="doc-filter-info" aria-live="polite"></p>
      <div class="doc-modal-actions">
        <button type="button" id="doc-btn-cancel">Anuluj</button>
        <button type="button" id="doc-btn-ok">Pobierz .docx</button>
      </div>
    </div>
  </div>
  <div id="bolecin-aw-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="bolecin-aw-title">
      <h3 id="bolecin-aw-title">Awizacja do Bolęcina</h3>
      <p id="bolecin-aw-hint" class="doc-modal-hint">Ten odbiór jedzie do Bolęcina. Dopisz wiersz do arkusza Bolęcin albo wygeneruj sam protokół.</p>
      <label for="bolecin-aw-nr">Nr rejestracyjny <span class="doc-field-hint">(kolumna awizacja)</span></label>
      <input type="text" id="bolecin-aw-nr" maxlength="120" autocomplete="off" spellcheck="false" />
      <label for="bolecin-aw-okno">Okno awizacji</label>
      <input type="text" id="bolecin-aw-okno" maxlength="120" autocomplete="off" spellcheck="false" placeholder="np. 8:00–12:00" />
      <label for="bolecin-aw-transport">Rodzaj transportu</label>
      <input type="text" id="bolecin-aw-transport" maxlength="80" autocomplete="off" spellcheck="false" />
      <div id="bolecin-aw-worki-wrap">
        <label for="bolecin-aw-worki">Ile worków</label>
        <input type="text" id="bolecin-aw-worki" inputmode="numeric" maxlength="12" autocomplete="off" spellcheck="false" />
        <p id="bolecin-aw-worki-hint" class="doc-field-hint">Liczba z worków na protokole. Można ją poprawić.</p>
      </div>
      <p class="doc-bulk-points-title">Z protokołu do arkusza Bolęcin</p>
      <div id="bolecin-aw-summary" class="bolecin-aw-summary"></div>
      <div class="doc-modal-actions">
        <button type="button" id="bolecin-aw-cancel">Anuluj</button>
        <button type="button" id="bolecin-aw-skip">Generuj bez awizacji</button>
        <button type="button" id="bolecin-aw-add">Dodaj awizację</button>
      </div>
    </div>
  </div>
`;
}

export function bulkRatesModalHtml(): string {
  return `  <div id="bulk-rates-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="bulk-rates-modal-title">
      <h3 id="bulk-rates-modal-title">Ustaw stawki w bazie</h3>
      <p id="bulk-rates-hint" class="doc-modal-hint">Te same wartości trafią do Bazy stawek dla każdego zaznaczonego sklepu (zapis po adresie).</p>
      <div class="doc-bulk-points-wrap">
        <p class="doc-bulk-points-title">Zaznaczone sklepy</p>
        <ul id="bulk-rates-points-list" class="doc-bulk-points-list"></ul>
      </div>
      <div class="bulk-rates-target" role="group" aria-labelledby="bulk-rates-target-title">
        <span id="bulk-rates-target-title" class="bulk-rates-target-title">Cel zapisu</span>
        <div class="bulk-rates-target-options">
          <label><input type="radio" name="bulk-rates-target" value="stawki" checked /> Baza stawek</label>
          <label><input type="radio" name="bulk-rates-target" value="harmonogram" /> Baza cen harmonogram</label>
        </div>
      </div>
      <label for="bulk-rates-podwykonawca">Podwykonawca</label>
      <div class="doc-combobox-wrap">
        <input type="text" id="bulk-rates-podwykonawca" class="doc-combobox-input" autocomplete="off" spellcheck="false" placeholder="Wpisz fragment nazwy…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bulk-rates-podwykonawca-list" />
        <input type="hidden" id="bulk-rates-podwykonawca-value" />
        <ul id="bulk-rates-podwykonawca-list" class="doc-combobox-list" role="listbox" hidden></ul>
      </div>
      <label for="bulk-rates-podjazd">Kwota za podjazd</label>
      <input type="text" id="bulk-rates-podjazd" inputmode="decimal" autocomplete="off" />
      <label for="bulk-rates-worek">Kwota za worek</label>
      <input type="text" id="bulk-rates-worek" inputmode="decimal" autocomplete="off" />
      <div id="bulk-rates-trasa-wrap" hidden>
        <label for="bulk-rates-trasa">Nazwa trasy</label>
        <input type="text" id="bulk-rates-trasa" autocomplete="off" spellcheck="false" />
        <label for="bulk-rates-kwota-trasy">Cena za trasę</label>
        <input type="text" id="bulk-rates-kwota-trasy" inputmode="decimal" autocomplete="off" />
      </div>
      <div id="bulk-rates-dni-wrap" hidden>
        <label for="bulk-rates-dni-toggle">Dni transportu</label>
        ${harmonogramDaysPickerHtml('bulk-rates-dni')}
      </div>
      <label for="bulk-rates-od-kiedy">Od kiedy obowiązuje</label>
      <input type="date" id="bulk-rates-od-kiedy" />
      <p id="bulk-rates-footer-hint" class="doc-modal-hint" style="margin-top:10px;margin-bottom:0">Pusta data znaczy od zawsze. Puste kwoty i 0 są dozwolone.</p>
      <p id="bulk-rates-status" class="doc-filter-info" aria-live="polite"></p>
      <div class="doc-modal-actions">
        <button type="button" id="bulk-rates-btn-cancel">Anuluj</button>
        <button type="button" id="bulk-rates-btn-ok">Zapisz stawki</button>
      </div>
    </div>
  </div>
`;
}

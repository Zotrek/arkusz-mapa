/** Skrypt mapy: obsługa filtrów w panelu wyszukiwania. */

export function filtersUiBrowserScript(): string {
  return `    function mapPointMatchesSearchMap(p, query) {
      return mapPointMatchesSearch(p.adres, (p.searchLabels || []).map(String), query);
    }
    function mapPointMatchesZbiorkaFilterMap(zbiorka, mode) {
      return mapPointMatchesZbiorkaFilter(zbiorka == null ? '' : String(zbiorka), mode);
    }
    function getZbiorkaFilterMode() {
      var el = document.querySelector('input[name="map-zbiorka-filter"]:checked');
      return el ? String(el.value) : 'wszystkie';
    }
    function normalizeWgHarmonogramuMap(raw) {
      return normalizeWgHarmonogramu(raw);
    }
    function mapPointMatchesWgHarmonogramuFilterMap(wgHarmonogramu, mode) {
      return mapPointMatchesWgHarmonogramuFilter(wgHarmonogramu, mode);
    }
    function getWgHarmonogramuFilterMode() {
      var el = document.querySelector('input[name="map-harmonogram-filter"]:checked');
      return el ? String(el.value) : 'wszystkie';
    }
    function mapPointMatchesWojewodztwoFilterMap(woj, selected) {
      return mapPointMatchesWojewodztwoFilter(woj, selected);
    }
    function getWojewodztwoFilterSelection() {
      var boxes = document.querySelectorAll('input[name="map-wojewodztwo-filter"]:checked');
      var out = [];
      for (var i = 0; i < boxes.length; i++) {
        out.push(String(boxes[i].value));
      }
      return out;
    }
    function formatWojewodztwoFilterSummaryMap(selected) {
      return formatWojewodztwoFilterSummary(selected);
    }
    function updateWojewodztwoFilterSummary() {
      var labelEl = document.getElementById('map-wojewodztwo-summary');
      if (!labelEl) return;
      labelEl.textContent = formatWojewodztwoFilterSummaryMap(getWojewodztwoFilterSelection());
    }
    function clearWojewodztwoFilter() {
      var boxes = document.querySelectorAll('input[name="map-wojewodztwo-filter"]');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].checked = false;
      }
      updateWojewodztwoFilterSummary();
    }
    function clearAllMapFilters() {
      var inputEl = document.getElementById('map-address-search');
      if (inputEl) inputEl.value = '';
      var zDefault = document.querySelector('input[name="map-zbiorka-filter"][value="wszystkie"]');
      if (zDefault) zDefault.checked = true;
      var hDefault = document.querySelector('input[name="map-harmonogram-filter"][value="wszystkie"]');
      if (hDefault) hDefault.checked = true;
      clearWojewodztwoFilter();
      setWojewodztwoDropdownOpen(false);
      applyAddressSearch();
    }
    function setWojewodztwoDropdownOpen(open) {
      var drop = document.getElementById('map-wojewodztwo-dropdown');
      var btn = document.getElementById('map-wojewodztwo-toggle');
      if (!drop || !btn) return;
      if (open) drop.classList.add('is-open');
      else drop.classList.remove('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function setMarkerClickable(marker, clickable) {
      var el = marker.getElement ? marker.getElement() : null;
      if (el) el.style.pointerEvents = clickable ? '' : 'none';
    }
`;
}

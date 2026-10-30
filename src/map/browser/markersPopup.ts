/** Skrypt mapy: Liczniki worków, popup pinezki, zaznaczenie zbiorcze, nakładka ładowania. */

import { jsonForScript } from '../../jsonForScript.js';
import { COLOR_15_PLUS, COLOR_ZERO_BAGS, PALETTE_PIN } from './mapCore.js';

export function markersPopupBrowserScript(): string {
  return `
    var palettePin = ${jsonForScript([...PALETTE_PIN])};
    var color15Plus = ${jsonForScript(COLOR_15_PLUS)};
    var colorZeroBags = ${jsonForScript(COLOR_ZERO_BAGS)};
    function kolorPinezki(count) {
      if (count <= 0) return colorZeroBags;
      if (count >= 15) return color15Plus;
      var idx = count >= 10 ? 2 : count >= 4 ? 1 : 0;
      return palettePin[idx];
    }

    function getPointTransportLastInfo(p) {
      return resolveTransportLastForPoint(p, window.__transportDateByKey, window.__transportKtoOdbieraByKey);
    }
    function getPointTransportCutoff(p) {
      var info = getPointTransportLastInfo(p);
      return info ? info.ms : null;
    }
    function countSealRows(sealRows) {
      return (sealRows || []).length;
    }
    function sealRowsForCollection(sealRows) {
      return (sealRows || []).filter(function (r) {
        return !r.odebraneZHarmonogramu;
      });
    }
    function getPointSealCounts(p) {
      var total = countSealRows(p.sealRows);
      if (total === 0) total = p.count || 0;
      var collectible = sealRowsForCollection(p.sealRows);
      var lastInfo = transportApiEnabled && window.__transportDatesLoaded ? getPointTransportLastInfo(p) : null;
      var cutoffMs = lastInfo ? lastInfo.ms : null;
      var filtered = cutoffMs != null
        ? filterSealRowsByMinClosureDate(collectible, cutoffMs).length
        : resolveCollectibleSealCount(p.sealRows, total);
      var cutoffYmd = null;
      if (cutoffMs != null) {
        var d = new Date(cutoffMs);
        cutoffYmd = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
      }
      var ktoOdbiera = lastInfo && lastInfo.ktoOdbiera ? String(lastInfo.ktoOdbiera).trim() : '';
      return { total: total, filtered: filtered, cutoffMs: cutoffMs, cutoffYmd: cutoffYmd, ktoOdbiera: ktoOdbiera };
    }
    function displayCountForPoint(p) {
      return getPointSealCounts(p).filtered;
    }
    function buildPopupCountHtml(p) {
      var c = getPointSealCounts(p);
      if (transportApiEnabled && !window.__transportDatesLoaded) {
        return '<div class="popup-count">Worki do odebrania: <strong>…</strong></div>' +
          '<div class="popup-count-detail">Trwa pobieranie danych transportu</div>';
      }
      if (!transportApiEnabled) {
        var mainOffline = '<div class="popup-count">Liczba wystąpień: <strong>' + c.filtered + '</strong></div>';
        if (c.filtered !== c.total) {
          mainOffline += '<div class="popup-count-detail">Wszystkie worki: ' + c.total + ' (odebrane z harmonogramu wyłączone z licznika)</div>';
        }
        return mainOffline;
      }
      var main = '<div class="popup-count">Worki do odebrania: <strong>' + c.filtered + '</strong></div>';
      var transportDate = c.cutoffYmd
        ? '<div class="popup-count-detail">Ostatni transport: ' + escapeHtmlMap(formatYmdToDisplay(c.cutoffYmd)) + '</div>'
        : '';
      var transportKto = c.ktoOdbiera
        ? '<div class="popup-count-detail">Ostatni odbiór: ' + escapeHtmlMap(c.ktoOdbiera) + '</div>'
        : '';
      return main + transportDate + transportKto + '<div class="popup-count-detail">Wszystkie worki: ' + c.total + '</div>';
    }
    function escapeHtmlMap(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    function buildPopupContent(p, pointIdx) {
      var confidenceLabel =
        p.confidence === 'uncertain'
          ? '<div class="popup-confidence">Wynik niepewny</div>'
          : p.confidence === 'city_only'
            ? '<div class="popup-confidence">Tylko kod+miasto</div>'
            : p.confidence === 'ok_no_postcode'
              ? '<div class="popup-confidence">Bez kodu w wyniku</div>'
              : '';
      var zbiorkaLine = p.zbiorka
        ? '<div class="popup-zbiorka">Zbiórka: ' + escapeHtmlMap(p.zbiorka) + '</div>'
        : '';
      var harmNorm = normalizeWgHarmonogramuMap(p.wgHarmonogramu);
      var harmLabel = harmNorm === 'tak' ? 'tak' : (harmNorm === 'nie' ? 'nie' : 'brak wartości');
      if (harmNorm === 'tak' && p.firmaTransportowa) {
        harmLabel = 'tak - ' + escapeHtmlMap(p.firmaTransportowa);
      }
      var harmLine = '<div class="popup-harmonogram">Harmonogram: ' + harmLabel + '</div>';
      var podmiotLine =
        p.podmiotyHandlowe && p.podmiotyHandlowe.length > 0
          ? '<div class="popup-podmiot">Podmiot handlowy: ' + escapeHtmlMap(p.podmiotyHandlowe.join(', ')) + '</div>'
          : '';
      var bulkSelected = isBulkPointSelected(pointIdx);
      var loaderOn = (typeof mapLoaderDepth !== 'undefined' && mapLoaderDepth > 0)
        || (typeof routeNameFieldLoadDepth !== 'undefined' && routeNameFieldLoadDepth > 0);
      var genDocBtn = wordDocEnabled
        ? '<div><button type="button" class="btn-gen-doc"' +
          (bulkSelected ? ' data-bulk-locked="1"' : '') +
          ((bulkSelected || loaderOn) ? ' disabled' : '') +
          '>Generuj dokument</button></div>'
        : '';
      var bulkSelect = wordDocEnabled
        ? '<label class="popup-bulk-select"><input type="checkbox" class="popup-bulk-cb" data-point-idx="' + pointIdx + '"' +
          (window.__bulkSelectedPointIdxs && window.__bulkSelectedPointIdxs[pointIdx] ? ' checked' : '') +
          ' /> Zaznacz do zbiorczego protokołu</label>'
        : '';
      var poprawBtn = (typeof TRANSPORT_WEBAPP_URL !== 'undefined' && TRANSPORT_WEBAPP_URL)
        ? '<button type="button" class="map-popraw-adres-btn btn-popraw-adres" data-point-idx="' + pointIdx + '">Popraw adres</button>'
        : '';
      return '<div class="popup-address">' + escapeHtmlMap(addressWithCommaAfterLocality(p.adres, p.miasto)) + '</div>' +
        (podmiotLine || '') +
        buildPopupCountHtml(p) +
        (zbiorkaLine || '') +
        (harmLine || '') +
        '<div class="popup-woj">' + escapeHtmlMap(p.woj) + '</div>' +
        confidenceLabel +
        bulkSelect +
        poprawBtn +
        genDocBtn;
    }
    window.__bulkSelectedPointIdxs = window.__bulkSelectedPointIdxs || {};
    window.__autoBulkMode = false;
    window.__autoBulkClickStep = window.__autoBulkClickStep || {};
    function getBulkSelectedIndices() {
      var out = [];
      var sel = window.__bulkSelectedPointIdxs || {};
      Object.keys(sel).forEach(function (k) {
        if (sel[k]) {
          var idx = parseInt(k, 10);
          if (!isNaN(idx) && adresy[idx]) out.push(idx);
        }
      });
      out.sort(function (a, b) { return a - b; });
      return out;
    }
    function isBulkPointSelected(pointIdx) {
      return !!(window.__bulkSelectedPointIdxs && window.__bulkSelectedPointIdxs[pointIdx]);
    }
    function getAutoBulkClickStep(pointIdx) {
      var step = window.__autoBulkClickStep && window.__autoBulkClickStep[pointIdx];
      return step === 1 || step === 2 ? step : 0;
    }
    function setAutoBulkClickStep(pointIdx, step) {
      if (!window.__autoBulkClickStep) window.__autoBulkClickStep = {};
      if (step === 1 || step === 2) {
        window.__autoBulkClickStep[pointIdx] = step;
      } else {
        delete window.__autoBulkClickStep[pointIdx];
      }
    }
    function clearAutoBulkClickSteps() {
      window.__autoBulkClickStep = {};
    }
    function isAutoBulkModeActive() {
      return !!(wordDocEnabled && window.__autoBulkMode);
    }
    function setBulkPointSelected(pointIdx, selected) {
      if (!window.__bulkSelectedPointIdxs) window.__bulkSelectedPointIdxs = {};
      if (selected) {
        window.__bulkSelectedPointIdxs[pointIdx] = true;
      } else {
        delete window.__bulkSelectedPointIdxs[pointIdx];
        setAutoBulkClickStep(pointIdx, 0);
      }
      updateBulkSelectionUi();
    }
    function clearBulkSelection() {
      window.__bulkSelectedPointIdxs = {};
      clearAutoBulkClickSteps();
      updateBulkSelectionUi();
    }
    function handleMarkerPrimaryClick(marker, pointIdx) {
      if (!isAutoBulkModeActive()) {
        marker.openPopup();
        return;
      }
      var step = getAutoBulkClickStep(pointIdx);
      if (step === 0) {
        setBulkPointSelected(pointIdx, true);
        setAutoBulkClickStep(pointIdx, 1);
        marker.closePopup();
        return;
      }
      if (step === 1) {
        setAutoBulkClickStep(pointIdx, 2);
        marker.openPopup();
        return;
      }
      setBulkPointSelected(pointIdx, false);
      setAutoBulkClickStep(pointIdx, 0);
      marker.closePopup();
    }
    function setAutoBulkMode(active) {
      window.__autoBulkMode = !!active;
      if (window.__autoBulkMode) {
        getBulkSelectedIndices().forEach(function (idx) {
          if (getAutoBulkClickStep(idx) === 0) setAutoBulkClickStep(idx, 1);
        });
      } else {
        clearAutoBulkClickSteps();
      }
      var btn = document.getElementById('map-auto-bulk-toggle');
      if (btn) {
        btn.classList.toggle('is-active', window.__autoBulkMode);
        btn.setAttribute('aria-pressed', window.__autoBulkMode ? 'true' : 'false');
      }
    }
    function sumBulkBagsToCollect(indices) {
      var sum = 0;
      for (var i = 0; i < indices.length; i++) {
        sum += displayCountForPoint(adresy[indices[i]]);
      }
      return sum;
    }
    function updateBulkSelectionUi() {
      var indices = getBulkSelectedIndices();
      var panel = document.getElementById('map-bulk-panel');
      var countEl = document.getElementById('map-bulk-count');
      var bagsEl = document.getElementById('map-bulk-bags');
      if (panel) panel.hidden = indices.length === 0;
      if (countEl) {
        countEl.textContent = indices.length === 1
          ? '1 punkt zaznaczony'
          : indices.length + ' punktów zaznaczonych';
      }
      if (bagsEl) {
        if (transportApiEnabled && !window.__transportDatesLoaded) {
          bagsEl.textContent = 'Worki do odebrania: …';
        } else {
          bagsEl.textContent = 'Worki do odebrania: ' + sumBulkBagsToCollect(indices);
        }
      }
      if (typeof markerEntries !== 'undefined') {
        markerEntries.forEach(function (entry) {
          var inputEl = document.getElementById('map-address-search');
          var raw = inputEl ? inputEl.value : '';
          var hasSearchFilter = String(raw).trim().length > 0;
          var sMatch = !hasSearchFilter || mapPointMatchesSearchMap(entry.p, raw);
          applyMarkerDisplayIcon(entry, hasSearchFilter && sMatch);
        });
        refreshClusterIcons();
      }
    }
    function wirePopupControls(marker, pointIdx) {
      var el = marker.getPopup().getElement();
      if (!el) return;
      if (wordDocEnabled) {
        var cb = el.querySelector('.popup-bulk-cb');
        if (cb) {
          cb.onchange = function () {
            setBulkPointSelected(pointIdx, cb.checked);
            if (cb.checked) {
              setAutoBulkClickStep(pointIdx, 2);
            }
            marker.setPopupContent(buildPopupContent(adresy[pointIdx], pointIdx));
            wirePopupControls(marker, pointIdx);
          };
        }
        var btn = el.querySelector('.btn-gen-doc');
        if (btn) {
          btn.onclick = function (ev) {
            if (ev.stopPropagation) ev.stopPropagation();
            if (btn.disabled) return;
            openDocModal(pointIdx);
          };
        }
      }
      var poprawBtn = el.querySelector('.btn-popraw-adres');
      if (poprawBtn) {
        poprawBtn.onclick = function (ev) {
          if (ev.stopPropagation) ev.stopPropagation();
          var p = adresy[pointIdx];
          openPoprawAdresFromPoint({
            podmiotHandlowy: p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '',
            sklep: p.sklep || '',
            adres: p.adres,
            lat: p.lat,
            lng: p.lng,
            woj: p.woj || ''
          });
        };
      }
    }
    function applyMarkerTransportIcon(entry) {
      var p = entry.p;
      var displayCount = displayCountForPoint(p);
      var kolor = kolorPinezki(displayCount);
      entry.kolor = kolor;
      applyMarkerDisplayIcon(entry, false);
    }
    function applyMarkerTransportDisplay(entry) {
      applyMarkerTransportIcon(entry);
      entry.marker.setPopupContent(buildPopupContent(entry.p, entry.pointIdx));
    }
    function refreshMarkerDisplay(entry) {
      applyMarkerTransportDisplay(entry);
      refreshClusterIcons();
    }
    /** Po datach transportu: tylko kolory pinezek; popup budowany przy otwarciu. */
    function refreshAllMarkerDisplaysAfterTransport() {
      return new Promise(function (resolve) {
        var i = 0;
        var batchSize = 200;
        function step() {
          var end = Math.min(i + batchSize, markerEntries.length);
          for (; i < end; i++) {
            applyMarkerTransportIcon(markerEntries[i]);
          }
          if (i < markerEntries.length) {
            setTimeout(step, 0);
            return;
          }
          refreshClusterIcons();
          updateBulkSelectionUi();
          resolve();
        }
        if (markerEntries.length === 0) {
          updateBulkSelectionUi();
          resolve();
          return;
        }
        step();
      });
    }
    var mapLoaderDepth = 0;
    var routeNameFieldLoadDepth = 0;
    var mapLoaderLastMessage = 'Pobieranie danych transportu…';
    /** Wspólny overlay z pulsującym logo. Autonazwa ma własny depth — nie truje komunikatu bulk/modal. */
    function syncMapLoaderUi(messageForTransport) {
      var el = document.getElementById('map-transport-loader');
      if (!el) return;
      var on = mapLoaderDepth > 0 || routeNameFieldLoadDepth > 0;
      el.hidden = !on;
      el.setAttribute('aria-busy', on ? 'true' : 'false');
      var okBtn = document.getElementById('doc-btn-ok');
      if (okBtn) okBtn.disabled = on;
      var awAddBtn = document.getElementById('bolecin-aw-add');
      if (awAddBtn) awAddBtn.disabled = on;
      if (typeof document.querySelectorAll === 'function') {
        var genBtns = document.querySelectorAll('.btn-gen-doc');
        for (var gi = 0; gi < genBtns.length; gi++) {
          var genBtn = genBtns[gi];
          var bulkLocked = genBtn.getAttribute && genBtn.getAttribute('data-bulk-locked') === '1';
          genBtn.disabled = on || !!bulkLocked;
        }
      }
      var label = document.getElementById('map-transport-loader-label');
      if (!label) return;
      if (messageForTransport) mapLoaderLastMessage = messageForTransport;
      if (routeNameFieldLoadDepth > 0) {
        label.textContent = 'Ładowanie nazwy trasy…';
      } else if (mapLoaderDepth > 0) {
        label.textContent = mapLoaderLastMessage;
      }
    }
    function setTransportDatesLoading(loading, message) {
      if (!document.getElementById('map-transport-loader')) return;
      if (loading) mapLoaderDepth += 1;
      else mapLoaderDepth = Math.max(0, mapLoaderDepth - 1);
      syncMapLoaderUi(message || null);
    }
`;
}

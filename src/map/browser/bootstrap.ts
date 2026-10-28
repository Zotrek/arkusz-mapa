/** Skrypt mapy: start — granice województw, pinezki, panel wyszukiwania, legenda. */

import { jsonForScript } from '../../jsonForScript.js';

/** Zoom przy dokładnie jednym wyniku wyszukiwania (skala okolicy / ulic). */
export const MAP_SEARCH_SINGLE_MATCH_ZOOM = 16;

/** Opóźnienie filtrowania po wpisaniu znaku — każde przeliczenie dotyka wszystkich pinezek. */
export const MAP_SEARCH_INPUT_DEBOUNCE_MS = 200;

/** Górny limit zoomu przy wielu wynikach (fitBounds — nie „wchodzi” za głęboko). */
export const MAP_SEARCH_MULTI_MATCH_MAX_ZOOM = 16;

/** Margines od krawędzi mapy przy fitBounds wielu wyników [px góra-dół, px lewo-prawo]. */
export const MAP_SEARCH_FIT_PADDING: [number, number] = [72, 72];

export interface MapBootstrapOptions {
  geoJsonUrl: string;
  wojewodztwaOptions: string[];
  generatedAtLabel: string;
}

export function bootstrapBrowserScript({
  geoJsonUrl,
  wojewodztwaOptions,
  generatedAtLabel,
}: MapBootstrapOptions): string {
  return `    var wojBoundsByKey = {};
    if (typeof setTransportDatesLoading === 'function') {
      setTransportDatesLoading(true, 'Ładowanie granic województw…');
    }
    fetch(${jsonForScript(geoJsonUrl)})
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(geojson) {
        L.geoJSON(geojson, {
          onEachFeature: function(feature, layer) {
            var p = feature.properties;
            var n = p && p.name;
            if (typeof n !== 'string' || !n.trim()) return;
            var k = normalizeForAddressSearch(n);
            if (k) wojBoundsByKey[k] = layer.getBounds();
          },
          style: { color: '#c00', weight: 3, fill: false }
        }).addTo(map);
      })
      .catch(function(err) {
        console.warn('Nie załadowano granic województw.');
        showMapErrorCard({
          code: 'MAP-E-VOIVODESHIP',
          summary: 'Nie udało się wczytać granic województw.',
          effect: 'Filtr województwa nie ma granic do trafienia. Pinezki i reszta mapy działają.',
          place: 'map/browser/bootstrap.ts fetch geoJsonUrl (granice województw)',
          technical: String(err && err.message || err || 'Nie załadowano granic województw.')
        });
      })
      .then(function() {
        if (typeof setTransportDatesLoading === 'function') {
          setTransportDatesLoading(false);
        }
      });

    var markersCluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 16,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
      iconCreateFunction: function(cluster) {
        var children = cluster.getAllChildMarkers();
        var n = children.length;
        var fill = dominantPinKolor(children);
        var size = n < 10 ? 34 : n < 25 ? 40 : 48;
        var sizeClass = n < 10 ? 'dm-cluster-sm' : n < 25 ? 'dm-cluster-md' : 'dm-cluster-lg';
        return L.divIcon({
          html: '<div class="dm-cluster-inner" style="background:' + fill + ';color:' + clusterLabelColor(fill) + '"><span>' + n + '</span></div>',
          className: 'dm-cluster ' + sizeClass,
          iconSize: L.point(size, size),
          iconAnchor: [size / 2, size / 2]
        });
      }
    });

    function isClusteringEnabled() {
      var el = document.getElementById('map-cluster-toggle');
      return !!(el && el.checked);
    }
    /** Zmiany w grupie zbierane do jednego addLayers/removeLayers — pojedyncze addLayer przelicza klastry za każdym razem. */
    function setMarkerVisible(marker, on, clusterAdds, clusterRemovals) {
      var clustered = isClusteringEnabled();
      var inCluster = markersCluster.hasLayer(marker);
      if (on && clustered && inCluster) return;
      if (on && !clustered && !inCluster && map.hasLayer(marker)) return;
      if (inCluster) {
        if (on) markersCluster.removeLayer(marker);
        else clusterRemovals.push(marker);
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
      if (!on) return;
      if (clustered) clusterAdds.push(marker);
      else marker.addTo(map);
    }
    function applyClusteringMode() {
      if (isClusteringEnabled()) {
        if (!map.hasLayer(markersCluster)) map.addLayer(markersCluster);
      } else if (map.hasLayer(markersCluster)) {
        map.removeLayer(markersCluster);
      }
      applyAddressSearch();
    }

    var markerEntries = [];
    adresy.forEach(function(p, pointIdx) {
      var displayCount = displayCountForPoint(p);
      var kolor = kolorPinezki(displayCount);
      var marker = L.marker([p.markerLat, p.markerLng], { icon: pinIcon(kolor, false), pinKolor: kolor })
        .bindPopup('');
      marker.off('click');
      marker.on('click', function () {
        handleMarkerPrimaryClick(marker, pointIdx);
      });
      markerEntries.push({ marker: marker, p: p, kolor: kolor, pointIdx: pointIdx });
      marker.on('popupopen', function() {
        marker.setPopupContent(buildPopupContent(p, pointIdx));
        wirePopupControls(marker, pointIdx);
      });
    });

    loadBulkTransportDates();

    var allPointsBounds = null;
    if (adresy.length > 0) {
      allPointsBounds = L.latLngBounds(adresy.map(function(p) { return [p.markerLat, p.markerLng]; }));
      map.fitBounds(allPointsBounds, { padding: [40, 40] });
    }

    var zbiorkaFilterHtml = showZbiorkaFilter
      ? '<div class="map-zbiorka-filter" role="group" aria-labelledby="map-zbiorka-filter-title">' +
        '<span id="map-zbiorka-filter-title" class="map-zbiorka-filter-title">Warstwa zbiórki</span>' +
        '<div class="map-zbiorka-filter-options">' +
        '<label><input type="radio" name="map-zbiorka-filter" value="wszystkie" checked /> Wszystkie punkty</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="obie" /> Ręczna i maszynowa</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="reczna" /> Tylko ręczna</label>' +
        '<label><input type="radio" name="map-zbiorka-filter" value="maszyna" /> Tylko maszynowa</label>' +
        '</div></div>'
      : '';
    var harmonogramFilterHtml = showHarmonogramFilter
      ? '<div class="map-harmonogram-filter" role="group" aria-labelledby="map-harmonogram-filter-title">' +
        '<span id="map-harmonogram-filter-title" class="map-harmonogram-filter-title">Wg harmonogramu</span>' +
        '<div class="map-harmonogram-filter-options">' +
        '<label><input type="radio" name="map-harmonogram-filter" value="wszystkie" checked /> Wszystkie</label>' +
        '<label><input type="radio" name="map-harmonogram-filter" value="tak" /> Tak</label>' +
        '<label><input type="radio" name="map-harmonogram-filter" value="nie" /> Nie</label>' +
        '</div></div>'
      : '';
    var wojewodztwoFilterHtml = showWojewodztwoFilter
      ? '<div class="map-wojewodztwo-filter" role="group" aria-labelledby="map-wojewodztwo-filter-title">' +
        '<span id="map-wojewodztwo-filter-title" class="map-wojewodztwo-filter-title">Województwo</span>' +
        '<div id="map-wojewodztwo-dropdown" class="map-wojewodztwo-dropdown">' +
        '<button type="button" id="map-wojewodztwo-toggle" class="map-wojewodztwo-toggle" aria-expanded="false" aria-controls="map-wojewodztwo-menu" aria-haspopup="listbox">' +
        '<span id="map-wojewodztwo-summary" class="map-wojewodztwo-toggle-label">Wszystkie</span>' +
        '<span class="map-wojewodztwo-toggle-caret" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div id="map-wojewodztwo-menu" class="map-wojewodztwo-menu" role="listbox" aria-multiselectable="true" aria-label="Wybierz województwa">' +
        '<button type="button" id="map-wojewodztwo-clear" class="map-wojewodztwo-clear">Wyczyść filtr</button>' +
        ${jsonForScript(wojewodztwaOptions)}.map(function(w) {
          var esc = String(w).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          var label = String(w).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return '<label><input type="checkbox" name="map-wojewodztwo-filter" value="' + esc + '" /> ' + label + '</label>';
        }).join('') +
        '</div></div></div>'
      : '';
    var clusterToggleHtml =
      '<div class="map-cluster-filter">' +
      '<label for="map-cluster-toggle"><input type="checkbox" id="map-cluster-toggle" /> Grupuj nachodzące punkty</label>' +
      '</div>';
    var bulkPanelHtml = wordDocEnabled
      ? '<div id="map-bulk-panel" class="map-bulk-panel" hidden>' +
        '<div class="map-bulk-stats">' +
        '<span id="map-bulk-count" class="map-bulk-count">0 punktów zaznaczonych</span>' +
        '<span id="map-bulk-bags" class="map-bulk-bags">Worki do odebrania: 0</span>' +
        '</div>' +
        '<button type="button" id="map-bulk-generate" class="map-bulk-generate">Generuj protokoły</button>' +
        (typeof TRANSPORT_WEBAPP_URL !== 'undefined' && TRANSPORT_WEBAPP_URL
          ? '<button type="button" id="map-bulk-rates" class="map-bulk-rates">Ustaw stawki</button>'
          : '') +
        '<button type="button" id="map-bulk-clear" class="map-bulk-clear">Wyczyść</button>' +
        '</div>'
      : '';
    var manualAdminBtnHtml = (typeof TRANSPORT_WEBAPP_URL !== 'undefined' && TRANSPORT_WEBAPP_URL)
      ? '<button type="button" id="map-manual-admin-open" class="map-manual-add-btn">Dodaj do listy / popraw adres</button>' +
        '<button type="button" id="map-harmonogram-open" class="map-harmonogram-open-btn">Harmonogramy</button>'
      : '';
    var autoBulkBtnHtml = wordDocEnabled
      ? '<button type="button" id="map-auto-bulk-toggle" class="map-auto-bulk-btn" aria-pressed="false">Automatyczne zbiorcze zaznaczanie</button>'
      : '';

    var searchControl = L.control({ position: 'topleft' });
    searchControl.onAdd = function() {
      var wrap = L.DomUtil.create('div', 'map-search-panel');
      wrap.innerHTML =
        '<div class="map-search-panel-head">' +
        '<label class="map-search-label" for="map-address-search">Szukaj na mapie</label>' +
        '<button type="button" id="map-search-collapse" class="map-search-collapse" aria-expanded="true" aria-controls="map-search-body" title="Zwiń menu" aria-label="Zwiń menu">‹</button>' +
        '</div>' +
        '<div id="map-search-body" class="map-search-body">' +
        '<div class="map-search-input-row">' +
        '<input type="search" id="map-address-search" class="map-search-input" placeholder="Adres, podmiot handlowy lub sklep…" autocomplete="off" spellcheck="false" aria-label="Szukaj: adres, podmiot lub sklep" />' +
        '<div class="map-zoom-inline" role="toolbar" aria-label="Powiększenie mapy">' +
        '<button type="button" id="map-zoom-out" title="Pomniejsz" aria-label="Pomniejsz">−</button>' +
        '<button type="button" id="map-zoom-in" title="Powiększ" aria-label="Powiększ">+</button>' +
        '</div></div>' +
        '<div id="map-search-status" class="map-search-status" role="status" aria-live="polite"></div>' +
        zbiorkaFilterHtml +
        harmonogramFilterHtml +
        wojewodztwoFilterHtml +
        clusterToggleHtml +
        '<button type="button" id="map-clear-all-filters" class="map-clear-all-filters">Wyczyść wszystkie filtry</button>' +
        '<div id="map-filter-count" class="map-filter-count" role="status" aria-live="polite">Widoczne: 0 szt.</div>' +
        manualAdminBtnHtml +
        autoBulkBtnHtml +
        bulkPanelHtml +
        '</div>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      var zIn = wrap.querySelector('#map-zoom-in');
      var zOut = wrap.querySelector('#map-zoom-out');
      if (zIn) zIn.onclick = function() { map.zoomIn(); };
      if (zOut) zOut.onclick = function() { map.zoomOut(); };
      var clearAllBtn = wrap.querySelector('#map-clear-all-filters');
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          clearAllMapFilters();
        });
      }
      if (showZbiorkaFilter) {
        var zbiorkaRadios = wrap.querySelectorAll('input[name="map-zbiorka-filter"]');
        for (var zi = 0; zi < zbiorkaRadios.length; zi++) {
          zbiorkaRadios[zi].addEventListener('change', applyAddressSearch);
        }
      }
      if (showHarmonogramFilter) {
        var harmRadios = wrap.querySelectorAll('input[name="map-harmonogram-filter"]');
        for (var hi = 0; hi < harmRadios.length; hi++) {
          harmRadios[hi].addEventListener('change', applyAddressSearch);
        }
      }
      if (showWojewodztwoFilter) {
        var wojToggle = wrap.querySelector('#map-wojewodztwo-toggle');
        var wojDrop = wrap.querySelector('#map-wojewodztwo-dropdown');
        var wojBoxes = wrap.querySelectorAll('input[name="map-wojewodztwo-filter"]');
        var wojClear = wrap.querySelector('#map-wojewodztwo-clear');
        if (wojToggle && wojDrop) {
          wojToggle.addEventListener('click', function (ev) {
            ev.preventDefault();
            setWojewodztwoDropdownOpen(!wojDrop.classList.contains('is-open'));
          });
        }
        if (wojClear) {
          wojClear.addEventListener('click', function (ev) {
            ev.preventDefault();
            clearWojewodztwoFilter();
            applyAddressSearch();
          });
        }
        for (var wi = 0; wi < wojBoxes.length; wi++) {
          wojBoxes[wi].addEventListener('change', function () {
            updateWojewodztwoFilterSummary();
            applyAddressSearch();
          });
        }
        document.addEventListener('click', function (ev) {
          if (!wojDrop || !wojDrop.classList.contains('is-open')) return;
          if (wojDrop.contains(ev.target)) return;
          setWojewodztwoDropdownOpen(false);
        });
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape') setWojewodztwoDropdownOpen(false);
        });
        updateWojewodztwoFilterSummary();
      }
      var clusterToggle = wrap.querySelector('#map-cluster-toggle');
      if (clusterToggle) clusterToggle.addEventListener('change', applyClusteringMode);
      var collapseBtn = wrap.querySelector('#map-search-collapse');
      var searchPanelKey = 'arkusz-mapa-search-panel-collapsed';
      function setSearchPanelCollapsed(collapsed) {
        if (collapsed) wrap.classList.add('is-collapsed');
        else wrap.classList.remove('is-collapsed');
        if (collapsed) setWojewodztwoDropdownOpen(false);
        if (!collapseBtn) return;
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        collapseBtn.setAttribute('aria-label', collapsed ? 'Rozwiń menu' : 'Zwiń menu');
        collapseBtn.setAttribute('title', collapsed ? 'Rozwiń menu' : 'Zwiń menu');
        collapseBtn.textContent = collapsed ? '☰' : '‹';
      }
      if (collapseBtn) {
        collapseBtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          var next = !wrap.classList.contains('is-collapsed');
          setSearchPanelCollapsed(next);
          try { localStorage.setItem(searchPanelKey, next ? '1' : '0'); } catch (e) {}
        });
        var savedCollapsed = false;
        try { savedCollapsed = localStorage.getItem(searchPanelKey) === '1'; } catch (e) {}
        if (savedCollapsed) setSearchPanelCollapsed(true);
      }
      if (wordDocEnabled) {
        var autoBulkBtn = wrap.querySelector('#map-auto-bulk-toggle');
        if (autoBulkBtn) {
          autoBulkBtn.onclick = function () {
            setAutoBulkMode(!window.__autoBulkMode);
          };
        }
        var bulkGenBtn = wrap.querySelector('#map-bulk-generate');
        var bulkClearBtn = wrap.querySelector('#map-bulk-clear');
        if (bulkGenBtn) {
          bulkGenBtn.onclick = function () {
            var indices = getBulkSelectedIndices();
            if (indices.length === 0) {
              showMapFormError_(
                'MAP-E-BULK-SELECT',
                'Zaznacz co najmniej jeden punkt na mapie.',
                'Zbiorczy protokół powstaje z zaznaczonych pinezek.',
                'map/browser/bootstrap.ts map-bulk-generate',
                'puste zaznaczenie'
              );
              return;
            }
            openBulkDocModal(indices);
          };
        }
        var bulkRatesBtn = wrap.querySelector('#map-bulk-rates');
        if (bulkRatesBtn) {
          bulkRatesBtn.onclick = function () {
            var indices = getBulkSelectedIndices();
            if (indices.length === 0) {
              showMapFormError_(
                'MAP-E-BULK-SELECT',
                'Zaznacz co najmniej jeden punkt na mapie.',
                'Stawki zbiorcze zapisują się dla zaznaczonych pinezek.',
                'map/browser/bootstrap.ts map-bulk-rates',
                'puste zaznaczenie'
              );
              return;
            }
            openBulkRatesModal(indices);
          };
        }
        if (bulkClearBtn) {
          bulkClearBtn.onclick = function () {
            clearBulkSelection();
            markerEntries.forEach(function (entry) {
              entry.marker.setPopupContent(buildPopupContent(entry.p, entry.pointIdx));
            });
            applyAddressSearch();
          };
        }
      }
      return wrap;
    };
    searchControl.addTo(map);

    var searchViewTimer = null;
    var skipInitialSearchViewport = true;
    function scheduleSearchViewport(hasFilter, raw, matchCount) {
      clearTimeout(searchViewTimer);
      if (skipInitialSearchViewport && !hasFilter) {
        return;
      }
      if (!hasFilter) {
        if (allPointsBounds && allPointsBounds.isValid()) {
          map.fitBounds(allPointsBounds, { padding: [40, 40] });
        }
        return;
      }
      if (matchCount === 0) {
        return;
      }
      searchViewTimer = setTimeout(function() {
        var inputEl = document.getElementById('map-address-search');
        var r = inputEl ? inputEl.value : '';
        if (String(r).trim().length === 0) return;
        var zMode = getZbiorkaFilterMode();
        var hMode = getWgHarmonogramuFilterMode();
        var wMode = getWojewodztwoFilterSelection();
        var matched = markerEntries.filter(function(e) {
          var zOk = !showZbiorkaFilter || mapPointMatchesZbiorkaFilterMap(e.p.zbiorka, zMode);
          var hOk = !showHarmonogramFilter || mapPointMatchesWgHarmonogramuFilterMap(e.p.wgHarmonogramu, hMode);
          var wOk = !showWojewodztwoFilter || mapPointMatchesWojewodztwoFilterMap(e.p.woj, wMode);
          return zOk && hOk && wOk && mapPointMatchesSearchMap(e.p, r);
        });
        if (matched.length === 0) return;
        if (matched.length === 1) {
          var one = matched[0].p;
          map.setView([one.markerLat, one.markerLng], ${jsonForScript(MAP_SEARCH_SINGLE_MATCH_ZOOM)}, { animate: true });
          return;
        }
        var pointBounds = L.latLngBounds(matched.map(function(e) { return [e.p.markerLat, e.p.markerLng]; }));
        if (pointBounds.isValid()) {
          map.fitBounds(pointBounds, {
            padding: ${jsonForScript(MAP_SEARCH_FIT_PADDING)},
            maxZoom: ${jsonForScript(MAP_SEARCH_MULTI_MATCH_MAX_ZOOM)},
            animate: true
          });
        }
      }, 300);
    }

    function applyAddressSearch() {
      var inputEl = document.getElementById('map-address-search');
      var statusEl = document.getElementById('map-search-status');
      var countEl = document.getElementById('map-filter-count');
      var raw = inputEl ? inputEl.value : '';
      var hasSearchFilter = String(raw).trim().length > 0;
      var zbiorkaMode = getZbiorkaFilterMode();
      var harmMode = getWgHarmonogramuFilterMode();
      var wojMode = getWojewodztwoFilterSelection();
      var matchCount = 0;
      var filterCount = 0;
      var clusterAdds = [];
      var clusterRemovals = [];
      markerEntries.forEach(function(entry) {
        var zMatch = !showZbiorkaFilter || mapPointMatchesZbiorkaFilterMap(entry.p.zbiorka, zbiorkaMode);
        var hMatch = !showHarmonogramFilter || mapPointMatchesWgHarmonogramuFilterMap(entry.p.wgHarmonogramu, harmMode);
        var wMatch = !showWojewodztwoFilter || mapPointMatchesWojewodztwoFilterMap(entry.p.woj, wojMode);
        if (!zMatch || !hMatch || !wMatch) {
          setMarkerVisible(entry.marker, false, clusterAdds, clusterRemovals);
          entry.marker.setOpacity(1);
          entry.marker.setZIndexOffset(0);
          setMarkerClickable(entry.marker, false);
          return;
        }
        filterCount++;
        setMarkerVisible(entry.marker, true, clusterAdds, clusterRemovals);
        var sMatch = mapPointMatchesSearchMap(entry.p, raw);
        if (hasSearchFilter && sMatch) matchCount++;
        setMarkerClickable(entry.marker, true);
        entry.marker.setOpacity(hasSearchFilter && !sMatch ? 0.7 : 1);
        entry.marker.setZIndexOffset(hasSearchFilter && sMatch ? 800 : 0);
        applyMarkerDisplayIcon(entry, hasSearchFilter && sMatch);
      });
      if (clusterRemovals.length > 0) markersCluster.removeLayers(clusterRemovals);
      if (clusterAdds.length > 0) markersCluster.addLayers(clusterAdds);
      refreshClusterIcons();
      if (countEl) {
        countEl.textContent = 'Widoczne: ' + filterCount + ' szt.';
      }
      if (statusEl) {
        if (!hasSearchFilter) {
          statusEl.textContent = '';
        } else if (matchCount === 0) {
          statusEl.textContent = 'Brak dopasowań';
        } else {
          statusEl.textContent = 'Znaleziono: ' + matchCount;
        }
      }
      scheduleSearchViewport(hasSearchFilter, raw, matchCount);
      skipInitialSearchViewport = false;
    }
    var searchInputEl = document.getElementById('map-address-search');
    var searchInputTimer = null;
    if (searchInputEl) {
      searchInputEl.addEventListener('input', function() {
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(applyAddressSearch, ${jsonForScript(MAP_SEARCH_INPUT_DEBOUNCE_MS)});
      });
      searchInputEl.addEventListener('search', function() {
        clearTimeout(searchInputTimer);
        applyAddressSearch();
      });
    }

    applyClusteringMode();

${
  generatedAtLabel
    ? `    var generatedAt = L.control({ position: 'bottomright' });
    generatedAt.onAdd = function() {
      var div = L.DomUtil.create('div', 'map-generated-at');
      div.textContent = ${jsonForScript(`Wygenerowano: ${generatedAtLabel}`)};
      return div;
    };
    generatedAt.addTo(map);
`
    : ''
}    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      var div = L.DomUtil.create('div', 'map-legend');
      var pinLight = palettePin[0], pinMed = palettePin[1], pinFull = palettePin[2];
      var countLegendTitle = transportApiEnabled ? 'Worki do odebrania' : 'Liczba wystąpień';
      var countHtml = hasCountLegend
        ? '<div class="legend-section"><h3>' + countLegendTitle + '</h3><ul>' +
          '<li><span class="legend-swatch" style="background:' + colorZeroBags + '"></span> 0</li>' +
          '<li><span class="legend-swatch" style="background:' + pinLight + '"></span> 1–3</li>' +
          '<li><span class="legend-swatch" style="background:' + pinMed + '"></span> 4–9</li>' +
          '<li><span class="legend-swatch" style="background:' + pinFull + '"></span> 10–14</li>' +
          '<li><span class="legend-swatch" style="background:' + color15Plus + '"></span> 15+</li>' +
          '</ul></div>'
        : '';
      var bulkLegendHtml = wordDocEnabled
        ? '<div class="legend-section"><h3>Zaznaczenie zbiorcze</h3><ul>' +
          '<li><span class="legend-swatch" style="background:' + colorBulkSelected + '"></span> Punkt zaznaczony</li>' +
          '</ul></div>'
        : '';
      div.innerHTML = countHtml + bulkLegendHtml;
      return div;
    };
    legend.addTo(map);
`;
}

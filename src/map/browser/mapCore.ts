/** Skrypt mapy: Mapa Leaflet, ikony pinezek i kolory klastrów. */

import { jsonForScript } from '../../jsonForScript.js';

/** Kolor pinezki dla 15+ wystąpień (wyróżnienie dużych zbiórek). */
export const COLOR_15_PLUS = '#fd7e14';

/** Kolor pinezki dla 10–14 wystąpień. */
const COLOR_10_14 = '#ffc107';

/** Kolor pinezki gdy po filtrze transportów nie ma worków do odebrania. */
export const COLOR_ZERO_BAGS = '#cce5ff';

/** Kolor pinezki zaznaczonej do zbiorczego protokołu (poza paletą worków). */
const COLOR_BULK_SELECTED = '#6f42c1';

/** Paleta pinezek: jasny zielony (1–3), ciemny zielony (4–9), żółty (10–14). Dla 15+ — COLOR_15_PLUS; dla 0 — COLOR_ZERO_BAGS. */
export const PALETTE_PIN = ['#97F0C7', '#198754', COLOR_10_14] as const;

export function mapCoreBrowserScript(): string {
  return `    const map = L.map('map', { zoomControl: false }).setView([52.1, 19.4], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var colorBulkSelected = ${jsonForScript(COLOR_BULK_SELECTED)};
    function pinIcon(kolor, highlight) {
      var shadow = highlight
        ? '0 0 0 3px #ea3aed, 0 1px 4px rgba(0,0,0,0.45)'
        : '0 1px 4px rgba(0,0,0,0.4)';
      return L.divIcon({
        className: 'pin-woj',
        html: '<span style="display:block;width:24px;height:24px;border-radius:50%;background:' + kolor + ';border:2px solid #fff;box-shadow:' + shadow + '"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
    }
    /** setIcon odtwarza element DOM — przy 1440 pinezkach tylko gdy wygląd się zmienił. */
    function applyMarkerDisplayIcon(entry, searchHighlight) {
      var selected = isBulkPointSelected(entry.pointIdx);
      var fill = selected ? colorBulkSelected : entry.kolor;
      var highlighted = selected || searchHighlight;
      var iconKey = fill + '|' + (highlighted ? 1 : 0);
      if (entry.iconKey === iconKey) return;
      entry.iconKey = iconKey;
      entry.marker.options.pinKolor = fill;
      entry.marker.setIcon(pinIcon(fill, highlighted));
    }
    function clusterLabelColor(bg) {
      var light = { '#97f0c7': 1, '#cce5ff': 1, '#ffc107': 1 };
      return light[String(bg).toLowerCase()] ? '#145c38' : '#fff';
    }
    function dominantPinKolor(markers) {
      var counts = {};
      var best = '#97F0C7';
      var bestN = 0;
      for (var i = 0; i < markers.length; i++) {
        var c = (markers[i].options && markers[i].options.pinKolor) || '#97F0C7';
        counts[c] = (counts[c] || 0) + 1;
        if (counts[c] > bestN) {
          bestN = counts[c];
          best = c;
        }
      }
      return best;
    }
    function refreshClusterIcons() {
      if (typeof markersCluster === 'undefined' || !markersCluster.refreshClusters) return;
      if (typeof map === 'undefined' || !map.hasLayer(markersCluster)) return;
      try {
        markersCluster.refreshClusters();
      } catch (err) {
        console.error(err);
      }
    }
`;
}

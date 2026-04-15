/**
 * Faza 6: generowanie pliku mapy HTML.
 * Opcjonalnie: osadzony szablon Word + lista podwykonawców → generowanie .docx w przeglądarce (PizZip + docxtemplater z CDN).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOptionalWordMapAssetPaths } from './config.js';
import type { GeocodedAddress } from './phase5.js';
import {
  buildMapPointDocPayload,
  formatRodzajZbiorkiForDoc,
  loadPodwykoOptionsFromSpreadsheet,
  readWordTemplateAsBase64ForMap,
  type MapPointDocPayload,
  type PodwykoOption,
} from './wordMapSupport.js';

/** Kolor pinezki dla 15+ wystąpień (wyróżnienie dużych zbiórek). */
const COLOR_15_PLUS = '#fd7e14';

/** Strefa czasowa dla nazwy pliku mapy (czas polski: CET / CEST, nie strefa runnera). */
const MAP_FILENAME_TIME_ZONE = 'Europe/Warsaw';

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '00';
}

/**
 * Znacznik czasu w nazwie pliku: kalendarz i zegar w {@link MAP_FILENAME_TIME_ZONE}
 * (np. GitHub Actions = UTC — i tak dostajesz godzinę polską).
 */
export function formatTimestampForFileName(date: Date): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: MAP_FILENAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}_${partValue(
    parts,
    'hour',
  )}-${partValue(parts, 'minute')}-${partValue(parts, 'second')}`;
}

export function buildMapFileName(date: Date): string {
  return `mapa_${formatTimestampForFileName(date)}.html`;
}

export interface WordMapHtmlEmbed {
  templateBase64: string;
  podwykoOptions: PodwykoOption[];
}

type MapPoint = {
  adres: string;
  count: number;
  lat: number;
  lng: number;
  woj: string;
  confidence: 'ok' | 'ok_no_postcode' | 'uncertain' | 'city_only';
  /** Zbiórka: Ręczna / Maszyna (z kolumny L) */
  zbiorka?: string;
  /** Do {{rodzaj_zbiorki}} w Word: ręczna | automatyczna | ręczna i automatyczna */
  rodzaj_zbiorki: string;
  doc: MapPointDocPayload;
};

function toMapPoint(item: GeocodedAddress, confidence: MapPoint['confidence']): MapPoint {
  return {
    adres: item.address,
    count: item.count,
    lat: item.lat,
    lng: item.lng,
    woj: item.wojewodztwo || 'Nieznane',
    confidence,
    zbiorka: item.zbiorka,
    rodzaj_zbiorki: formatRodzajZbiorkiForDoc(item.zbiorka),
    doc: buildMapPointDocPayload(item.rows),
  };
}

const LEGEND_QUALITY: Record<MapPoint['confidence'], { label: string; color: string }> = {
  ok: { label: 'Adres OK', color: '#198754' },
  ok_no_postcode: { label: 'Bez kodu w wyniku', color: '#ffc107' },
  city_only: { label: 'Tylko kod + miasto', color: '#0d6efd' },
  uncertain: { label: 'Wynik niepewny', color: '#D40418' },
};

/** Palety: ciemny (10–14), średni (4–9), jasny (1–3). Dla 15+ używany COLOR_15_PLUS (pomarańczowy). */
const PALETTE_OK = ['#97F0C7', '#5CC494', '#198754'] as const; // jasny, średni, ciemny
const PALETTE_UNCERTAIN = ['#D1A5A9', '#CC606A', '#D40418'] as const;

export function buildMapHtml(
  geocoded: GeocodedAddress[],
  uncertainGeocoded: GeocodedAddress[],
  geoJsonUrl: string,
  cityOnlyGeocoded: GeocodedAddress[] = [],
  geocodedNoPostcode: GeocodedAddress[] = [],
  wordEmbed: WordMapHtmlEmbed | null = null,
): string {
  const points: MapPoint[] = [
    ...geocoded.map((item) => toMapPoint(item, 'ok')),
    ...geocodedNoPostcode.map((item) => toMapPoint(item, 'ok_no_postcode')),
    ...uncertainGeocoded.map((item) => toMapPoint(item, 'uncertain')),
    ...cityOnlyGeocoded.map((item) => toMapPoint(item, 'city_only')),
  ];

  const presentConfidences = [...new Set(points.map((p) => p.confidence))];
  const legendQualityItems = presentConfidences.map((c) => ({
    label: LEGEND_QUALITY[c].label,
    color: LEGEND_QUALITY[c].color,
  }));
  const hasAnyPoints = points.length > 0;
  const wordEnabled = Boolean(wordEmbed?.templateBase64);

  const wordHeadScripts = wordEnabled
    ? `  <script src="https://unpkg.com/pizzip@3.1.7/dist/pizzip.min.js" crossorigin=""></script>
  <script src="https://unpkg.com/docxtemplater@3.50.0/build/docxtemplater.js" crossorigin=""></script>
  <script src="https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js" crossorigin=""></script>
`
    : '';

  const wordModal = wordEnabled
    ? `  <div id="doc-modal" class="doc-modal-overlay" style="display:none" aria-hidden="true">
    <div class="doc-modal-panel" role="dialog" aria-labelledby="doc-modal-title">
      <h3 id="doc-modal-title">Generuj dokument Word</h3>
      <label for="doc-sel-przewoznik">Przewoźnik</label>
      <select id="doc-sel-przewoznik"></select>
      <label for="doc-sel-miejsce">Miejsce dostawy</label>
      <select id="doc-sel-miejsce"></select>
      <div class="doc-modal-actions">
        <button type="button" id="doc-btn-cancel">Anuluj</button>
        <button type="button" id="doc-btn-ok">Pobierz .docx</button>
      </div>
    </div>
  </div>
`
    : '';

  const docStyles = wordEnabled
    ? `
    .btn-gen-doc { margin-top: 8px; padding: 6px 12px; cursor: pointer; border-radius: 6px; border: 1px solid #0d6efd; background: #0d6efd; color: #fff; font-size: 13px; width: 100%; }
    .btn-gen-doc:hover { filter: brightness(1.05); }
    .doc-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 20000; align-items: center; justify-content: center; }
    .doc-modal-panel { background: #fff; padding: 20px 22px; border-radius: 10px; max-width: 420px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    .doc-modal-panel h3 { margin: 0 0 14px 0; font-size: 16px; }
    .doc-modal-panel label { display: block; font-size: 13px; margin: 10px 0 4px; color: #333; }
    .doc-modal-panel select { width: 100%; padding: 8px 10px; font-size: 14px; border-radius: 6px; border: 1px solid #ccc; box-sizing: border-box; }
    .doc-modal-actions { margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    .doc-modal-actions button { padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 14px; border: 1px solid #ccc; background: #f8f9fa; }
    #doc-btn-ok { background: #198754; border-color: #198754; color: #fff; }
`
    : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mapa adresów</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
${wordHeadScripts}  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100vh; }
    .leaflet-popup-content-wrapper { border-radius: 8px; }
    .leaflet-popup-content { margin: 12px 16px; min-width: 220px; }
    .popup-address { font-weight: 600; margin-bottom: 6px; color: #1a1a1a; }
    .popup-count { color: #0d6efd; font-size: 1.05em; }
    .popup-woj { font-size: 0.85em; color: #555; margin-top: 4px; }
    .popup-zbiorka { font-size: 0.85em; color: #0d6efd; margin-top: 4px; }
    .popup-confidence { font-size: 0.85em; color: #b02a37; margin-top: 4px; font-weight: 600; }
    .pin-woj { background: none !important; border: none !important; }
    .map-legend { background: #fff; padding: 10px 14px; border-radius: 8px; box-shadow: 0 1px 5px rgba(0,0,0,0.4); font-size: 12px; line-height: 1.5; }
    .map-legend h3 { margin: 0 0 6px 0; font-size: 13px; }
    .map-legend ul { margin: 0; padding: 0; list-style: none; }
    .map-legend li { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .map-legend li:last-child { margin-bottom: 0; }
    .map-legend .legend-swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.2); flex-shrink: 0; }
    .map-legend .legend-section { margin-bottom: 10px; }
    .map-legend .legend-section:last-child { margin-bottom: 0; }
${docStyles}  </style>
</head>
<body>
  <div id="map"></div>
${wordModal}  <script>
    const adresy = ${JSON.stringify(points)};
    const legendQualityItems = ${JSON.stringify(legendQualityItems)};
    const hasCountLegend = ${JSON.stringify(hasAnyPoints)};
    const wordDocEnabled = ${JSON.stringify(wordEnabled)};
    const PODWYKOLISTA = ${JSON.stringify(wordEmbed?.podwykoOptions ?? [])};
    const WORD_TEMPLATE_B64 = ${JSON.stringify(wordEmbed?.templateBase64 ?? '')};

    const map = L.map('map').setView([52.1, 19.4], 6);
    var attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    var layerCarto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; <a href="https://carto.com/attributions/">CARTO</a> | ' + attribution
    });
    var layerTileServerS = L.tileLayer('https://tileservers.com/hot/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://tileservers.com/">TileServers</a> | ' + attribution
    });
    layerCarto.addTo(map);
    layerCarto.once('tileerror', function() {
      map.removeLayer(layerCarto);
      map.addLayer(layerTileServerS);
    });

    function pinIcon(kolor) {
      return L.divIcon({
        className: 'pin-woj',
        html: '<span style="display:block;width:24px;height:24px;border-radius:50%;background:' + kolor + ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
    }

    function hexToRgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [ (n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255 ];
    }
    function rgbToHex(r, g, b) {
      return '#' + [r,g,b].map(function(x) {
        var v = Math.round(Math.max(0, Math.min(1, x)) * 255);
        return (v < 16 ? '0' : '') + v.toString(16);
      }).join('');
    }
    function hexWithSaturation(hex, satFactor) {
      var rgb = hexToRgb(hex);
      var r = rgb[0], g = rgb[1], b = rgb[2];
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2, h, s;
      if (max === min) { h = s = 0; }
      else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          default: h = ((r - g) / d + 4) / 6;
        }
      }
      s = Math.min(1, s * satFactor);
      if (s === 0) return rgbToHex(l, l, l);
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      var hue2rgb = function(p, q, t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      return rgbToHex(hue2rgb(p, q, h + 1/3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1/3));
    }
    var paletteOk = ${JSON.stringify([...PALETTE_OK])};
    var paletteUncertain = ${JSON.stringify([...PALETTE_UNCERTAIN])};
    var color15Plus = ${JSON.stringify(COLOR_15_PLUS)};
    function kolorPinezki(confidence, count) {
      if (count >= 15) return color15Plus;
      var idx = count >= 10 ? 2 : count >= 4 ? 1 : 0;
      if (confidence === 'ok' || confidence === 'ok_no_postcode') return paletteOk[idx];
      if (confidence === 'uncertain') return paletteUncertain[idx];
      var kolorBazowy = '#0d6efd';
      if (count >= 10) return kolorBazowy;
      if (count >= 4) return hexWithSaturation(kolorBazowy, 0.65);
      return hexWithSaturation(kolorBazowy, 0.35);
    }

    function fillSelect(sel, options) {
      sel.innerHTML = '';
      if (options.length === 0) {
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = '(Brak listy — dodaj docs/podwyko lista.xlsx lub ustaw PODWYKOLISTA_ODS_PATH)';
        sel.appendChild(o0);
        return;
      }
      var ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— wybierz —';
      sel.appendChild(ph);
      options.forEach(function (opt, idx) {
        var o = document.createElement('option');
        o.value = String(idx);
        o.textContent = opt.label;
        sel.appendChild(o);
      });
    }
    function openDocModal(pointIdx) {
      if (!wordDocEnabled) return;
      window.__currentDocPointIdx = pointIdx;
      var m = document.getElementById('doc-modal');
      var sp = document.getElementById('doc-sel-przewoznik');
      var sm = document.getElementById('doc-sel-miejsce');
      fillSelect(sp, PODWYKOLISTA);
      fillSelect(sm, PODWYKOLISTA);
      m.style.display = 'flex';
      m.setAttribute('aria-hidden', 'false');
    }
    function closeDocModal() {
      var m = document.getElementById('doc-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    }
    function b64ToUint8(b64) {
      var bin = atob(b64);
      var n = bin.length;
      var u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    function sanitizeFileNamePart(text) {
      return String(text)
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }
    function buildDocxDownloadName(przewoznikLabel, dataDdMmRr, adresSklepu) {
      var base = [sanitizeFileNamePart(przewoznikLabel), dataDdMmRr, sanitizeFileNamePart(adresSklepu)]
        .filter(function (x) { return x.length > 0; })
        .join(' ');
      if (base.length === 0) {
        base = 'dokument';
      }
      var maxLen = 220;
      if (base.length > maxLen) {
        base = base.slice(0, maxLen - 3).trim() + '...';
      }
      return base + '.docx';
    }
    function runDocGenerate() {
      var idx = window.__currentDocPointIdx;
      if (idx == null || idx < 0 || !adresy[idx]) {
        alert('Błąd: brak punktu.');
        return;
      }
      var prEl = document.getElementById('doc-sel-przewoznik');
      var mdEl = document.getElementById('doc-sel-miejsce');
      var prIdx = prEl ? prEl.value : '';
      var mdIdx = mdEl ? mdEl.value : '';
      if (prIdx === '' || mdIdx === '') {
        alert('Wybierz przewoźnika i miejsce dostawy.');
        return;
      }
      var pi = parseInt(prIdx, 10);
      var mi = parseInt(mdIdx, 10);
      var prOpt = PODWYKOLISTA[pi];
      var mdOpt = PODWYKOLISTA[mi];
      if (!prOpt || !mdOpt) {
        alert('Błąd wyboru z listy.');
        return;
      }
      var pr = prOpt.dane;
      var md = mdOpt.dane;
      var p = adresy[idx];
      try {
        var zip = new PizZip(b64ToUint8(WORD_TEMPLATE_B64));
        var Doc = window.docxtemplater;
        var doc = new Doc(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '{{', end: '}}' },
        });
        var tmr = new Date();
        tmr.setDate(tmr.getDate() + 1);
        var dd = String(tmr.getDate()).padStart(2, '0');
        var mm = String(tmr.getMonth() + 1).padStart(2, '0');
        var yyyy = String(tmr.getFullYear());
        var rr = yyyy.slice(-2);
        var dz = dd + '.' + mm + '.' + yyyy;
        var dzPlik = dd + '.' + mm + '.' + rr;
        doc.render({
          miejsce_zaladunku: p.doc.miejsce_zaladunku,
          lista_plomb: p.doc.lista_plomb,
          lista_plomb_xml: p.doc.lista_plomb_xml,
          przewoznik: pr,
          miejsce_dostawy: md,
          data_zaladunku: dz,
          rodzaj_zbiorki: p.rodzaj_zbiorki ? (' ' + p.rodzaj_zbiorki) : ''
        });
        var out = doc.getZip().generate({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        var safeName = buildDocxDownloadName(prOpt.label, dzPlik, p.adres);
        saveAs(out, safeName);
        closeDocModal();
      } catch (err) {
        console.error(err);
        alert('Nie udało się utworzyć dokumentu. Sprawdź szablon (tagi {{miejsce_zaladunku}}, {{przewoznik}}, …) i spróbuj ponownie.');
      }
    }

    if (wordDocEnabled) {
      document.getElementById('doc-btn-cancel').onclick = closeDocModal;
      document.getElementById('doc-btn-ok').onclick = runDocGenerate;
      document.getElementById('doc-modal').onclick = function(ev) {
        if (ev.target.id === 'doc-modal') closeDocModal();
      };
    }

    fetch(${JSON.stringify(geoJsonUrl)})
      .then(function(res) { return res.json(); })
      .then(function(geojson) {
        L.geoJSON(geojson, {
          style: { color: '#c00', weight: 3, fill: false }
        }).addTo(map);
      })
      .catch(function() {
        console.warn('Nie załadowano granic województw.');
      });

    adresy.forEach(function(p, pointIdx) {
      var kolor = kolorPinezki(p.confidence, p.count);
      const confidenceLabel =
        p.confidence === 'uncertain'
          ? '<div class="popup-confidence">Wynik niepewny</div>'
          : p.confidence === 'city_only'
            ? '<div class="popup-confidence">Tylko kod+miasto</div>'
            : p.confidence === 'ok_no_postcode'
              ? '<div class="popup-confidence">Bez kodu w wyniku</div>'
              : '';
      const zbiorkaLine = p.zbiorka
        ? '<div class="popup-zbiorka">Zbiórka: ' + p.zbiorka + '</div>'
        : '';
      const genDocBtn = wordDocEnabled
        ? '<div><button type="button" class="btn-gen-doc">Generuj dokument</button></div>'
        : '';
      const popupContent =
        '<div class="popup-address">' + p.adres + '</div>' +
        '<div class="popup-count">Liczba wystąpień: <strong>' + p.count + '</strong></div>' +
        (zbiorkaLine || '') +
        '<div class="popup-woj">' + p.woj + '</div>' +
        confidenceLabel +
        genDocBtn;
      var marker = L.marker([p.lat, p.lng], { icon: pinIcon(kolor) })
        .addTo(map)
        .bindPopup(popupContent);
      if (wordDocEnabled) {
        marker.on('popupopen', function() {
          var el = marker.getPopup().getElement();
          if (!el) return;
          var btn = el.querySelector('.btn-gen-doc');
          if (!btn) return;
          btn.onclick = function(ev) {
            if (ev.stopPropagation) ev.stopPropagation();
            openDocModal(pointIdx);
          };
        });
      }
    });

    if (adresy.length > 0) {
      map.fitBounds(adresy.map(function(p) { return [p.lat, p.lng]; }), { padding: [40, 40] });
    }

    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      var div = L.DomUtil.create('div', 'map-legend');
      var qualityHtml = legendQualityItems.length > 0
        ? '<div class="legend-section"><h3>Jakość adresu</h3><ul>' +
          legendQualityItems.map(function(item) {
            return '<li><span class="legend-swatch" style="background:' + item.color + '"></span> ' + item.label + '</li>';
          }).join('') + '</ul></div>'
        : '';
      var okLight = paletteOk[0], okMed = paletteOk[1], okFull = paletteOk[2];
      var countHtml = hasCountLegend
        ? '<div class="legend-section"><h3>Liczba wystąpień</h3><ul>' +
          '<li><span class="legend-swatch" style="background:' + okLight + '"></span> 1–3</li>' +
          '<li><span class="legend-swatch" style="background:' + okMed + '"></span> 4–9</li>' +
          '<li><span class="legend-swatch" style="background:' + okFull + '"></span> 10–14</li>' +
          '<li><span class="legend-swatch" style="background:' + color15Plus + '"></span> 15+</li>' +
          '</ul></div>'
        : '';
      div.innerHTML = qualityHtml + countHtml;
      return div;
    };
    legend.addTo(map);
  </script>
</body>
</html>`;
}

async function resolveWordMapHtmlEmbed(
  input: ExecutePhase6Input,
): Promise<WordMapHtmlEmbed | null> {
  if (input.wordMapEmbed !== undefined) {
    const manual = input.wordMapEmbed;
    if (!manual.templateBase64) {
      return null;
    }
    return {
      templateBase64: manual.templateBase64,
      podwykoOptions: manual.podwykoOptions ?? [],
    };
  }
  const paths = input.wordMapPaths ?? getOptionalWordMapAssetPaths();
  try {
    const templateBase64 = await readWordTemplateAsBase64ForMap(paths.templatePath);
    let podwykoOptions: PodwykoOption[] = [];
    try {
      podwykoOptions = await loadPodwykoOptionsFromSpreadsheet(paths.podwykoPath);
    } catch {
      /* brak lub uszkodzony plik listy */
    }
    return { templateBase64, podwykoOptions };
  } catch {
    return null;
  }
}

export interface ExecutePhase6Input {
  outputDir: string;
  geocoded: GeocodedAddress[];
  uncertainGeocoded: GeocodedAddress[];
  cityOnlyGeocoded?: GeocodedAddress[];
  geocodedNoPostcode?: GeocodedAddress[];
  geoJsonUrl: string;
  /** Jawne osadzenie szablonu/listy (testy) albo wyłączenie przez { templateBase64: '' }. */
  wordMapEmbed?: WordMapHtmlEmbed;
  /** Nadpisuje domyślne ścieżki docs/pusty.docx i docs/podwyko lista.xlsx */
  wordMapPaths?: { templatePath: string; podwykoPath: string };
  now?: () => Date;
  mkdirFn?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFileFn?: (path: string, content: string, encoding: BufferEncoding) => Promise<unknown>;
}

export interface ExecutePhase6Result {
  fileName: string;
  filePath: string;
  htmlContent: string;
}

export async function executePhase6(input: ExecutePhase6Input): Promise<ExecutePhase6Result> {
  const now = input.now ?? (() => new Date());
  const mkdirFn = input.mkdirFn ?? mkdir;
  const writeFileFn =
    input.writeFileFn ??
    (async (path: string, content: string, encoding: BufferEncoding) => {
      await writeFile(path, content, encoding);
    });

  const fileName = buildMapFileName(now());
  const filePath = join(input.outputDir, fileName);
  const wordEmbed = await resolveWordMapHtmlEmbed(input);
  const htmlContent = buildMapHtml(
    input.geocoded,
    input.uncertainGeocoded,
    input.geoJsonUrl,
    input.cityOnlyGeocoded ?? [],
    input.geocodedNoPostcode ?? [],
    wordEmbed,
  );

  await mkdirFn(input.outputDir, { recursive: true });
  await writeFileFn(filePath, htmlContent, 'utf-8');

  return { fileName, filePath, htmlContent };
}

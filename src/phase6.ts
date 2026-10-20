/**
 * Faza 6: generowanie pliku mapy HTML.
 * Opcjonalnie: osadzony szablon Word + lista podwykonawców → generowanie .docx w przeglądarce (PizZip + docxtemplater z CDN).
 * Części strony: `src/map/` (logika TS, HTML, CSS) i `src/map/browser/` (skrypt przeglądarki).
 */

import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { getOptionalWordMapAssetPaths, getTransportWebAppUrl } from './config.js';
import { SITE_PASSWORD_FETCH_SNIPPET } from './sitePasswordFetchSnippet.js';
import { jsonForScript } from './jsonForScript.js';
import type { GeocodedAddress } from './phase5.js';
import {
  loadPodwykoOptionsFromSpreadsheet,
  readWordTemplateAsBase64ForMap,
  type PodwykoOption,
} from './wordMapSupport.js';
import { loadPodwykoOptionsWithReferenceFallback } from './referenceData.js';
import {
  manualAdminBrowserScript,
  manualAdminCss,
  manualAdminHtml,
} from './buildMapManualAdmin.js';
import {
  harmonogramPanelBrowserScript,
  harmonogramPanelCss,
  harmonogramPanelHtml,
} from './buildMapHarmonogram.js';
import { routeNameBrowserScript } from './routeName.js';
import { routeProtocolBrowserScript } from './routeProtocol.js';
import { harmonogramDaysPickerBrowserScript } from './harmonogramDays.js';
import { classifyMapPointZbiorka, normalizeWgHarmonogramu } from './zbiorkaClassify.js';
import { spreadCloseMarkerPositions } from './map/geometry.js';
import { toMapPoint, type MapPoint } from './map/mapPoint.js';
import { uniqueWojewodztwaFromMapPoints } from './map/searchFilters.js';
import { mapSharedBrowserScript } from './map/sharedBrowserScript.js';
import { bulkRatesModalHtml, transportOverlayHtml, wordModalHtml } from './map/modalsHtml.js';
import { docCss, mapBaseCss, transportCss } from './map/styles.js';
import { mapCoreBrowserScript } from './map/browser/mapCore.js';
import { filtersUiBrowserScript } from './map/browser/filtersUi.js';
import { markersPopupBrowserScript } from './map/browser/markersPopup.js';
import { errorsApiBrowserScript } from './map/browser/errorsApi.js';
import { sealListsBrowserScript } from './map/browser/sealLists.js';
import { docModalBrowserScript } from './map/browser/docModal.js';
import { bulkRatesBrowserScript } from './map/browser/bulkRates.js';
import { docxRenderBrowserScript } from './map/browser/docxRender.js';
import { routeFormBrowserScript } from './map/browser/routeForm.js';
import { bolecinBrowserScript } from './map/browser/bolecin.js';
import { docGenerateBrowserScript } from './map/browser/docGenerate.js';
import { bootstrapBrowserScript } from './map/browser/bootstrap.js';

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

/** Etykieta na mapie i stronie Pages: `25.02.2026, 18:05:06` (Europe/Warsaw). */
export function formatGeneratedAtLabel(date: Date): string {
  const stamp = formatTimestampForFileName(date);
  const [ymd, hms] = stamp.split('_');
  const [year, month, day] = (ymd ?? '').split('-');
  const [hour, minute, second] = (hms ?? '').split('-');
  return `${day}.${month}.${year}, ${hour}:${minute}:${second}`;
}

export interface WordMapHtmlEmbed {
  templateBase64: string;
  podwykoOptions: PodwykoOption[];
}

export function buildMapHtml(
  geocoded: GeocodedAddress[],
  uncertainGeocoded: GeocodedAddress[],
  geoJsonUrl: string,
  cityOnlyGeocoded: GeocodedAddress[] = [],
  geocodedNoPostcode: GeocodedAddress[] = [],
  wordEmbed: WordMapHtmlEmbed | null = null,
  transportWebAppUrl: string = '',
  generatedAtLabel: string = '',
): string {
  const rawPoints: MapPoint[] = [
    ...geocoded.map((item) => toMapPoint(item, 'ok')),
    ...geocodedNoPostcode.map((item) => toMapPoint(item, 'ok_no_postcode')),
    ...uncertainGeocoded.map((item) => toMapPoint(item, 'uncertain')),
    ...cityOnlyGeocoded.map((item) => toMapPoint(item, 'city_only')),
  ];
  const points: MapPoint[] = spreadCloseMarkerPositions(rawPoints);

  const hasAnyPoints = points.length > 0;
  const showZbiorkaFilter = points.some((p) => classifyMapPointZbiorka(p.zbiorka) !== 'unknown');
  const showHarmonogramFilter = points.some((p) => {
    const v = normalizeWgHarmonogramu(p.wgHarmonogramu);
    return v === 'tak' || v === 'nie';
  });
  const wojewodztwaOptions = uniqueWojewodztwaFromMapPoints(points);
  const showWojewodztwoFilter = wojewodztwaOptions.length >= 2;
  const wordEnabled = Boolean(wordEmbed?.templateBase64);
  const transportApiEnabled = wordEnabled && transportWebAppUrl.length > 0;
  const referenceAdminEnabled = transportWebAppUrl.length > 0;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mapa adresów</title>
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" crossorigin=""></script>
  <style>
${mapBaseCss()}${transportApiEnabled ? transportCss() : ''}${referenceAdminEnabled ? manualAdminCss() : ''}${referenceAdminEnabled ? harmonogramPanelCss() : ''}${wordEnabled ? docCss() : ''}  </style>
</head>
<body>
  <div id="map"></div>
  <div id="map-error-stack" class="map-error-stack" aria-live="polite" hidden></div>
${transportApiEnabled ? transportOverlayHtml() : ''}${wordEnabled ? wordModalHtml() : ''}${transportApiEnabled ? bulkRatesModalHtml() : ''}${referenceAdminEnabled ? manualAdminHtml() : ''}${referenceAdminEnabled ? harmonogramPanelHtml() : ''}  <script>
${SITE_PASSWORD_FETCH_SNIPPET}
    const adresy = ${jsonForScript(points)};
    const hasCountLegend = ${jsonForScript(hasAnyPoints)};
    const showZbiorkaFilter = ${jsonForScript(showZbiorkaFilter)};
    const showHarmonogramFilter = ${jsonForScript(showHarmonogramFilter)};
    const showWojewodztwoFilter = ${jsonForScript(showWojewodztwoFilter)};
    const wordDocEnabled = ${jsonForScript(wordEnabled)};
    const transportApiEnabled = ${jsonForScript(transportApiEnabled)};
    const TRANSPORT_WEBAPP_URL = ${jsonForScript(transportWebAppUrl)};
    const PODWYKOLISTA = ${jsonForScript(wordEmbed?.podwykoOptions ?? [])};
    const WORD_TEMPLATE_B64 = ${jsonForScript(wordEmbed?.templateBase64 ?? '')};
${wordEnabled ? routeNameBrowserScript() : ''}${wordEnabled ? routeProtocolBrowserScript() : ''}${(wordEnabled || referenceAdminEnabled) ? harmonogramDaysPickerBrowserScript() : ''}${wordEnabled ? "    var lastRouteName = '';\n    var lastRouteRate = '';\n    var routeNameMode = 'continue';\n    var routeRateBaseline = '';\n    var routeRateBaselineName = '';\n    var routeNameTouched = false;\n    var routeRateTouched = false;\n    var routeRateRequest = 0;\n    var routeRateTimer = 0;\n    var routeNameProposeTicket = 0;\n" : ''}

${mapCoreBrowserScript()}${mapSharedBrowserScript()}
${filtersUiBrowserScript()}${markersPopupBrowserScript()}${errorsApiBrowserScript()}${sealListsBrowserScript()}${docModalBrowserScript()}${bulkRatesBrowserScript()}${docxRenderBrowserScript()}${routeFormBrowserScript()}${bolecinBrowserScript()}${docGenerateBrowserScript()}${bootstrapBrowserScript({ geoJsonUrl, wojewodztwaOptions, generatedAtLabel })}${referenceAdminEnabled ? manualAdminBrowserScript() : ''}${referenceAdminEnabled ? harmonogramPanelBrowserScript() : ''}
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
      podwykoOptions = await loadPodwykoOptionsWithReferenceFallback(
        paths.podwykoPath,
        loadPodwykoOptionsFromSpreadsheet,
      );
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
  wordMapPaths?: { templatePath: string; podwykoPath: string; faviconPath?: string };
  /** URL Web App rejestru transportów (nadpisuje TRANSPORT_WEBAPP_URL z env). */
  transportWebAppUrl?: string;
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

  const generatedAt = now();
  const fileName = buildMapFileName(generatedAt);
  const filePath = join(input.outputDir, fileName);
  const wordEmbed = await resolveWordMapHtmlEmbed(input);
  const transportWebAppUrl = input.transportWebAppUrl ?? getTransportWebAppUrl();
  const htmlContent = buildMapHtml(
    input.geocoded,
    input.uncertainGeocoded,
    input.geoJsonUrl,
    input.cityOnlyGeocoded ?? [],
    input.geocodedNoPostcode ?? [],
    wordEmbed,
    transportWebAppUrl,
    formatGeneratedAtLabel(generatedAt),
  );

  await mkdirFn(input.outputDir, { recursive: true });
  await writeFileFn(filePath, htmlContent, 'utf-8');

  const assetPaths = input.wordMapPaths ?? getOptionalWordMapAssetPaths();
  const faviconPath =
    assetPaths.faviconPath ?? getOptionalWordMapAssetPaths().faviconPath;
  try {
    await access(faviconPath, constants.R_OK);
    await copyFile(faviconPath, join(input.outputDir, 'favicon.svg'));
  } catch {
    /* opcjonalny asset */
  }

  return { fileName, filePath, htmlContent };
}

/**
 * Faza 7: orkiestracja pełnego pipeline + obsługa CLI.
 */

import {
  getConfig,
  getPhase5CacheFilePath,
  getEwidencjaOdbiorowSheetsId,
  getNominatimUserAgent,
  getTransportSheetsId,
  GEOJSON_WOJEWODZTWA_URL,
} from './config.js';
import { isCopyOdebraneZHarmonogramuEnabled } from './harmonogramDays.js';
import { syncBazaCenHarmonogram } from './bazaCenHarmonogram.js';
import { executeOdebraneZHarmonogramu } from './odebraneZHarmonogramu.js';
import { syncZestawienieHarmonogram } from './syncZestawienieHarmonogram.js';
import { fillMissingReportRates } from './fillReportRates.js';
import { applyAddressAliases, createSheetsClient, loadAddressAliases, loadSourceRows } from './sheets.js';
import { executePhase3 } from './phase3.js';
import { executePhase4 } from './phase4.js';
import { executePhase5 } from './phase5.js';
import { executePhase6 } from './phase6.js';
import { logArkuszMapaError } from './mapErrorReport.js';
import { loadReferenceDataFromSheets } from './referenceData.js';
import type { PoprawAdresEntry } from './poprawAdres.js';

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
}

/** Próby przy chwilowych błędach OAuth / sieci (typowe na GitHub Actions) i 429/5xx Google API. */
const GOOGLE_API_MAX_ATTEMPTS = 3;
const GOOGLE_API_RETRY_DELAYS_MS = [2000, 5000, 10000] as const;
/** Limit Sheets API liczony na minutę — krótsze odczekanie nic nie daje. */
const GOOGLE_API_QUOTA_RETRY_DELAYS_MS = [30000, 60000] as const;
const GOOGLE_API_QUOTA_JITTER_MS = 5000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function googleApiHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const e = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const value of [e.status, e.response?.status, e.code]) {
    const status = typeof value === 'string' ? Number(value) : value;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600) {
      return status;
    }
  }
  return undefined;
}

export function isRetryableGoogleApiError(error: unknown): boolean {
  const status = googleApiHttpStatus(error);
  if (status !== undefined && RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Premature close/i.test(message) ||
    /Invalid response body/i.test(message) ||
    /ECONNRESET/i.test(message) ||
    /ETIMEDOUT/i.test(message) ||
    /socket hang up/i.test(message) ||
    /fetch failed/i.test(message)
  );
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function googleApiRetryDelayMs(error: unknown, attempt: number): number {
  if (googleApiHttpStatus(error) === 429) {
    const base = GOOGLE_API_QUOTA_RETRY_DELAYS_MS[attempt] ?? 60000;
    return base + Math.floor(Math.random() * GOOGLE_API_QUOTA_JITTER_MS);
  }
  return GOOGLE_API_RETRY_DELAYS_MS[attempt] ?? 10000;
}

export async function withGoogleApiRetry<T>(
  label: string,
  fn: () => Promise<T>,
  logger: LoggerLike,
  sleepFn: (ms: number) => Promise<void> = sleepMs,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < GOOGLE_API_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = isRetryableGoogleApiError(error) && attempt < GOOGLE_API_MAX_ATTEMPTS - 1;
      if (!canRetry) {
        throw error;
      }
      const delayMs = googleApiRetryDelayMs(error, attempt);
      const log = logger.warn ?? logger.info;
      log(
        'Google API %s failed (attempt %d/%d): %s — retry in %d ms',
        label,
        attempt + 1,
        GOOGLE_API_MAX_ATTEMPTS,
        error instanceof Error ? error.message : String(error),
        delayMs,
      );
      await sleepFn(delayMs);
    }
  }
  throw lastError;
}

interface RuntimeConfig {
  sheetsId: string;
  credentialsPath: string;
  outputDir: string;
  geoJsonUrl?: string;
}

export interface Phase7Deps {
  getConfig: () => RuntimeConfig;
  createSheetsClient: typeof createSheetsClient;
  loadSourceRows: typeof loadSourceRows;
  executeOdebraneZHarmonogramu: typeof executeOdebraneZHarmonogramu;
  syncBazaCenHarmonogram: typeof syncBazaCenHarmonogram;
  syncZestawienieHarmonogram: typeof syncZestawienieHarmonogram;
  fillMissingReportRates: typeof fillMissingReportRates;
  isCopyOdebraneZHarmonogramuEnabled: typeof isCopyOdebraneZHarmonogramuEnabled;
  getEwidencjaOdbiorowSheetsId: typeof getEwidencjaOdbiorowSheetsId;
  getNominatimUserAgent: () => string | undefined;
  executePhase3: typeof executePhase3;
  executePhase5: typeof executePhase5;
  executePhase4: typeof executePhase4;
  executePhase6: typeof executePhase6;
  loadReferenceDataFromSheets: typeof loadReferenceDataFromSheets;
  logger: LoggerLike;
}

export interface Phase7Result {
  sheetTitle: string;
  sourceRowsCount: number;
  duplicateSealRowsCount: number;
  uniqueRowsCount: number;
  uniqueAddressCount: number;
  geocodedCount: number;
  uncertainCount: number;
  badAddressRowsCount: number;
  uncertainAddressRowsCount: number;
  mapFilePath: string;
  odebraneAppendedCount: number;
  reportRatesFilledCount: number;
  /** Kroki zapisu do arkuszy, które padły; mapa i tak powstała. */
  failedWriteSteps: string[];
}

/** Kod wyjścia CLI: mapa gotowa, ale część zapisów do arkuszy się nie udała. */
export const EXIT_CODE_WRITE_STEPS_FAILED = 2;

const defaultDeps: Phase7Deps = {
  getConfig,
  createSheetsClient,
  loadSourceRows,
  executeOdebraneZHarmonogramu,
  syncBazaCenHarmonogram,
  syncZestawienieHarmonogram,
  fillMissingReportRates,
  isCopyOdebraneZHarmonogramuEnabled,
  getEwidencjaOdbiorowSheetsId,
  getNominatimUserAgent: () => getNominatimUserAgent(),
  executePhase3,
  executePhase5,
  executePhase4,
  executePhase6,
  loadReferenceDataFromSheets,
  logger: {
    info: console.log,
    error: console.error,
  },
};

export async function runPhase7Pipeline(customDeps?: Partial<Phase7Deps>): Promise<Phase7Result> {
  const deps = { ...defaultDeps, ...customDeps } as Phase7Deps;

  deps.logger.info('Pipeline start');
  const config = deps.getConfig();
  deps.logger.info('Config loaded, creating Sheets client');
  deps.logger.info('Loading source rows from Google Sheets');
  let sheetsClient: ReturnType<Phase7Deps['createSheetsClient']>;
  const source = await withGoogleApiRetry(
    'loadSourceRows',
    async () => {
      sheetsClient = deps.createSheetsClient(config.credentialsPath);
      return deps.loadSourceRows(sheetsClient, config.sheetsId);
    },
    deps.logger,
  );
  const addressAliases = await loadAddressAliases();
  const rowsForPipeline = applyAddressAliases(source.rows, addressAliases);
  if (Object.keys(addressAliases).length > 0) {
    const merged = rowsForPipeline.filter((r, i) => r.address !== source.rows[i]!.address).length;
    if (merged > 0) {
      deps.logger.info(
        'Applied %d address alias(es); %d row(s) merged to canonical address',
        Object.keys(addressAliases).length,
        merged,
      );
    }
  }

  const failedWriteSteps: string[] = [];
  async function runWriteStep<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withGoogleApiRetry(label, fn, deps.logger);
    } catch (error) {
      failedWriteSteps.push(label);
      logArkuszMapaError(deps.logger, {
        code: 'MAP-E-SHEETS-WRITE',
        place: `phase7.ts ${label}`,
        summary: `Zapis do arkusza w kroku ${label} się nie udał.`,
        effect: 'Mapa powstaje dalej. Przebieg kończy się błędem po publikacji; następny przebieg ponowi zapis.',
        technical: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  let odebraneAppendedCount = 0;
  let reportRatesFilledCount = 0;
  if (deps.isCopyOdebraneZHarmonogramuEnabled()) {
    const ewidencjaId = deps.getEwidencjaOdbiorowSheetsId();
    if (!ewidencjaId) {
      throw new Error(
        'COPY_ODEBRANE_Z_HARMONOGRAMU=1 wymaga GOOGLE_EWIDENCJA_ODBIOROW_SHEETS_ID (arkusz ewidencja odbiorów)',
      );
    }
    deps.logger.info(
      'COPY_ODEBRANE_Z_HARMONOGRAMU enabled — read trasówki, write ewidencja (%s)',
      ewidencjaId,
    );
    const odebrane = await runWriteStep('executeOdebraneZHarmonogramu', () =>
      deps.executeOdebraneZHarmonogramu(
        sheetsClient,
        {
          targetSpreadsheetId: ewidencjaId,
          headers: source.headers,
          rows: source.rows,
          columnMap: source.columnMap,
        },
        deps.logger,
      ),
    );
    odebraneAppendedCount = odebrane?.appendedCount ?? 0;
    await runWriteStep('syncBazaCenHarmonogram', () =>
      deps.syncBazaCenHarmonogram(sheetsClient, { spreadsheetId: ewidencjaId }, deps.logger),
    );
    await runWriteStep('syncZestawienieHarmonogram', () =>
      deps.syncZestawienieHarmonogram(sheetsClient, { spreadsheetId: ewidencjaId }, deps.logger),
    );
    const reportRates = await runWriteStep('fillMissingReportRates', () =>
      deps.fillMissingReportRates(sheetsClient, { spreadsheetId: ewidencjaId }, deps.logger),
    );
    reportRatesFilledCount = reportRates?.filledCells ?? 0;
  }

  deps.logger.info('Executing phase 3 (duplicates + grouping)');
  const phase3 = deps.executePhase3(rowsForPipeline);

  let poprawAdresIndex: Map<string, PoprawAdresEntry> | undefined;
  try {
    const referenceData = await withGoogleApiRetry(
      'loadReferenceDataFromSheets',
      () => deps.loadReferenceDataFromSheets(sheetsClient!, getTransportSheetsId()),
      deps.logger,
    );
    poprawAdresIndex = referenceData.poprawAdresIndex;
    if (referenceData.poprawAdres.length > 0) {
      deps.logger.info(
        'Loaded %d popraw-adres entries from transport reference sheet',
        referenceData.poprawAdres.length,
      );
    }
  } catch (error) {
    logArkuszMapaError(deps.logger, {
      code: 'MAP-E-REFERENCE-SKIP',
      place: 'phase7.ts loadReferenceDataFromSheets',
      summary: 'Nie udało się wczytać arkusza referencji (popraw adres).',
      effect: 'Mapa powstaje bez poprawek adresów.',
      technical: error instanceof Error ? error.message : String(error),
    });
  }

  deps.logger.info('Executing phase 5 (geocoding)');
  const nominatimUserAgent = deps.getNominatimUserAgent();
  if (!nominatimUserAgent) {
    (deps.logger.warn ?? deps.logger.info)(
      'NOMINATIM_CONTACT_EMAIL nie ustawiony (albo nie jest adresem e-mail) — User-Agent Nominatim bez kontaktu',
    );
  }
  const phase5 = await deps.executePhase5(phase3.groupedByAddress, {
    cacheFilePath: getPhase5CacheFilePath(config.outputDir),
    poprawAdresIndex,
    userAgent: nominatimUserAgent,
    batchSize: 20,
    requestTimeoutMs: 5000,
    rateLimitMs: 1100,
    logger: deps.logger,
  });

  deps.logger.info('Executing phase 4 (write tabs)');
  await runWriteStep('executePhase4', () =>
    deps.executePhase4(sheetsClient, {
      spreadsheetId: config.sheetsId,
      headers: source.headers,
      rowsDuplikatyPlomb: phase3.rowsDuplikatyPlomb,
      rowsNiepewneWyniki: phase5.rowsNiepewneWyniki,
      groupedNiepewneAdresy: phase5.groupedNiepewneAdresy,
      groupedBledneAdresy: phase5.groupedBledneAdresy,
      geocoded: phase5.geocoded,
      geocodedNoPostcode: phase5.geocodedNoPostcode,
      uncertainGeocoded: phase5.uncertainGeocoded,
      cityOnlyGeocoded: phase5.cityOnlyGeocoded,
    }),
  );

  deps.logger.info('Executing phase 6 (generate map HTML)');
  const phase6 = await deps.executePhase6({
    outputDir: config.outputDir,
    geocoded: phase5.geocoded,
    uncertainGeocoded: phase5.uncertainGeocoded,
    cityOnlyGeocoded: phase5.cityOnlyGeocoded,
    geocodedNoPostcode: phase5.geocodedNoPostcode,
    geoJsonUrl: config.geoJsonUrl ?? GEOJSON_WOJEWODZTWA_URL,
  });

  const result: Phase7Result = {
    sheetTitle: source.sheetTitle,
    sourceRowsCount: source.rows.length,
    duplicateSealRowsCount: phase3.rowsDuplikatyPlomb.length,
    uniqueRowsCount: phase3.rowsBezDuplikatow.length,
    uniqueAddressCount: phase3.groupedByAddress.size,
    geocodedCount: phase5.geocoded.length,
    uncertainCount: phase5.uncertainGeocoded.length,
    badAddressRowsCount: phase5.rowsBledneAdresy.length,
    uncertainAddressRowsCount: phase5.rowsNiepewneWyniki.length,
    mapFilePath: phase6.filePath,
    odebraneAppendedCount,
    reportRatesFilledCount,
    failedWriteSteps,
  };

  deps.logger.info('Sheets loaded from tab: %s', result.sheetTitle);
  deps.logger.info('Rows count (without header): %d', result.sourceRowsCount);
  deps.logger.info('Rows with duplicate seals: %d', result.duplicateSealRowsCount);
  deps.logger.info('Rows without duplicate seals: %d', result.uniqueRowsCount);
  deps.logger.info('Unique addresses (without duplicate seals): %d', result.uniqueAddressCount);
  deps.logger.info('Geocoding batches: %d', phase5.totalBatches);
  deps.logger.info('Pewne (zielone) unique addresses: %d', phase5.geocodedUniqueAddresses);
  deps.logger.info('Pewne bez kodu (żółte) unique addresses: %d', phase5.geocodedNoPostcodeUniqueAddresses);
  deps.logger.info('Niepewne unique addresses: %d', phase5.uncertainUniqueAddresses);
  deps.logger.info('Tylko kod+miasto (niebieskie) unique addresses: %d', phase5.cityOnlyUniqueAddresses);
  deps.logger.info('Bledne unique addresses: %d', phase5.badUniqueAddresses);
  deps.logger.info('Niepewne address rows: %d', result.uncertainAddressRowsCount);
  deps.logger.info('Bad address rows: %d', result.badAddressRowsCount);
  deps.logger.info('Map generated: %s', result.mapFilePath);

  return result;
}

export interface RunCliOptions {
  pipelineFn?: () => Promise<Phase7Result>;
  logger?: LoggerLike;
  exitFn?: (code: number) => void;
}

export async function runPhase7Cli(options: RunCliOptions = {}): Promise<void> {
  const pipelineFn = options.pipelineFn ?? (() => runPhase7Pipeline());
  const logger = options.logger ?? defaultDeps.logger;
  const exitFn = options.exitFn ?? process.exit;

  try {
    const result = await pipelineFn();
    if (result.failedWriteSteps.length > 0) {
      logger.error('Map generated, but write steps failed: %s', result.failedWriteSteps.join(', '));
      exitFn(EXIT_CODE_WRITE_STEPS_FAILED);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Pipeline failed: %s', message);
    exitFn(1);
  }
}

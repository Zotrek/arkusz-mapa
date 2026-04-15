/**
 * Faza 7: orkiestracja pełnego pipeline + obsługa CLI.
 */

import { join } from 'node:path';
import { getConfig, GEOJSON_WOJEWODZTWA_URL } from './config.js';
import { createSheetsClient, loadSourceRows } from './sheets.js';
import { executePhase3 } from './phase3.js';
import { executePhase4 } from './phase4.js';
import { executePhase5 } from './phase5.js';
import { executePhase6 } from './phase6.js';

interface LoggerLike {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
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
  executePhase3: typeof executePhase3;
  executePhase5: typeof executePhase5;
  executePhase4: typeof executePhase4;
  executePhase6: typeof executePhase6;
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
}

const defaultDeps: Phase7Deps = {
  getConfig,
  createSheetsClient,
  loadSourceRows,
  executePhase3,
  executePhase5,
  executePhase4,
  executePhase6,
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
  const sheetsClient = deps.createSheetsClient(config.credentialsPath);
  deps.logger.info('Loading source rows from Google Sheets');
  const source = await deps.loadSourceRows(sheetsClient, config.sheetsId);
  deps.logger.info('Executing phase 3 (duplicates + grouping)');
  const phase3 = deps.executePhase3(source.rows);
  deps.logger.info('Executing phase 5 (geocoding)');
  const phase5 = await deps.executePhase5(phase3.groupedByAddress, {
    cacheFilePath: join(config.outputDir, 'phase5-cache.json'),
    batchSize: 20,
    requestTimeoutMs: 5000,
    rateLimitMs: 1100,
    logger: deps.logger,
  });

  deps.logger.info('Executing phase 4 (write tabs)');
  await deps.executePhase4(sheetsClient, {
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
  });

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
    await pipelineFn();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Pipeline failed: %s', message);
    exitFn(1);
  }
}

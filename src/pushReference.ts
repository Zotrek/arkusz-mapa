/**
 * CLI: wgraj listę podwykonawców z docs/podwyko lista.xlsx → Google Sheet (Lista podwykonawców).
 * Uruchom: npm run push:reference
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
  getConfig,
  getOptionalWordMapAssetPaths,
  getTransportSheetsId,
  type AppConfig,
} from './config.js';
import {
  loadReferenceDataFromSheets,
  mergePodwykoEntries,
  writePodwykoListaToSheets,
  type ReferenceDataBundle,
} from './referenceData.js';
import { createSheetsClient } from './sheets.js';
import { loadPodwykoOptionsFromSpreadsheet, type PodwykoOption } from './wordMapSupport.js';

interface LoggerLike {
  log: (message?: unknown, ...args: unknown[]) => void;
  error: (message?: unknown, ...args: unknown[]) => void;
}

export interface PushReferenceCliDeps {
  getConfig?: () => AppConfig;
  getPaths?: () => { podwykoPath: string; templatePath: string; faviconPath: string };
  getSpreadsheetId?: () => string;
  loadFromXlsx?: (path: string) => Promise<PodwykoOption[]>;
  createClient?: (credentialsPath: string) => unknown;
  loadExisting?: (client: unknown, spreadsheetId: string) => Promise<ReferenceDataBundle>;
  writeSheet?: (
    client: unknown,
    spreadsheetId: string,
    podwykoLista: PodwykoOption[],
  ) => Promise<void>;
  logger?: LoggerLike;
  exitFn?: (code: number) => void;
}

export async function runPushReferenceCli(deps: PushReferenceCliDeps = {}): Promise<void> {
  const resolveConfig = deps.getConfig ?? getConfig;
  const getPaths = deps.getPaths ?? getOptionalWordMapAssetPaths;
  const getSpreadsheetId = deps.getSpreadsheetId ?? getTransportSheetsId;
  const loadFromXlsx = deps.loadFromXlsx ?? loadPodwykoOptionsFromSpreadsheet;
  const createClient = deps.createClient ?? createSheetsClient;
  const loadExisting =
    deps.loadExisting ??
    ((client, spreadsheetId) =>
      loadReferenceDataFromSheets(client as Parameters<typeof loadReferenceDataFromSheets>[0], spreadsheetId));
  const writeSheet =
    deps.writeSheet ??
    ((client, spreadsheetId, lista) =>
      writePodwykoListaToSheets(
        client as Parameters<typeof writePodwykoListaToSheets>[0],
        spreadsheetId,
        lista,
      ));
  const logger = deps.logger ?? console;
  const exitFn = deps.exitFn ?? process.exit;

  try {
    const config = resolveConfig();
    const paths = getPaths();
    const spreadsheetId = getSpreadsheetId();

    logger.log('[arkusz-mapa] push:reference start');
    logger.log(`  xlsx: ${paths.podwykoPath}`);
    logger.log(`  sheet: ${spreadsheetId}`);

    const fromXlsx = await loadFromXlsx(paths.podwykoPath);
    if (fromXlsx.length === 0) {
      logger.error('[arkusz-mapa] push:reference — brak wpisów w pliku XLSX');
      exitFn(1);
      return;
    }

    const client = createClient(config.credentialsPath);
    const existing = await loadExisting(client, spreadsheetId);
    const merged = mergePodwykoEntries([
      fromXlsx.map((item) => ({ baseLabel: item.label, dane: item.dane })),
      existing.podwykoLista.map((item) => ({ baseLabel: item.label, dane: item.dane })),
    ]);

    await writeSheet(client, spreadsheetId, merged);

    const added = merged.length - existing.podwykoLista.length;
    logger.log(`  xlsx entries: ${fromXlsx.length}`);
    logger.log(`  before sheet: ${existing.podwykoLista.length}`);
    logger.log(`  after sheet: ${merged.length} (+${Math.max(0, added)} new)`);
  } catch (err: unknown) {
    logger.error(err);
    exitFn(1);
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await runPushReferenceCli();
}

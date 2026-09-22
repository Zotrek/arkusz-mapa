/**
 * CLI: pobierz słowniki referencyjne z Web App → data/reference-podwyko-lista.json
 * Uruchom: npx tsx src/pullReference.ts
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getTransportWebAppUrl } from './config.js';
import {
  fetchReferenceDataFromWebApp,
  writeReferencePodwykoJsonFile,
  type ReferenceDataBundle,
} from './referenceData.js';
import type { PodwykoOption } from './wordMapSupport.js';

interface LoggerLike {
  log: (message?: unknown, ...args: unknown[]) => void;
  error: (message?: unknown, ...args: unknown[]) => void;
}

export interface PullReferenceCliDeps {
  getWebAppUrl?: () => string | undefined;
  fetchReference?: (webAppUrl: string) => Promise<Partial<ReferenceDataBundle>>;
  writeJson?: (podwykoLista: PodwykoOption[]) => Promise<void>;
  logger?: LoggerLike;
  exitFn?: (code: number) => void;
}

export async function runPullReferenceCli(deps: PullReferenceCliDeps = {}): Promise<void> {
  const getWebAppUrl = deps.getWebAppUrl ?? getTransportWebAppUrl;
  const fetchReference = deps.fetchReference ?? fetchReferenceDataFromWebApp;
  const writeJson = deps.writeJson ?? writeReferencePodwykoJsonFile;
  const logger = deps.logger ?? console;
  const exitFn = deps.exitFn ?? process.exit;

  try {
    const webAppUrl = getWebAppUrl();
    if (!webAppUrl) {
      logger.error('[arkusz-mapa] pull:reference — brak TRANSPORT_WEBAPP_URL w .env');
      exitFn(1);
      return;
    }

    logger.log('[arkusz-mapa] pull:reference start');
    const data = await fetchReference(webAppUrl);
    const podwykoLista = data.podwykoLista ?? [];

    await writeJson(podwykoLista);
    logger.log(`  podwykoLista: ${podwykoLista.length}`);
    logger.log(`  poprawAdres (runtime only): ${data.poprawAdres?.length ?? 0}`);
  } catch (err: unknown) {
    logger.error(err);
    exitFn(1);
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await runPullReferenceCli();
}

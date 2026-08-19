/**
 * CLI: wgraj listę podwykonawców z docs/podwyko lista.xlsx → Google Sheet (Lista podwykonawców).
 * Uruchom: npm run push:reference
 */

import 'dotenv/config';
import { getConfig, getOptionalWordMapAssetPaths, getTransportSheetsId } from './config.js';
import {
  loadReferenceDataFromSheets,
  mergePodwykoEntries,
  writePodwykoListaToSheets,
} from './referenceData.js';
import { createSheetsClient } from './sheets.js';
import { loadPodwykoOptionsFromSpreadsheet } from './wordMapSupport.js';

async function main(): Promise<void> {
  const config = getConfig();
  const paths = getOptionalWordMapAssetPaths();
  const spreadsheetId = getTransportSheetsId();

  console.log('[arkusz-mapa] push:reference start');
  console.log(`  xlsx: ${paths.podwykoPath}`);
  console.log(`  sheet: ${spreadsheetId}`);

  const fromXlsx = await loadPodwykoOptionsFromSpreadsheet(paths.podwykoPath);
  if (fromXlsx.length === 0) {
    console.error('[arkusz-mapa] push:reference — brak wpisów w pliku XLSX');
    process.exit(1);
  }

  const client = createSheetsClient(config.credentialsPath);
  const existing = await loadReferenceDataFromSheets(client, spreadsheetId);
  const merged = mergePodwykoEntries([
    fromXlsx.map((item) => ({ baseLabel: item.label, dane: item.dane })),
    existing.podwykoLista.map((item) => ({ baseLabel: item.label, dane: item.dane })),
  ]);

  await writePodwykoListaToSheets(client, spreadsheetId, merged);

  const added = merged.length - existing.podwykoLista.length;
  console.log(`  xlsx entries: ${fromXlsx.length}`);
  console.log(`  before sheet: ${existing.podwykoLista.length}`);
  console.log(`  after sheet: ${merged.length} (+${Math.max(0, added)} new)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

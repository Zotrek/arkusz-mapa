/**
 * Jednorazowy / ręczny sync Bazy cen (m.in. usuwanie bliźniaków po normalizacji adresu).
 * Usage: npx tsx scripts/sync-baza-cen-harmonogram.ts
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { syncBazaCenHarmonogram } from '../src/bazaCenHarmonogram.js';
import { getEwidencjaOdbiorowSheetsId } from '../src/config.js';
import { createSheetsClient } from '../src/sheets.js';

async function main(): Promise<void> {
  const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || '';
  if (!cred || !existsSync(cred)) {
    console.error('Brak GOOGLE_APPLICATION_CREDENTIALS lub plik nie istnieje.');
    process.exit(2);
  }
  const spreadsheetId = getEwidencjaOdbiorowSheetsId();
  const api = createSheetsClient(cred);
  const result = await syncBazaCenHarmonogram(api, { spreadsheetId }, console);
  console.log(JSON.stringify({ ok: true, spreadsheetId, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

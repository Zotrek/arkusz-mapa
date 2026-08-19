/**
 * CLI: pobierz słowniki referencyjne z Web App → data/reference-*.json
 * Uruchom: npx tsx src/pullReference.ts
 */

import 'dotenv/config';
import { getTransportWebAppUrl } from './config.js';
import { fetchReferenceDataFromWebApp, writeReferenceJsonFiles } from './referenceData.js';
import { finalizePodwykoOptions } from './wordMapSupport.js';

async function main(): Promise<void> {
  const webAppUrl = getTransportWebAppUrl();
  if (!webAppUrl) {
    console.error('[arkusz-mapa] pull:reference — brak TRANSPORT_WEBAPP_URL w .env');
    process.exit(1);
  }

  console.log('[arkusz-mapa] pull:reference start');
  const data = await fetchReferenceDataFromWebApp(webAppUrl);
  const przewoznicy = data.przewoznicy ?? [];
  const miejscaDostawy = finalizePodwykoOptions(
    (data.miejscaDostawy ?? []).map((item) => ({
      baseLabel: item.label,
      dane: item.dane,
    })),
  );

  await writeReferenceJsonFiles({ przewoznicy, miejscaDostawy });
  console.log(`  przewoznicy: ${przewoznicy.length}`);
  console.log(`  miejscaDostawy: ${miejscaDostawy.length}`);
  console.log(`  poprawAdres (runtime only): ${data.poprawAdres?.length ?? 0}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

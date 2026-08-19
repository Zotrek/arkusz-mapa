/**
 * CLI: pobierz słowniki referencyjne z Web App → data/reference-podwyko-lista.json
 * Uruchom: npx tsx src/pullReference.ts
 */

import 'dotenv/config';
import { getTransportWebAppUrl } from './config.js';
import { fetchReferenceDataFromWebApp, writeReferencePodwykoJsonFile } from './referenceData.js';

async function main(): Promise<void> {
  const webAppUrl = getTransportWebAppUrl();
  if (!webAppUrl) {
    console.error('[arkusz-mapa] pull:reference — brak TRANSPORT_WEBAPP_URL w .env');
    process.exit(1);
  }

  console.log('[arkusz-mapa] pull:reference start');
  const data = await fetchReferenceDataFromWebApp(webAppUrl);
  const podwykoLista = data.podwykoLista ?? [];

  await writeReferencePodwykoJsonFile(podwykoLista);
  console.log(`  podwykoLista: ${podwykoLista.length}`);
  console.log(`  poprawAdres (runtime only): ${data.poprawAdres?.length ?? 0}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

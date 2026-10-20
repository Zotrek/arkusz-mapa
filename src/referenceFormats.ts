/**
 * Formatowanie wpisów listy podwykonawców do kolumny „Dane do Worda”.
 */

import { functionSourceForBrowser } from './routeName.js';

export interface PodwykoStructuredRecord {
  /** Etykieta comboboxa (kolumna A). */
  nazwa: string;
  nazwaDoProtokolu: string;
  adres: string;
  nip: string;
  bdo: string;
}

/** Skleja pola podwykonawcy do kolumny B (Word / combobox value). Wykonywana także w przeglądarce. */
export function formatPodwykoForWord(r: PodwykoStructuredRecord): string {
  const parts: string[] = [];
  const nazwa = String(r.nazwaDoProtokolu ?? '').trim();
  const adres = String(r.adres ?? '').trim();
  const nip = String(r.nip ?? '').trim();
  const bdo = String(r.bdo ?? '').trim();

  if (nazwa) {
    parts.push(nazwa);
  }
  if (adres) {
    parts.push(adres);
  }
  if (bdo) {
    parts.push(/^bdo\b/i.test(bdo) ? bdo : `BDO ${bdo}`);
  }
  if (nip) {
    parts.push(/^nip\b/i.test(nip) ? nip : `NIP ${nip}`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** JS wstrzykiwany do mapy — ten sam kod co w Node. */
export function referenceFormatsBrowserScript(): string {
  return `\n${functionSourceForBrowser(formatPodwykoForWord)}\n`;
}

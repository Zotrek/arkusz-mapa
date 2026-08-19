/**
 * Formatowanie wpisów listy podwykonawców do kolumny „Dane do Worda”.
 */

export interface PodwykoStructuredRecord {
  /** Etykieta comboboxa (kolumna A). */
  nazwa: string;
  nazwaDoProtokolu: string;
  adres: string;
  nip: string;
  bdo: string;
}

function clean(s: string): string {
  return String(s ?? '').trim();
}

/** Skleja pola podwykonawcy do kolumny B (Word / combobox value). */
export function formatPodwykoForWord(r: PodwykoStructuredRecord): string {
  const parts: string[] = [];
  const nazwa = clean(r.nazwaDoProtokolu);
  const adres = clean(r.adres);
  const nip = clean(r.nip);
  const bdo = clean(r.bdo);

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

/** JS wstrzykiwany do mapy — te same reguły co w Node i Apps Script. */
export function referenceFormatsBrowserScript(): string {
  return `
    function formatPodwykoForWordJs(r) {
      var parts = [];
      var nazwa = String(r.nazwaDoProtokolu || '').trim();
      var adres = String(r.adres || '').trim();
      var nip = String(r.nip || '').trim();
      var bdo = String(r.bdo || '').trim();
      if (nazwa) parts.push(nazwa);
      if (adres) parts.push(adres);
      if (bdo) parts.push(/^bdo\\b/i.test(bdo) ? bdo : ('BDO ' + bdo));
      if (nip) parts.push(/^nip\\b/i.test(nip) ? nip : ('NIP ' + nip));
      return parts.join(' ').replace(/\\s+/g, ' ').trim();
    }
`;
}

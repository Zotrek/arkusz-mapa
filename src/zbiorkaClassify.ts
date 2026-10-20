/**
 * Klasyfikacja zbiórki i normalizacja „Wg harmonogramu” — jedyne miejsce rozpoznawania ręczna/maszyna
 * (pipeline, Word, sync zestawienia i — przez `mapSharedBrowserScript` — przeglądarka).
 * Osobny moduł — bez zależności od phase6 (unikamy cykli z harmonogramDays / wordMapSupport).
 */

export type MapPointZbiorkaKind = 'obie' | 'reczna' | 'maszyna' | 'unknown';

export interface ZbiorkaFlags {
  hasReczna: boolean;
  hasMaszyna: boolean;
}

/** Parsuje agregat kolumny zbiórki (jak na mapie / w popupie). */
export function parseZbiorkaFlags(zbiorka: string | undefined): ZbiorkaFlags {
  const raw = (zbiorka ?? '').trim();
  if (raw.length === 0) {
    return { hasReczna: false, hasMaszyna: false };
  }
  const lower = raw.toLowerCase();
  const segments = lower
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const toScan = segments.length > 0 ? segments : [lower];
  let hasReczna = false;
  let hasMaszyna = false;
  for (const seg of toScan) {
    if (seg.includes('ręcz') || seg.includes('recz') || seg === 'r') {
      hasReczna = true;
    } else if (seg.includes('maszyn') || seg === 'm' || seg.includes('automat')) {
      hasMaszyna = true;
    }
  }
  return { hasReczna, hasMaszyna };
}

/** Klasyfikacja punktu mapy wg trybu zbiórki. */
export function classifyMapPointZbiorka(zbiorka: string | undefined): MapPointZbiorkaKind {
  const { hasReczna, hasMaszyna } = parseZbiorkaFlags(zbiorka);
  if (hasReczna && hasMaszyna) {
    return 'obie';
  }
  if (hasReczna) {
    return 'reczna';
  }
  if (hasMaszyna) {
    return 'maszyna';
  }
  return 'unknown';
}

/** Etykieta dokumentu: „ręczna” / „automatyczna” / „ręczna i automatyczna” / ''. */
export function rodzajZbiorkiLabel(flags: ZbiorkaFlags): string {
  if (flags.hasReczna && flags.hasMaszyna) {
    return 'ręczna i automatyczna';
  }
  if (flags.hasReczna) {
    return 'ręczna';
  }
  if (flags.hasMaszyna) {
    return 'automatyczna';
  }
  return '';
}

/**
 * Mapuje komórkę/agregat kolumny zbiórki na etykietę dokumentu:
 * Ręczna → „ręczna”, Maszyna → „automatyczna”, obie → „ręczna i automatyczna”.
 */
export function formatRodzajZbiorkiForDoc(zbiorka: string | undefined): string {
  return rodzajZbiorkiLabel(parseZbiorkaFlags(zbiorka));
}

/**
 * {{rodzaj_zbiorki}} / rejestr transportu: tylko z plomb, które realnie wchodzą na protokół
 * (po filtrze daty, z numerem plomby — te same wiersze co lista w Wordzie).
 */
export function aggregateRodzajZbiorkiFromSealRows(
  rows: ReadonlyArray<{ numerPlomby?: string; zbiorka?: string }>,
): string {
  let hasReczna = false;
  let hasMaszyna = false;
  for (const r of rows) {
    if (String(r.numerPlomby ?? '').trim().length === 0) {
      continue;
    }
    const flags = parseZbiorkaFlags(r.zbiorka);
    hasReczna = hasReczna || flags.hasReczna;
    hasMaszyna = hasMaszyna || flags.hasMaszyna;
  }
  return rodzajZbiorkiLabel({ hasReczna, hasMaszyna });
}

/**
 * Agregat kolumny zbiórki na pinezkę: „Ręczna” / „Maszyna” / „Maszyna / Ręczna”;
 * nierozpoznana wartość zostaje (z wielkiej litery). Brak wartości → undefined.
 */
export function aggregateZbiorkaColumn(
  rows: ReadonlyArray<{ zbiorka?: string }>,
): string | undefined {
  const values = new Set<string>();
  for (const row of rows) {
    const v = (row.zbiorka ?? '').trim().toLowerCase();
    if (!v) {
      continue;
    }
    const { hasReczna, hasMaszyna } = parseZbiorkaFlags(v);
    if (hasReczna) values.add('Ręczna');
    if (hasMaszyna) values.add('Maszyna');
    if (!hasReczna && !hasMaszyna) values.add(v.charAt(0).toUpperCase() + v.slice(1));
  }
  if (values.size === 0) return undefined;
  return [...values].sort().join(' / ');
}

/** Normalizuje wartość kolumny do tak / nie / ''. */
export function normalizeWgHarmonogramu(raw: string | undefined): 'tak' | 'nie' | '' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'tak') {
    return 'tak';
  }
  if (s === 'nie') {
    return 'nie';
  }
  return '';
}

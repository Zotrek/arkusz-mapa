/**
 * Klasyfikacja zbiórki i normalizacja „Wg harmonogramu”.
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
    if (seg.includes('ręcz') || seg === 'r') {
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

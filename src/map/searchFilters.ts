/** Wyszukiwarka i filtry mapy — ten sam kod wykonuje przeglądarka (`mapSharedBrowserScript`). */

import { POLISH_VOIVODESHIPS } from '../polishVoivodeships.js';
import { polishAsciiLower } from '../polishText.js';
import { normalizeRateShopKey } from '../saveRate.js';
import { classifyMapPointZbiorka, normalizeWgHarmonogramu } from '../zbiorkaClassify.js';

/**
 * Normalizacja tekstu do porównań w wyszukiwarce mapy (al./pl./Św., małe litery, polskie znaki → ASCII).
 * Wykonywana także w przeglądarce — patrz {@link mapSharedBrowserScript}.
 */
export function normalizeForAddressSearch(text: string): string {
  let s = normalizeRateShopKey(text).normalize('NFD').replace(/\p{M}/gu, '');
  s = s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/Ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/Ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/Ę/g, 'e')
    .replace(/ń/g, 'n')
    .replace(/Ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/Ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/Ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/Ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/Ż/g, 'z');
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lista podwykonawców (modal Word): dopasowanie po nazwie (A) lub treści do dokumentu (B).
 * Pusty query = wszystkie pozycje.
 */
export function podwykoOptionMatchesSearch(label: string, dane: string, query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  if (normalizeForAddressSearch(label).includes(q)) {
    return true;
  }
  if (normalizeForAddressSearch(dane).includes(q)) {
    return true;
  }
  return false;
}

/** Czy fragment zapytania występuje w adresie (po {@link normalizeForAddressSearch}). Pusty query = dopasuj wszystko. */
export function addressMatchesSearch(adres: string, query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  return normalizeForAddressSearch(adres).includes(q);
}

/**
 * Wyszukiwarka mapy: dopasowanie do adresu punktu albo do kolumn A/B (podmiot, sklep).
 * Pusty query = wszystkie punkty.
 */
export function mapPointMatchesSearch(adres: string, searchLabels: string[], query: string): boolean {
  const q = normalizeForAddressSearch(query);
  if (!q) {
    return true;
  }
  if (normalizeForAddressSearch(adres).includes(q)) {
    return true;
  }
  for (const label of searchLabels) {
    if (normalizeForAddressSearch(label).includes(q)) {
      return true;
    }
  }
  return false;
}

/** Klucz sklepu w rejestrze transportów (podmiot + adres, ta sama normalizacja co Apps Script). */
export function buildTransportShopKey(podmiot: string, adres: string): string {
  return `${normalizeForAddressSearch(podmiot)}\u0000${normalizeForAddressSearch(adres)}`;
}

export interface TransportCutoffPoint {
  podmiotHandlowy?: string;
  podmiotyHandlowe?: string[];
  adres: string;
}

export interface TransportLastInfo {
  ms: number;
  /** „Kto odbiera” z wiersza z tą datą; pusty, gdy rejestr go nie podał. */
  ktoOdbiera: string;
}

/**
 * Ostatni transport (ms UTC + kto odebrał) dla punktu mapy.
 * Wymaga dopasowania **podmiot + adres** — próbuje wszystkich podmiotów przypisanych do punktu.
 */
export function resolveTransportLastForPoint(
  point: TransportCutoffPoint,
  byKey: Record<string, number> | null | undefined,
  ktoByKey?: Record<string, string> | null,
): TransportLastInfo | null {
  if (!byKey) {
    return null;
  }
  const normAdres = normalizeForAddressSearch(point.adres);
  if (normAdres.length === 0) {
    return null;
  }

  const podmioty: string[] = [];
  const addPodmiot = (raw: string | undefined): void => {
    const t = String(raw ?? '').trim();
    if (t.length === 0) {
      return;
    }
    if (podmioty.some((existing) => normalizeForAddressSearch(existing) === normalizeForAddressSearch(t))) {
      return;
    }
    podmioty.push(t);
  };
  addPodmiot(point.podmiotHandlowy);
  if (point.podmiotyHandlowe) {
    for (const p of point.podmiotyHandlowe) {
      addPodmiot(p);
    }
  }
  if (podmioty.length === 0) {
    return null;
  }

  let best: TransportLastInfo | null = null;
  for (const podmiot of podmioty) {
    const key = buildTransportShopKey(podmiot, point.adres);
    const ms = byKey[key];
    if (ms != null && Number.isFinite(ms) && (best == null || ms > best.ms)) {
      const kto = ktoByKey?.[key];
      best = { ms, ktoOdbiera: kto ? String(kto) : '' };
    }
  }

  return best;
}

/** Ostatnia data transportu (ms UTC) dla punktu mapy — patrz {@link resolveTransportLastForPoint}. */
export function resolveTransportCutoffMsForPoint(
  point: TransportCutoffPoint,
  byKey: Record<string, number>,
): number | null {
  return resolveTransportLastForPoint(point, byKey)?.ms ?? null;
}

/** Filtr warstwy zbiórki na mapie (domyślnie: wszystkie punkty). */
export type ZbiorkaFilterMode = 'wszystkie' | 'obie' | 'reczna' | 'maszyna';

/** Czy punkt jest widoczny przy wybranym filtrze zbiórki. */
export function mapPointMatchesZbiorkaFilter(
  zbiorka: string | undefined,
  mode: ZbiorkaFilterMode,
): boolean {
  if (mode === 'wszystkie') {
    return true;
  }
  return classifyMapPointZbiorka(zbiorka) === mode;
}

/** Filtr „Wg harmonogramu” na mapie. */
export type WgHarmonogramuFilterMode = 'wszystkie' | 'tak' | 'nie';

/** Czy punkt jest widoczny przy filtrze „Wg harmonogramu”. */
export function mapPointMatchesWgHarmonogramuFilter(
  wgHarmonogramu: string | undefined,
  mode: WgHarmonogramuFilterMode,
): boolean {
  if (mode === 'wszystkie') {
    return true;
  }
  return normalizeWgHarmonogramu(wgHarmonogramu) === mode;
}

/** Kanoniczna etykieta wyświetlana (pierwsza litera wielka, reszta mała). */
export function displayWojewodztwoLabel(name: string): string {
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Etykieta województwa na mapie (pusty / placeholder → „Nieznane”; ujednolicone litery i ogonki). */
export function normalizeWojewodztwoLabel(raw: string | undefined): string {
  const t = String(raw ?? '').trim();
  if (t.length === 0) {
    return 'Nieznane';
  }
  const lower = t.toLowerCase();
  if (lower === 'do uzupełnienia' || lower === 'do uzupelnienia') {
    return 'Nieznane';
  }
  const asciiKey = polishAsciiLower(t);
  for (const official of POLISH_VOIVODESHIPS) {
    if (polishAsciiLower(official) === asciiKey) {
      // Np. Swietokrzyskie → Świętokrzyskie; Kujawsko-Pomorskie → Kujawsko-pomorskie.
      return displayWojewodztwoLabel(official);
    }
  }
  return displayWojewodztwoLabel(t);
}

/** Unikalne województwa z punktów mapy (sortowanie pl). */
export function uniqueWojewodztwaFromMapPoints(points: ReadonlyArray<{ woj: string }>): string[] {
  const seen = new Set<string>();
  for (const p of points) {
    seen.add(normalizeWojewodztwoLabel(p.woj));
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'pl'));
}

/**
 * Czy punkt jest widoczny przy filtrze województwa (multiwybór).
 * Pusta lista / brak zaznaczenia / samo „wszystkie” → wszystkie punkty.
 */
export function mapPointMatchesWojewodztwoFilter(
  woj: string | undefined,
  selected: string | readonly string[],
): boolean {
  const raw = Array.isArray(selected) ? selected : [selected];
  const selectedList = raw
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0 && s !== 'wszystkie')
    .map((s) => normalizeWojewodztwoLabel(s));
  if (selectedList.length === 0) {
    return true;
  }
  const label = normalizeWojewodztwoLabel(woj);
  return selectedList.includes(label);
}

/** Tekst na przycisku listy województw (0 = Wszystkie, 1 = nazwa, 2+ = „N wybrane”). */
export function formatWojewodztwoFilterSummary(selected: readonly string[]): string {
  const list = selected
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0 && s !== 'wszystkie');
  if (list.length === 0) {
    return 'Wszystkie';
  }
  if (list.length === 1) {
    return list[0];
  }
  return list.length + ' wybrane';
}

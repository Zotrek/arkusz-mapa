/**
 * Faza 2: odczyt i parsowanie danych z Google Sheets.
 */

import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { google, type sheets_v4 } from 'googleapis';
import { DEFAULT_SHEET_COLUMN_MAP, DEFAULT_ADDRESS_ALIASES_PATH } from './config.js';
import { normalizeCityFromSheet } from './cityNormalize.js';
import { normalizeStreetFromSheet } from './streetNormalize.js';

export interface AddressParts {
  kodPocztowy: string;
  miasto: string;
  ulica: string;
  numerBudynku: string;
}

export type SheetColumnMap = {
  [K in keyof typeof DEFAULT_SHEET_COLUMN_MAP]: number;
};

export interface SheetRow extends AddressParts {
  sourceRowIndex: number;
  podmiotHandlowy: string;
  sklep: string;
  gmina: string;
  numerPlomby: string;
  /** Kolumna daty zamknięcia worka (surowy tekst z arkusza). */
  dataZamknieciaWorka: string;
  /** Tryb zbiórki – ręczna / maszyna */
  zbiorka: string;
  /** Wg harmonogramu – tak / nie (surowy tekst z arkusza). */
  wgHarmonogramu: string;
  /** Dni harmonogramu – np. pn, cz (surowy tekst z arkusza). */
  dniHarmonogramu: string;
  /** Firma transportowa (opcjonalna kolumna; np. wstawiona jako F). */
  firmaTransportowa: string;
  /** Ulica z arkusza przed rozwinięciem skrótów (Gen. → Generała). */
  ulicaRaw: string;
  raw: string[];
  address: string;
}

type SheetMeta = {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
  }>;
};

type SheetsValuesGetClient = {
  spreadsheets: {
    values: {
      get(
        args: { spreadsheetId: string; range: string },
        ...rest: unknown[]
      ): Promise<{ data: unknown }>;
    };
  };
};

type SheetsReadClient = SheetsValuesGetClient & {
  spreadsheets: SheetsValuesGetClient['spreadsheets'] & {
    get(args: { spreadsheetId: string }, ...rest: unknown[]): Promise<{ data: unknown }>;
  };
};

function normalizeCell(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function findHeaderIndex(headers: string[], matchers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const header = normalizeHeader(headers[i] ?? '');
    if (matchers.some((matcher) => header.includes(normalizeHeader(matcher)))) {
      return i;
    }
  }
  return -1;
}

/**
 * Mapuje kolumny arkusza po nagłówkach (odporne na dodanie kolumn typu NIP / Województwo).
 * Gdy brak nagłówków — używa {@link DEFAULT_SHEET_COLUMN_MAP}.
 */
export function resolveSheetColumnMap(headers: string[]): SheetColumnMap {
  if (!headers || headers.length === 0 || headers.every((header) => header.trim().length === 0)) {
    return { ...DEFAULT_SHEET_COLUMN_MAP };
  }

  const pick = (matchers: string[], fallback: number): number => {
    const index = findHeaderIndex(headers, matchers);
    return index >= 0 ? index : fallback;
  };

  return {
    podmiotHandlowy: pick(['podmiot handlowy', 'podmiot'], DEFAULT_SHEET_COLUMN_MAP.podmiotHandlowy),
    sklep: pick(['sklep'], DEFAULT_SHEET_COLUMN_MAP.sklep),
    kodPocztowy: pick(['kod pocztowy', 'kod poczt'], DEFAULT_SHEET_COLUMN_MAP.kodPocztowy),
    miasto: pick(['miasto'], DEFAULT_SHEET_COLUMN_MAP.miasto),
    ulica: pick(['ulica'], DEFAULT_SHEET_COLUMN_MAP.ulica),
    numerBudynku: pick(['numer budynku', 'numer bud'], DEFAULT_SHEET_COLUMN_MAP.numerBudynku),
    gmina: pick(['gmina'], DEFAULT_SHEET_COLUMN_MAP.gmina),
    numerPlomby: pick(['numer plomby', 'numer plomb'], DEFAULT_SHEET_COLUMN_MAP.numerPlomby),
    dataZamknieciaWorka: pick(
      ['data zamkniecia worka', 'data zamkniecia', 'data zamk'],
      DEFAULT_SHEET_COLUMN_MAP.dataZamknieciaWorka,
    ),
    zbiorka: pick(['tryb zbiorki', 'tryb zbior', 'zbiorki'], DEFAULT_SHEET_COLUMN_MAP.zbiorka),
    wgHarmonogramu: pick(
      ['wg harmonogramu'],
      DEFAULT_SHEET_COLUMN_MAP.wgHarmonogramu,
    ),
    dniHarmonogramu: pick(
      ['dni harmonogramu', 'dzien harmonogramu', 'dzień harmonogramu'],
      DEFAULT_SHEET_COLUMN_MAP.dniHarmonogramu,
    ),
    firmaTransportowa: pick(
      ['firma transportowa', 'firma transport'],
      DEFAULT_SHEET_COLUMN_MAP.firmaTransportowa,
    ),
  };
}

function isMissingStreet(street: string): boolean {
  return street.trim().length === 0 || street.trim().toLowerCase() === 'brak';
}

function stripAfterSlash(value: string): string {
  const s = value.trim();
  const beforeSlash = s.split('/')[0];
  return (beforeSlash ?? s).trim();
}

/**
 * Gdy numer budynku jest powtórzony na końcu pola „Ulica”, usuwa go z ulicy.
 * Np. „Winne-Podbukowina 11” + numer „11” → „Winne-Podbukowina”.
 */
export function stripTrailingHouseNumberFromStreet(ulica: string, numerBudynku: string): string {
  const number = normalizeCell(stripAfterSlash(numerBudynku));
  let street = normalizeCell(ulica);
  if (!street || !number || isMissingStreet(street)) {
    return street;
  }

  const gluedMatch = street.match(/^(.+?)(\d+[a-zA-Z]?)$/u);
  if (gluedMatch?.[1] && gluedMatch[2]?.toLowerCase() === number.toLowerCase()) {
    street = gluedMatch[1].trim();
  }

  const suffix = ` ${number}`;
  if (street.length > suffix.length && street.toLowerCase().endsWith(suffix.toLowerCase())) {
    return street.slice(0, street.length - suffix.length).trim();
  }

  return street;
}

function normalizeCityForPostcodeTypo(miasto: string): string {
  return miasto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Znane literówki kodu pocztowego w arkuszu (np. 62-100 zamiast 63-100 dla Śremu).
 * Poprawka tylko gdy miasto pasuje — 62-100 to też Witkowo (Wielkopolskie).
 */
export function correctKnownPostcodeTypo(kodPocztowy: string, miasto: string): string {
  const kod = kodPocztowy.trim();
  const city = normalizeCityForPostcodeTypo(miasto);
  if (kod === '62-100' && city === 'srem') {
    return '63-100';
  }
  return kodPocztowy;
}

export function buildAddress(parts: AddressParts): string {
  const items = [normalizeCell(parts.kodPocztowy), normalizeCell(parts.miasto)];
  if (!isMissingStreet(parts.ulica)) {
    items.push(normalizeCell(parts.ulica));
  }
  items.push(normalizeCell(parts.numerBudynku));

  return items
    .filter((item) => item.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drugi człon miejscowości (Zielona Góra, Środa Wielkopolska). Nie nazwy ulic. */
const LOCALITY_SECOND_WORD = new Set([
  'gora',
  'sol',
  'targ',
  'dunajec',
  'gdanski',
  'podlaski',
  'podlaska',
  'mazowiecka',
  'mazowiecki',
  'wielkopolska',
  'wielkopolski',
  'wilekopolski',
  'wlkp',
  'deba',
  'sacz',
  'zabkowicki',
  'zabkowicka',
  'lodzki',
  'lodzka',
  'swietokrzyski',
  'swietokrzyska',
  'trybunalski',
  'slaski',
  'slaska',
]);

function foldLocality(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/\./g, '');
}

function splitLeadingPostcode(address: string): { prefix: string; rest: string } {
  const match = /^(\d{2}-\d{3})(?:\s+|$)/.exec(address);
  if (!match) {
    return { prefix: '', rest: address };
  }
  return { prefix: match[1], rest: address.slice(match[0].length).trim() };
}

function insertCommaAfterPlace(address: string, locality: string): string | null {
  const place = locality.replace(/\s+/g, ' ').trim();
  if (!place) {
    return null;
  }
  const { prefix, rest } = splitLeadingPostcode(address);
  if (rest.length < place.length) {
    return null;
  }
  if (foldLocality(rest.slice(0, place.length)) !== foldLocality(place)) {
    return null;
  }
  const boundary = rest[place.length] ?? '';
  if (boundary && boundary !== ' ' && boundary !== ',') {
    return null;
  }
  if (boundary === ',') {
    return address;
  }
  const tail = rest.slice(place.length).trim();
  if (!tail) {
    return address;
  }
  const head = prefix ? `${prefix} ${rest.slice(0, place.length)}` : rest.slice(0, place.length);
  return `${head}, ${tail}`;
}

function insertCommaAfterLocalityHeuristic(address: string): string {
  if (address.includes(',')) {
    return address;
  }
  const { prefix, rest } = splitLeadingPostcode(address);
  if (!prefix) {
    return address;
  }
  const words = rest.split(' ').filter((word) => word.length > 0);
  if (words.length < 2) {
    return address;
  }
  let take = 1;
  const second = foldLocality(words[1] ?? '');
  if (second === 'nad' && words.length >= 4) {
    take = 3;
  } else if (LOCALITY_SECOND_WORD.has(second)) {
    take = 2;
  }
  if (take >= words.length) {
    return address;
  }
  const locality = words.slice(0, take).join(' ');
  const tail = words.slice(take).join(' ');
  const head = `${prefix} ${locality}`;
  return `${head}, ${tail}`;
}

/**
 * Widoczny adres: przecinek po miejscowości. Klucz zapisu zostaje bez przecinka.
 * Znana miejscowość ma pierwszeństwo. Inaczej drugi człon tylko dla typowych nazw (Góra, Wielkopolska).
 */
export function addressWithCommaAfterLocality(address: string, locality = ''): string {
  const addr = address.replace(/\s+/g, ' ').trim();
  if (!addr) {
    return '';
  }
  const placed = insertCommaAfterPlace(addr, locality);
  if (placed !== null) {
    return placed;
  }
  return insertCommaAfterLocalityHeuristic(addr);
}

export function mapRawRowToSheetRow(
  raw: string[],
  sourceRowIndex: number,
  columns: SheetColumnMap = DEFAULT_SHEET_COLUMN_MAP,
): SheetRow {
  const kodPocztowy = correctKnownPostcodeTypo(
    normalizeCell(raw[columns.kodPocztowy]),
    normalizeCell(raw[columns.miasto]),
  );
  const miasto = normalizeCityFromSheet(normalizeCell(raw[columns.miasto]));
  const numerBudynku = normalizeCell(raw[columns.numerBudynku]);
  const ulicaRaw = stripTrailingHouseNumberFromStreet(
    normalizeCell(raw[columns.ulica]),
    numerBudynku,
  );
  const ulica = normalizeStreetFromSheet(ulicaRaw, miasto);

  return {
    sourceRowIndex,
    podmiotHandlowy: normalizeCell(raw[columns.podmiotHandlowy]),
    sklep: normalizeCell(raw[columns.sklep]),
    kodPocztowy,
    miasto,
    ulica,
    ulicaRaw,
    numerBudynku,
    gmina: normalizeCell(raw[columns.gmina]),
    numerPlomby: normalizeCell(raw[columns.numerPlomby]),
    dataZamknieciaWorka: normalizeCell(raw[columns.dataZamknieciaWorka] ?? ''),
    zbiorka: normalizeCell(raw[columns.zbiorka] ?? ''),
    wgHarmonogramu: normalizeCell(raw[columns.wgHarmonogramu] ?? ''),
    dniHarmonogramu: normalizeCell(raw[columns.dniHarmonogramu] ?? ''),
    firmaTransportowa: normalizeCell(raw[columns.firmaTransportowa] ?? ''),
    raw,
    address: buildAddress({
      kodPocztowy,
      miasto,
      ulica,
      numerBudynku,
    }),
  };
}

/** Wpis w `address-aliases.json`: string (kanoniczny) lub obiekt z polem `canonical`. */
type AddressAliasEntry = string | { canonical: string; note?: string };

/**
 * Wczytuje mapę aliasów adresów (literówki → kanoniczny zapis). Brak pliku = pusta mapa.
 */
export async function loadAddressAliases(
  filePath: string = DEFAULT_ADDRESS_ALIASES_PATH,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, AddressAliasEntry>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [variant, entry] of Object.entries(parsed)) {
      const canonical = typeof entry === 'string' ? entry : entry?.canonical;
      if (typeof canonical === 'string' && canonical.length > 0) {
        result[variant] = canonical;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Zamienia `row.address` na kanoniczny, gdy wariant jest w pliku aliasów (ten sam sklep).
 */
export function applyAddressAliases(
  rows: SheetRow[],
  aliases: Record<string, string>,
): SheetRow[] {
  if (Object.keys(aliases).length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const canonical = aliases[row.address];
    if (!canonical || canonical === row.address) {
      return row;
    }
    return { ...row, address: canonical };
  });
}

export function parseSheetRows(values: string[][]): {
  headers: string[];
  rows: SheetRow[];
  columnMap: SheetColumnMap;
} {
  if (!values || values.length === 0) {
    return { headers: [], rows: [], columnMap: { ...DEFAULT_SHEET_COLUMN_MAP } };
  }

  const [headers, ...dataRows] = values;
  const columnMap = resolveSheetColumnMap(headers);
  const rows = dataRows.map((rawRow, idx) => mapRawRowToSheetRow(rawRow, idx + 2, columnMap));

  return { headers, rows, columnMap };
}

export function getFirstSheetTitle(meta: SheetMeta): string {
  return meta.sheets?.[0]?.properties?.title ?? 'Arkusz1';
}

export function buildSheetRange(sheetTitle: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return `'${escaped}'!A:Z`;
}

export async function fetchSourceSheetValues(
  api: SheetsValuesGetClient,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const response = await api.spreadsheets.values.get({
    spreadsheetId,
    range: buildSheetRange(sheetTitle),
  });

  const data = response.data as { values?: string[][] };
  return data.values ?? [];
}

export async function loadSourceRows(
  api: SheetsReadClient,
  spreadsheetId: string,
): Promise<{ sheetTitle: string; headers: string[]; rows: SheetRow[]; columnMap: SheetColumnMap }> {
  const metaResponse = await api.spreadsheets.get({ spreadsheetId });
  const sheetTitle = getFirstSheetTitle((metaResponse.data as SheetMeta) ?? {});
  const values = await fetchSourceSheetValues(api, spreadsheetId, sheetTitle);
  const parsed = parseSheetRows(values);

  return {
    sheetTitle,
    headers: parsed.headers,
    rows: parsed.rows,
    columnMap: parsed.columnMap,
  };
}

/** Workaround: Node 24.17+ + google-auth-library v9 → OAuth „Premature close” przy keep-alive. */
const httpAgentNoKeepAlive = new http.Agent({ keepAlive: false });
const httpsAgentNoKeepAlive = new https.Agent({ keepAlive: false });

export function googleAuthNoKeepAliveAgent(parsedURL: URL): http.Agent | https.Agent {
  return parsedURL.protocol === 'https:' ? httpsAgentNoKeepAlive : httpAgentNoKeepAlive;
}

export function createSheetsClient(credentialsPath: string): sheets_v4.Sheets {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    clientOptions: {
      transporterOptions: {
        agent: googleAuthNoKeepAliveAgent,
      },
    },
  });

  return google.sheets({
    version: 'v4',
    auth,
  });
}

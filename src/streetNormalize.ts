/**
 * Normalizacja nazw ulic z arkusza: prefiksy (ul./al.), skróty (B. Głowackiego) i znane literówki.
 */

import { polishAsciiFold, polishAsciiLower } from './polishText.js';

/** Prefiks przyklejony do nazwy: „al.Chryzantem” → „Chryzantem”. */
const GLUED_STREET_PREFIX_PATTERN = /^\s*(ul\.|al\.|pl\.)(?=[\p{L}])/iu;

/** Prefiks ze spacją: „ul. Marszałkowska” → „Marszałkowska”. */
const STREET_PREFIX_PATTERN =
  /^\s*(ul\.?|ulica|al\.?|aleja|alei|rondo|r\.|pl\.?|plac|bulw\.?|bulwar|skwer|park|droga|dl\.?)\s+/iu;

/** Ulica z prefiksem osiedla (os./osiedle) — nazwa osiedla, nie skrót do usunięcia. */
export function isOsiedleStreet(street: string | undefined): boolean {
  const s = (street ?? '').trim();
  return /^\s*(os\.|osiedle)(\s+|(?=[\p{L}]))/iu.test(s);
}

/** Nazwa osiedla bez prefiksu: „os. Wysokie” → „Wysokie”. */
export function getOsiedleCoreName(street: string): string {
  return street.replace(/^\s*(os\.|osiedle)\s*/iu, '').trim();
}

/** Zwraca nazwę ulicy bez dopisku (ul., al. itd.). Prefiks os./osiedle zostaje. */
export function stripStreetPrefix(street: string | undefined): string {
  let s = (street ?? '').trim();
  if (s.length === 0) {
    return '';
  }
  if (isOsiedleStreet(s)) {
    return s.replace(/\s+/g, ' ').trim();
  }
  s = s.replace(GLUED_STREET_PREFIX_PATTERN, '');
  s = s.replace(STREET_PREFIX_PATTERN, '');
  return s.trim();
}

function polishAsciiLowerLocal(text: string): string {
  return polishAsciiLower(text);
}

function normalizeStreetLookupKey(street: string): string {
  return polishAsciiLowerLocal(street).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function normalizeCityLookupKey(city: string): string {
  return polishAsciiLowerLocal(city).replace(/\./g, '').trim();
}

/** Skróty imion / tytułów w nazwach ulic → pełna forma pod OSM. */
const STREET_ABBREVIATION_CANONICAL: Record<string, string> = {
  'b glowackiego': 'Barbary Głowackiego',
  'k wielkiego': 'Króla Wielkiego',
};

/** Literówki zależne od miasta (klucz ulicy po normalizacji). */
const CITY_STREET_TYPO_CORRECTIONS: Array<{
  cityKey: string;
  streetKey: string;
  canonical: string;
}> = [
  { cityKey: 'chelm', streetKey: 'ramba brzeska', canonical: 'Rampa Brzeska' },
  { cityKey: 'krakow', streetKey: 'amii krakow', canonical: 'Armii Kraków' },
  { cityKey: 'krakow', streetKey: 'solidarosci', canonical: 'Solidarności' },
  { cityKey: 'gdansk', streetKey: 'chmielna', canonical: 'Chmielna' },
  { cityKey: 'sroda wlkp', streetKey: 'armii poznan', canonical: 'Plac Armii Poznań' },
  { cityKey: 'porajow', streetKey: 'trzech panstw', canonical: 'Aleja Trzech Państw' },
  { cityKey: 'pila', streetKey: 'powstancow wlkp', canonical: 'Aleja Powstańców Wlkp' },
  { cityKey: 'ostrow wlkp', streetKey: 'inzynierska', canonical: 'Inżynierska' },
  { cityKey: 'skopanie', streetKey: 'generala sikorskiego', canonical: 'Aleja Generała Sikorskiego' },
];

/** Prefiks typu ulicy do porównania (OSM często z/bez „Aleja” / „Plac”). */
const STREET_TYPE_PREFIX_FOR_COMPARE =
  /^\s*(ul\.?|ulica|al\.?|aleja|alei|pl\.?|plac)\s+/iu;

/** Śmieci z kolumny Ulica (nazwa sklepu przed ulicą). */
const LEADING_STREET_NOISE_PATTERN = /^\s*wizawi\s+/iu;

/** Ulica osadzona w polu: „… UL.LUBELSKA” → „Lubelska”. */
const EMBEDDED_STREET_PATTERN = /\bUL\.?\s*([\p{L}\s-]+)$/iu;

/** Typowe końcówki nazw ulic (nie osiedli / wsi w kolumnie Ulica). */
const LIKELY_STREET_SUFFIX =
  /(?:ow[aey]|sk[iy]|skiego|skich|na|ego|iej|ym|ów|u|ek)$/iu;

function extractEmbeddedStreet(raw: string): string {
  const match = raw.match(EMBEDDED_STREET_PATTERN);
  if (!match?.[1]) {
    return raw;
  }
  const extracted = match[1].replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (extracted.length === 0) {
    return raw;
  }
  return extracted.charAt(0).toUpperCase() + extracted.slice(1).toLowerCase();
}

/** Gen./ks./św./kard. → pełne formy zgodne z OSM (z odstępem lub bez: Gen.Sikorskiego). */
function expandStreetTitleAbbreviations(street: string): string {
  return street
    .replace(/^(gen|ks|kard|sw|św)\.(?=[\p{L}])/giu, (match) => {
      const lower = match.toLowerCase();
      if (lower.startsWith('gen')) return 'Generała ';
      if (lower.startsWith('ks')) return 'Księdza ';
      if (lower.startsWith('kard')) return 'Kardynała ';
      return 'Świętego ';
    })
    .replace(/^gen\.\s*/iu, 'Generała ')
    .replace(/^ks\.\s*/iu, 'Księdza ')
    .replace(/^kard\.\s*/iu, 'Kardynała ')
    .replace(/^sw\.\s*/iu, 'Świętego ')
    .replace(/^św\.\s*/iu, 'Świętego ');
}

function applyCityStreetTypoCorrections(street: string, miasto: string): string {
  const cityKey = normalizeCityLookupKey(miasto);
  const streetKey = normalizeStreetLookupKey(street);
  for (const rule of CITY_STREET_TYPO_CORRECTIONS) {
    if (cityKey === rule.cityKey && streetKey === rule.streetKey) {
      return rule.canonical;
    }
  }
  return street;
}

/** Rdzeń nazwy ulicy do porównania z OSM (skróty, typ ulicy, miasto). */
function normalizeStreetCoreForMatching(street: string, miasto = ''): string {
  let core = stripStreetPrefix(extractEmbeddedStreet(street.replace(LEADING_STREET_NOISE_PATTERN, '')));
  core = expandStreetTitleAbbreviations(core);

  const cityKey = normalizeCityLookupKey(miasto);
  if (cityKey === 'gdansk' && /^Gdańska\s+/iu.test(core)) {
    core = core.replace(/^Gdańska\s+/iu, '');
  }

  const abbrevKey = normalizeStreetLookupKey(core);
  const canonicalAbbrev = STREET_ABBREVIATION_CANONICAL[abbrevKey];
  if (canonicalAbbrev) {
    core = canonicalAbbrev;
  }

  core = applyCityStreetTypoCorrections(core, miasto);
  return core.replace(STREET_TYPE_PREFIX_FOR_COMPARE, '').trim();
}

/** Czy ulica w arkuszu wygląda na aleję/plac (po normalizacji). */
export function isAlejaOrPlacStreet(street: string): boolean {
  return /^\s*(al\.?|aleja|alei|pl\.?|plac)\s+/iu.test(street.trim());
}

/** Czy po normalizacji ulica wymaga dodatkowych zapytań z ul./al./plac. */
export function needsStreetPrefixQueryVariants(street: string, miasto: string): boolean {
  const raw = street.trim();
  if (raw.length === 0 || isOsiedleStreet(raw)) {
    return false;
  }
  if (/^\s*(ul\.?|ulica|al\.?|pl\.?)\s+/iu.test(raw)) {
    return false;
  }
  const core = normalizeStreetCoreForMatching(raw, miasto);
  return (
    /^(Generała|Księdza|Świętego|Kardynała|Aleja|Plac)\s+/u.test(core) ||
    /(?:owa|ska|skiego|skich|na|owa)$/iu.test(core.split(/\s+/).pop() ?? '')
  );
}

/**
 * W kolumnie Ulica wpisano nazwę miejscowości (wsi/przysiółka), nie drogi.
 * Np. miasto=GDÓW, ulica=KLĘCZANA.
 */
export function isHamletPlaceStreet(ulica: string, miasto: string): boolean {
  const core = stripStreetPrefix(ulica).trim();
  if (core.length === 0 || /^(gen\.|ks\.|kard\.|sw\.|św\.)/iu.test(core) || /\d/u.test(core)) {
    return false;
  }

  const words = core.split(/\s+/).filter(Boolean);
  if (words.length > 2) {
    return false;
  }

  const lastWord = words[words.length - 1] ?? '';
  const compact = core.replace(/\s+/g, '');
  if (/(?:SKIEGO|OWSKA|OWSKIEGO|OWA)$/u.test(compact)) {
    return false;
  }
  if (LIKELY_STREET_SUFFIX.test(lastWord) && core !== core.toUpperCase()) {
    return false;
  }

  const uKey = normalizeStreetLookupKey(core);
  const mKey = normalizeCityLookupKey(miasto);
  if (!uKey || uKey === mKey || uKey.length < 5) {
    return false;
  }

  return core === core.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]/u.test(core);
}

/**
 * Ujednolica pole „Ulica” z arkusza przed budową adresu i geokodowaniem.
 */
export function normalizeStreetFromSheet(ulica: string, miasto = ''): string {
  const raw = ulica.trim();
  if (raw.length === 0 || raw.toLowerCase() === 'brak') {
    return raw;
  }

  let street = stripStreetPrefix(
    extractEmbeddedStreet(raw.replace(LEADING_STREET_NOISE_PATTERN, '')),
  );
  street = expandStreetTitleAbbreviations(street);

  const cityKey = normalizeCityLookupKey(miasto);
  if (cityKey === 'gdansk' && /^Gdańska\s+/iu.test(street)) {
    street = street.replace(/^Gdańska\s+/iu, '');
  }

  const abbrevKey = normalizeStreetLookupKey(street);
  const canonicalAbbrev = STREET_ABBREVIATION_CANONICAL[abbrevKey];
  if (canonicalAbbrev) {
    street = canonicalAbbrev;
  }

  street = applyCityStreetTypoCorrections(street, miasto);

  return street;
}

/** Ulica znormalizowana do porównania (np. scoring Nominatim). */
export function normalizeStreetForCompare(street: string | undefined, miasto = ''): string {
  const core = normalizeStreetCoreForMatching(street ?? '', miasto);
  return polishAsciiFold(core.replace(/[„"«»']/g, ''));
}

/** Skrócony wariant ulicy do zapytań (Generała → Gen.) — pierwszy z listy wariantów. */
export function streetAbbreviationQueryVariant(street: string): string | null {
  const variants = streetTitleAbbreviationQueryVariants(street);
  return variants[0] ?? null;
}

type TitleAbbrevRule = {
  expanded: RegExp;
  abbrevForms: (prefix: string, rest: string) => string[];
};

const TITLE_ABBREV_RULES: TitleAbbrevRule[] = [
  {
    expanded: /^((?:Aleja|Plac)\s+)?Generała\s+(.+)$/iu,
    abbrevForms: (prefix, rest) => [
      `${prefix}Gen. ${rest}`,
      `${prefix}GEN. ${rest}`,
      `${prefix}Gen.${rest}`,
      `${prefix}GEN.${rest}`,
      `Gen. ${rest}`,
      `GEN. ${rest}`,
      `Gen.${rest}`,
      `GEN.${rest}`,
    ],
  },
  {
    expanded: /^((?:Aleja|Plac)\s+)?Księdza\s+(.+)$/iu,
    abbrevForms: (prefix, rest) => [
      `${prefix}ks. ${rest}`,
      `${prefix}KS. ${rest}`,
      `${prefix}ks.${rest}`,
      `ks. ${rest}`,
      `KS. ${rest}`,
    ],
  },
  {
    expanded: /^((?:Aleja|Plac)\s+)?Świętego\s+(.+)$/iu,
    abbrevForms: (prefix, rest) => [
      `${prefix}Św. ${rest}`,
      `${prefix}SW. ${rest}`,
      `${prefix}św. ${rest}`,
      `${prefix}SW ${rest}`,
      `Św. ${rest}`,
      `SW. ${rest}`,
      `ŚW. ${rest}`,
    ],
  },
  {
    expanded: /^((?:Aleja|Plac)\s+)?Kardynała\s+(.+)$/iu,
    abbrevForms: (prefix, rest) => [
      `${prefix}kard. ${rest}`,
      `${prefix}KARD. ${rest}`,
      `${prefix}kard.${rest}`,
      `kard. ${rest}`,
    ],
  },
];

function collectTitleAbbrevVariants(street: string, target: Set<string>): void {
  const trimmed = street.trim();
  if (trimmed.length === 0) {
    return;
  }

  for (const rule of TITLE_ABBREV_RULES) {
    const match = trimmed.match(rule.expanded);
    if (!match?.[2]) {
      continue;
    }
    const prefix = match[1] ?? '';
    const rest = match[2];
    for (const form of rule.abbrevForms(prefix, rest)) {
      target.add(form.replace(/\s+/g, ' ').trim());
    }
  }

  const abbrevMatch = trimmed.match(
    /^((?:Aleja|Plac)\s+)?((?:gen|GEN|ks|KS|kard|KARD|sw|SW|św|Św)\.?)\s*(.+)$/u,
  );
  if (abbrevMatch?.[3]) {
    const prefix = abbrevMatch[1] ?? '';
    const abbrev = abbrevMatch[2] ?? '';
    const rest = abbrevMatch[3];
    target.add(trimmed);
    target.add(`${prefix}${abbrev} ${rest}`.replace(/\s+/g, ' ').trim());
    target.add(`${prefix}${abbrev}${rest}`.replace(/\s+/g, ' ').trim());
    const expanded = expandStreetTitleAbbreviations(trimmed);
    if (expanded !== trimmed) {
      target.add(expanded);
      collectTitleAbbrevVariants(expanded, target);
    }
  }
}

/**
 * Warianty ulicy do zapytań Nominatim: rozwinięty zapis (Generała) i skróty (Gen./GEN./św.).
 * Gdy podano rawStreet — uwzględnia też oryginalny zapis z arkusza.
 */
export function streetTitleAbbreviationQueryVariants(
  normalizedStreet: string,
  rawStreet = '',
): string[] {
  const variants = new Set<string>();
  const normalized = normalizedStreet.trim();
  const raw = rawStreet.trim();

  collectTitleAbbrevVariants(normalized, variants);

  const normalizedCore = stripStreetPrefix(normalized) || normalized;
  if (normalizedCore !== normalized) {
    collectTitleAbbrevVariants(normalizedCore, variants);
  }

  if (raw.length > 0 && raw !== normalized) {
    collectTitleAbbrevVariants(raw, variants);
    const rawCore = stripStreetPrefix(raw) || raw;
    if (rawCore !== raw) {
      collectTitleAbbrevVariants(rawCore, variants);
    }
    variants.add(raw);
    variants.add(rawCore);
  }

  variants.delete(normalized);
  variants.delete(normalizedCore);
  return [...variants].filter((item) => item.length > 0);
}

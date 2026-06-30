/**
 * Kanoniczny klucz cache = buildAddress po tej samej normalizacji co wiersz z arkusza.
 */

import { normalizeCityForCompare, normalizeCityFromSheet, isKnownCanonicalCityName } from './cityNormalize.js';
import {
  buildAddress,
  correctKnownPostcodeTypo,
  stripTrailingHouseNumberFromStreet,
  type AddressParts,
} from './sheets.js';
import { streetTitleAbbreviationQueryVariants, normalizeStreetFromSheet } from './streetNormalize.js';
import { polishAsciiLower } from './polishText.js';

function isMissingStreet(street: string): boolean {
  const s = street.trim().toLowerCase();
  return s.length === 0 || s === 'brak';
}

/** Ostatni token(y) klucza cache jako numer budynku (np. „1 A”, „106A”, „10/10”). */
function extractNumerAndBody(tokens: string[]): { bodyTokens: string[]; numerBudynku: string } | null {
  if (tokens.length < 2) {
    return null;
  }

  const last = tokens[tokens.length - 1]!;
  const prev = tokens[tokens.length - 2]!;

  if (/^\d+$/u.test(prev) && /^[a-zA-Z]$/u.test(last)) {
    return {
      bodyTokens: tokens.slice(0, -2),
      numerBudynku: `${prev} ${last}`,
    };
  }

  if (/^[\d/]+[a-zA-Z]?$/u.test(last)) {
    return {
      bodyTokens: tokens.slice(0, -1),
      numerBudynku: last,
    };
  }

  return null;
}

function isStreetTitleWord(word: string): boolean {
  const folded = polishAsciiLower(word).replace(/\.$/u, '');
  return /^(generala|gen|ksie(dz)?a|ks|swiet(e)?go|sw|kardynal(a)?|kard|aleja|al|plac|ul)$/u.test(
    folded,
  );
}

function scoreCacheAddressSplit(
  firstBodyToken: string,
  miastoCandidate: string,
  miasto: string,
  ulicaCandidate: string,
  ulica: string,
  ulicaRaw: string,
  cityLen: number,
  bodyTokenCount: number,
): number {
  let score = cityLen;

  if (normalizeCityFromSheet(miastoCandidate) !== miastoCandidate) {
    score += 5;
  }
  if (ulica !== ulicaCandidate) {
    score += 3;
  }
  if (ulicaRaw !== ulicaCandidate) {
    score += 1;
  }
  if (normalizeCityForCompare(miastoCandidate) !== normalizeCityForCompare(miasto)) {
    score += 2;
  }

  const firstTokenIsKnownCity = isKnownCanonicalCityName(firstBodyToken);
  const treatAllBodyAsCity =
    bodyTokenCount === 2 && cityLen === bodyTokenCount && !firstTokenIsKnownCity;

  if (ulicaCandidate.length === 0 && cityLen > 1 && !treatAllBodyAsCity) {
    score -= 50;
  }

  const lastCityToken = miastoCandidate.split(/\s+/).pop() ?? '';
  if (cityLen > 1 && isStreetTitleWord(lastCityToken)) {
    score -= 20;
  }

  return score;
}

/** Parsuje klucz cache „kod miasto [ulica] numer” (najlepsze dopasowanie podziału miasto/ulica). */
export function parseCacheAddressKey(address: string): AddressParts | null {
  const match = address.match(/^(\d{2}-\d{3})\s+(.+)$/u);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const kodPocztowy = match[1];
  const tokens = match[2].trim().split(/\s+/).filter(Boolean);
  const numerExtract = extractNumerAndBody(tokens);
  if (!numerExtract) {
    return null;
  }

  const { bodyTokens, numerBudynku } = numerExtract;
  if (bodyTokens.length < 1) {
    return null;
  }

  let best: AddressParts | null = null;
  let bestScore = -1;

  for (let cityLen = 1; cityLen <= bodyTokens.length; cityLen++) {
    const miastoCandidate = bodyTokens.slice(0, cityLen).join(' ');
    const ulicaCandidate = bodyTokens.slice(cityLen).join(' ');
    const miasto = normalizeCityFromSheet(miastoCandidate);
    const ulicaRaw = stripTrailingHouseNumberFromStreet(ulicaCandidate, numerBudynku);
    const ulica = isMissingStreet(ulicaCandidate)
      ? ulicaCandidate
      : normalizeStreetFromSheet(ulicaRaw, miasto);
    const kod = correctKnownPostcodeTypo(kodPocztowy, miasto);

    const parts: AddressParts = {
      kodPocztowy: kod,
      miasto,
      ulica,
      numerBudynku,
    };

    const score = scoreCacheAddressSplit(
      bodyTokens[0] ?? '',
      miastoCandidate,
      miasto,
      ulicaCandidate,
      ulica,
      ulicaRaw,
      cityLen,
      bodyTokens.length,
    );

    if (score >= bestScore) {
      best = parts;
      bestScore = score;
    }
  }

  return best;
}

/** Kanoniczny klucz cache po normalizacji miasta, ulicy i kodu. */
export function buildCanonicalCacheKey(address: string): string | null {
  const parts = parseCacheAddressKey(address);
  if (!parts) {
    return null;
  }
  return buildAddress(parts);
}

/** Stary klucz → kanoniczny (np. Gdansk + Gen. → Gdańsk + Generała). */
export function canonicalCacheKeyFromLegacyAddress(address: string): string | null {
  const canonical = buildCanonicalCacheKey(address);
  if (!canonical || canonical === address) {
    return null;
  }
  return canonical;
}

/** Warianty ulicy w kluczu cache (Generała → Gen./GEN. itd.). */
export function legacyStreetAbbrevCacheKeyVariants(address: string): string[] {
  const parts = parseCacheAddressKey(address);
  if (!parts || isMissingStreet(parts.ulica)) {
    return [];
  }

  const canonical = buildAddress(parts);
  const variants = new Set<string>();

  for (const street of streetTitleAbbreviationQueryVariants(parts.ulica, '')) {
    variants.add(buildAddress({ ...parts, ulica: street }));
  }

  const dupInStreet = `${parts.ulica} ${parts.numerBudynku}`.trim();
  if (dupInStreet !== parts.ulica) {
    variants.add(buildAddress({ ...parts, ulica: dupInStreet }));
  }

  return [...variants].filter((key) => key !== canonical);
}

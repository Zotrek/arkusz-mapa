/**
 * Normalizacja polskich znaków do porównań i zapytań Nominatim (ogonki, ł→l).
 */

/** Małe litery ASCII: ą→a, ł→l, ź/ż→z itd. */
export function polishAsciiLower(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
}

/** Tekst do porównań (ulica, numer): ASCII + tylko litery/cyfry/spacje. */
export function polishAsciiFold(text: string): string {
  return polishAsciiLower(text).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Usuwa ogonki, zachowuje wielkość pierwszej litery słów (do zapytań). */
export function stripPolishDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

/** Czy tekst ma znaki spoza podstawowego ASCII (ogonki / ł). */
export function hasPolishDiacritics(text: string): boolean {
  return stripPolishDiacritics(text) !== text;
}

/** Wariant zapytania bez ogonków (Gdańsk → Gdansk), null gdy identyczny. */
export function nominatimAsciiQueryVariant(query: string): string | null {
  const variant = stripPolishDiacritics(query);
  return variant !== query ? variant : null;
}

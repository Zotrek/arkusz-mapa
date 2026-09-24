/**
 * Propozycja nazwy trasy: `nazwaPodwykonawcy-dd.mm.rr-nn`.
 * Jedna funkcja. HTML dostaje jej źródło przez `routeNameBrowserScript`, bez drugiej kopii reguł.
 * Pamięć sesji nie jest tutaj — żyje w otwartej stronie.
 */

/**
 * Zajęte nazwy z kolumny Trasa, krótka nazwa podwykonawcy i data odbioru.
 * Data protokołu `dd.mm.yyyy` albo `yyyy-mm-dd` wchodzi do nazwy jako `dd.mm.rr`.
 * Najmniejszy wolny numer od 01 do 99. Brak wolnego, pusta nazwa albo zła data: pusty string.
 */
export function proposeRouteName(
  occupiedNames: readonly string[],
  contractorShortName: string,
  pickupDate: string,
): string {
  if (!Array.isArray(occupiedNames)) {
    return '';
  }

  const contractor = String(contractorShortName ?? '').trim();
  if (contractor.length === 0) {
    return '';
  }

  const rawDate = String(pickupDate ?? '').trim();
  let day = 0;
  let month = 0;
  let year = 0;
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(rawDate);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    const yearText = dmy[3];
    year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return '';
  }

  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day
  ) {
    return '';
  }

  const stamp =
    String(day).padStart(2, '0') +
    '.' +
    String(month).padStart(2, '0') +
    '.' +
    String(year).slice(-2);
  const occupied = new Set<string>();
  for (const raw of occupiedNames) {
    occupied.add(String(raw ?? '').trim());
  }

  const prefix = contractor + '-' + stamp + '-';
  for (let n = 1; n <= 99; n += 1) {
    const candidate = prefix + String(n).padStart(2, '0');
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Czy nazwa trasy należy do podanego podwykonawcy (`nazwa-dd.mm.rr-nn`).
 * Inny kontrahent w sesji nie może „kontynuować” cudzej trasy.
 */
export function routeNameBelongsToContractor(
  routeName: string,
  contractorShortName: string,
): boolean {
  const name = String(routeName ?? '').trim();
  const contractor = String(contractorShortName ?? '').trim();
  if (!name || !contractor) {
    return false;
  }
  const prefix = contractor + '-';
  if (!name.startsWith(prefix)) {
    return false;
  }
  return /^\d{2}\.\d{2}\.\d{2}-\d{2}$/.test(name.slice(prefix.length));
}

/**
 * Nazwy, które blokują nowy numer. Sesja wchodzi razem z kolumną Trasa,
 * żeby druga trasa nie dostała z powrotem nazwy pierwszej, zanim arkusz ją odda.
 */
export function namesBlockingNewRoute(
  sheetNames: readonly string[] | null,
  sessionLastName: string,
): string[] {
  // Bez zagnieżdżonej arrow/function: tsx/esbuild owija je w `__name(...)`,
  // a `.toString()` wstrzyknięte do HTML mapy wywala ReferenceError w przeglądarce.
  const occupied: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(sheetNames)) {
    for (const raw of sheetNames) {
      const name = String(raw ?? '').trim();
      if (name.length === 0 || seen.has(name)) {
        continue;
      }
      seen.add(name);
      occupied.push(name);
    }
  }
  const session = String(sessionLastName ?? '').trim();
  if (session.length > 0 && !seen.has(session)) {
    occupied.push(session);
  }
  return occupied;
}

/**
 * Usuwa wrapper `__name(expr, "id")` z tsx/esbuild keepNames
 * (w przeglądarce helpera `__name` nie ma).
 */
export function stripEsbuildKeepNames(source: string): string {
  let out = source;
  for (;;) {
    const start = out.indexOf('__name(');
    if (start < 0) {
      return out;
    }
    let i = start + '__name('.length;
    let depth = 1;
    let argSplit = -1;
    let inStr: '"' | "'" | '`' | null = null;
    let escape = false;
    for (; i < out.length; i += 1) {
      const c = out[i];
      if (inStr) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === inStr) {
          inStr = null;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        continue;
      }
      if (c === '(') {
        depth += 1;
        continue;
      }
      if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
        continue;
      }
      if (c === ',' && depth === 1 && argSplit < 0) {
        argSplit = i;
      }
    }
    if (depth !== 0 || argSplit < 0) {
      return out;
    }
    const expr = out.slice(start + '__name('.length, argSplit);
    out = out.slice(0, start) + expr + out.slice(i + 1);
  }
}

/** Źródło funkcji do HTML — bez wrapperów keepNames z tsx/esbuild. */
export function functionSourceForBrowser(fn: (...args: never[]) => unknown): string {
  return stripEsbuildKeepNames(Function.prototype.toString.call(fn));
}

/** Ten sam kod co funkcje nazwy, wstrzykiwany do HTML. Nie duplikować reguł obok. */
export function routeNameBrowserScript(): string {
  return (
    '\n' +
    functionSourceForBrowser(namesBlockingNewRoute) +
    '\n' +
    functionSourceForBrowser(routeNameBelongsToContractor) +
    '\n' +
    functionSourceForBrowser(proposeRouteName) +
    '\n'
  );
}

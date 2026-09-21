/**
 * Okno protokołu: co pokazać w polach trasy i co dołożyć do POST.
 * Pamięć sesji nie jest tutaj. Żyje w zmiennej otwartej strony, nie w localStorage.
 */

export type RouteBodyFields = {
  trasa: string;
  stawkaTrasy: string;
};

export type RouteNameShowInput = {
  sessionLastName: string;
  proposal: string;
  currentInput: string;
  inputTouched: boolean;
};

/**
 * Checkbox wyłączony: body bez trasy.
 * Zaznaczony: kolumny 12–13, także gdy stawka jest pusta albo równa 0. To nie blokuje Worda.
 * Pusta stawka nie zapisuje tylko nowej trasy po odpięciu — to nie to okno.
 */
export function routeBodyFields(
  routeChecked: boolean,
  routeName: string,
  routeRate: string,
): RouteBodyFields | null {
  if (!routeChecked) {
    return null;
  }
  return {
    trasa: String(routeName ?? '').trim(),
    stawkaTrasy: String(routeRate ?? '').trim(),
  };
}

/**
 * Ostatnia nazwa sesji zostaje, bez podbijania numeru.
 * Wpis użytkownika zostaje, także gdy nazwa już jest w arkuszu.
 * Inaczej propozycja, albo pusty string.
 */
export function routeNameToShow(input: RouteNameShowInput): string {
  const current = input && input.currentInput != null ? String(input.currentInput) : '';
  if (input && input.inputTouched) {
    return current;
  }
  const last = input && input.sessionLastName != null ? String(input.sessionLastName).trim() : '';
  if (last.length > 0) {
    return last;
  }
  return input && input.proposal != null ? String(input.proposal).trim() : '';
}

/** Po udanym zapisie ta nazwa jest ostatnią w sesji. Pusta nie czyści poprzedniej. */
export function routeNameRememberedAfterSave(savedName: string): string {
  return String(savedName ?? '').trim();
}

/** Stawka z `routeRateByName`. Brak i pusto zostają puste. Zero zostaje zerem. */
export function routeRateFromLookup(rate: unknown): string {
  if (rate == null) {
    return '';
  }
  return String(rate).trim();
}

/**
 * Podpowiedź do pola. Edycja użytkownika zostaje.
 * Pusta odpowiedź arkusza nie kasuje tego, co już jest w polu. Zero z arkusza wchodzi.
 */
export function routeRateToKeep(currentRate: string, lookedUpRate: unknown, userEdited: boolean): string {
  const current = String(currentRate ?? '');
  if (userEdited) {
    return current;
  }
  const fromSheet = routeRateFromLookup(lookedUpRate);
  if (fromSheet === '') {
    return current;
  }
  return fromSheet;
}

/**
 * Stawka z ostatniego zapisu tej samej nazwy w sesji.
 * Inna nazwa, pusta pamięć albo kwota już wpisana: zostaje bieżące pole.
 */
export function routeRateFromSession(
  shownName: string,
  currentRate: string,
  sessionName: string,
  sessionRate: string,
): string {
  const current = String(currentRate ?? '');
  if (current.trim()) {
    return current;
  }
  const name = String(shownName ?? '').trim();
  const rememberedName = String(sessionName ?? '').trim();
  const rememberedRate = String(sessionRate ?? '').trim();
  if (!name || !rememberedRate || name !== rememberedName) {
    return '';
  }
  return rememberedRate;
}

/**
 * Inna niepusta stawka przy nazwie, która już ma kwotę.
 * Ta sama kwota, pusta nowa albo brak dotychczasowej: zapis bez pytania.
 * Zero jest kwotą.
 */
export function routeRateConflictsWithExisting(
  routeName: string,
  nextRate: string,
  existingRate: string,
): boolean {
  const name = String(routeName ?? '').trim();
  const next = String(nextRate ?? '').trim();
  const existing = String(existingRate ?? '').trim();
  if (name.length === 0 || next.length === 0 || existing.length === 0) {
    return false;
  }
  return next !== existing;
}

/** Dokleja kolumny 12–13 albo nie rusza body, gdy trasy nie ma. */
export function assignRouteBody(
  payload: Record<string, unknown> | null,
  fields: RouteBodyFields | null,
): Record<string, unknown> | null {
  if (!payload || !fields) {
    return payload;
  }
  payload.trasa = fields.trasa;
  payload.stawkaTrasy = fields.stawkaTrasy;
  return payload;
}

/** Ten sam kod, wstrzykiwany do HTML. Nie duplikować reguł obok. */
export function routeProtocolBrowserScript(): string {
  return (
    '\n' +
    routeBodyFields.toString() +
    '\n' +
    routeNameToShow.toString() +
    '\n' +
    routeNameRememberedAfterSave.toString() +
    '\n' +
    routeRateFromLookup.toString() +
    '\n' +
    routeRateToKeep.toString() +
    '\n' +
    routeRateFromSession.toString() +
    '\n' +
    routeRateConflictsWithExisting.toString() +
    '\n' +
    assignRouteBody.toString() +
    '\n'
  );
}

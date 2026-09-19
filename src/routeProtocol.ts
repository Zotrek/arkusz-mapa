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
    assignRouteBody.toString() +
    '\n'
  );
}

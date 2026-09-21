# Migracja rejestru V2 — stawki podjazdu/worka

Jednorazowa zmiana układu pierwszej zakładki arkusza
`1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk`.

## Docelowy układ

| Kolumny | Zawartość |
|---------|-----------|
| 1–9 | bez zmian |
| 10–11 | Trasa, Stawka za trasę (było 12–13) |
| 12–13 | Stawka za podjazd, Stawka za worek (snapshot z Bazy) |
| 14–18 | Rozliczony … transport się odbył (numery bez zmian) |
| 19–20 | Komentarz 1 / 2 (było 10–11) |

## Kolejność (obowiązkowa)

1. **Zatrzymaj zapisy** — nie generuj protokołów na mapie i nie zatwierdzaj rozliczeń.
2. **Wdróż** nowy `arkusz-mapa/google-apps-script/transport-log.gs` (Apps Script → wklej → Nowe wdrożenie Web App albo aktualizacja istniejącego).
3. W edytorze Apps Script uruchom **raz** funkcję `migrateRegisterLayoutRates_`.
   - Sukces: `{ ok: true, rows: N }`.
   - Ponowne uruchomienie: `{ ok: true, skipped: true, reason: 'already-v2' }`.
4. **Wdróż frontendy** `arkusz-mapa` i `rozliczenia` (GitHub Pages), zbudowane z kodu po tej zmianie.
5. **Smoke**
   - Protokół ze stawką w Bazie stawek → kolumny 12–13 wypełnione.
   - Protokół bez pary w Bazie → 12–13 puste.
   - Wyszukanie w rozliczeniach → koszt ze snapshotu.
   - Zatwierdź jednego wiersza.
   - `saveRate` w oknie Bazy stawek nadal działa.

## Uwagi

- Odwrócona kolejność (frontend przed migracją / stary GAS po migracji) psuje komentarze, trasy i koszty.
- Remis w Bazie przy migracji/append → puste 12–13 (koszt 0).
- Zmiana Bazy po protokole nie aktualizuje historycznych wierszy rejestru.

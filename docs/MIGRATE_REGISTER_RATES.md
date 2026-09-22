# Migracja rejestru V2 — stawki podjazdu/worka

Jednorazowa zmiana układu zakładki **`Arkusz1`** (rejestr) w arkuszu
`1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk`.

## Docelowy układ

| Kolumna | Nagłówek |
|---------|---------|
| A–I (1–9) | bez zmian |
| J (10) | Trasa |
| K (11) | Stawka za trasę |
| L (12) | Stawka za podjazd |
| M (13) | Stawka za worek |
| N–R (14–18) | Rozliczony … transport się odbył |
| S–T (19–20) | Komentarz 1 / 2 |

## Objaw złego stanu (przed naprawą)

- J = Komentarz 1, L = Trasa, a w R/S też „Komentarz” → migracja **nie** przeszła; tylko dopisano puste nagłówki.
- Nowa stawka za worek ląduje w kolumnie „Stawka za trasę” → Web App pisze już wg V2, a arkusz jest nadal V1.

## Kolejność

1. **Nie generuj protokołów** (stary układ + nowy kod psuje wiersze).
2. Wklej aktualny `transport-log.gs` do Apps Script i **Zapisz**.
3. Uruchom **`migrateRegisterLayoutRates`** (bez `_` na końcu — taką widać na liście Uruchom).
   Funkcja z `_` jest ukryta przez Apps Script.
4. **Widok → Dzienniki wykonania** — szukaj JSON:
   - sukces: `"ok":true,"h10":"Trasa","h12":"Stawka za podjazd","h19":"Komentarz 1"`
   - już zrobione: `"skipped":true,"reason":"already-v2"`
5. Sprawdź w arkuszu wiersz 1 (J/L/S jak w tabeli wyżej) i kilka starych wierszy (trasa w J, komentarz w S).
6. **Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja** (Web App `/exec`).
7. Smoke: nowy protokół ze stawką w Bazie → L/M wypełnione snapshotem, nie stawką trasy.

## Uwagi

- Wiersze dopisane *przed* udaną migracją przy nowym kodzie mogą mieć pomieszane L/M — sprawdź ostatnie ręcznie.
- Remis w Bazie przy backfill → puste L/M (koszt 0).

# Migracja rejestru — układ V3 (transport się odbył po Ilość worków)

Jednorazowa zmiana układu **`Arkusz1`** i **`zestawienie z harmonogramu`** w arkuszu
`1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk`.

## Docelowy układ (V3)

### Arkusz1

| Kolumna | Nagłówek |
|---------|---------|
| A–I (1–9) | bez zmian |
| J (10) | transport się odbył |
| K (11) | Trasa |
| L (12) | Stawka za trasę |
| M (13) | Stawka za podjazd |
| N (14) | Stawka za worek |
| O–R (15–18) | Rozliczony … Koszt odbioru per worek |
| S–T (19–20) | Komentarz 1 / 2 |

### zestawienie z harmonogramu

Jak Arkusz1 bez nr zlecenia: **I (9)** = transport się odbył, **J (10)** = Trasa, … komentarze w R–S.

## Którą funkcję uruchomić?

| Stan arkusza | Funkcja |
|--------------|---------|
| V1 (komentarze w J/K, Trasa w L) | **`migrateRegisterLayoutRates`** → od razu V3 |
| V2 (Trasa w J, transport w R / zestawienie Q) | **`migrateRegisterLayoutTransportOdbył`** → V3 |
| już V3 (J = transport się odbył, K = Trasa) | nic — `"skipped":true,"reason":"already-v3"` |

## Kolejność

1. **Nie generuj protokołów** (stary układ + nowy kod psuje wiersze / blokuje zapis).
2. Wklej aktualny `transport-log.gs` do Apps Script i **Zapisz**.
3. Uruchom właściwą funkcję z listy **Uruchom** (bez `_` na końcu).
4. **Widok → Dzienniki wykonania** — szukaj JSON:
   - V1→V3: `"ok":true,"h10":"transport się odbył","h11":"Trasa","h19":"Komentarz 1"`
   - V2→V3: `"ok":true,"arkusz1":{…},"zestawienie":{…}` z `h10`/`h9` = transport się odbył
   - już zrobione: `"skipped":true,"reason":"already-v3"`
5. Sprawdź w arkuszu wiersz 1 (J = transport, K = Trasa) i kilka starych wierszy.
6. **Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja** (Web App `/exec`).
7. Smoke: nowy protokół + zaznaczenie „nie” w kolumnie J → przekreślenie wiersza.

## Uwagi

- Pipeline sync (`syncZestawienieHarmonogram`) przy V2 nagłówkach sam przepisuje zestawienie V2→V3 przed dopisaniem wierszy.
- Remis w Bazie przy backfill V1→V3 → puste M/N (koszt 0).

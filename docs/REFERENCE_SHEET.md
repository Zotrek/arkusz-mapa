# Arkusz referencyjny (transporty + słowniki)

Słowniki **Przewoźnicy**, **Miejsca dostawy** i **Popraw adres** żyją w **tym samym dokumencie Google Sheets** co rejestr transportów (`GOOGLE_TRANSPORT_SHEETS_ID`). Nie dodawaj ich do arkusza plomb — faza 4 kasuje wszystkie zakładki poza źródłową.

## Zakładki

| Zakładka | Kolumny | Rola |
|----------|---------|------|
| *(pierwsza)* | Rejestr transportów | Bez zmian — patrz [TRANSPORT_SHEET.md](./TRANSPORT_SHEET.md) |
| **Przewoźnicy** | Nazwa wyświetlana, Nazwa do protokołu, Adres, NIP, nr BDO | Combobox „Kto odbiera” w mapie / Word |
| **Miejsca dostawy** | Nazwa, Dane do Worda | Combobox „Miejsce dostawy” |
| **Popraw adres** | Podmiot handlowy, Sklep, Adres, Lat, Lon, Uwagi, UpdatedAt, Author | Najwyższy priorytet współrzędnych przy `npm run generate` |

Zakładki tworzą się automatycznie przy pierwszym zapisie z mapy (Apps Script) lub ręcznie z nagłówkami jak wyżej.

## Web App (Apps Script)

Plik: [`google-apps-script/transport-log.gs`](../google-apps-script/transport-log.gs)

| Metoda | Opis |
|--------|------|
| GET `action=listReferenceData` | `{ przewoznicy, miejscaDostawy, poprawAdres }` |
| POST `mode=addReferencePrzewoznik` | Nowy przewoźnik |
| POST `mode=addReferenceDostawa` | Nowe miejsce dostawy |
| POST `mode=addPoprawAdres` | Ręczna poprawka współrzędnych |

Po wdrożeniu skryptu ustaw `TRANSPORT_WEBAPP_URL` (jak w [TRANSPORT_SHEET.md](./TRANSPORT_SHEET.md)).

## Ladder współrzędnych (faza 5)

Kolejność przy generowaniu mapy:

1. **Popraw adres** (Google Sheet + fallback `data/phase5-address-overrides.json`)
2. **`data/phase5-cache.json`** (repo — committowane poprawki)
3. **`.cache/phase5-cache.json`** — tylko klucze, których nie ma w `data/`
4. **Nominatim** (geokodowanie)

## UI na mapie

Gdy `TRANSPORT_WEBAPP_URL` jest ustawiony:

- Przycisk **„Dodaj przewoźnika / popraw adres”** w panelu wyszukiwania
- **„Popraw adres”** w popupie pinezki (prefill podmiot / sklep / adres / współrzędne)

Zapis idzie od razu do Google Sheets. Aby zobaczyć nową pinezkę po poprawce adresu, uruchom ponownie `npm run generate`.

## Sync JSON (opcjonalnie)

```bash
npm run pull:reference
```

Zapisuje:

- `data/reference-przewoznicy.json`
- `data/reference-miejsca-dostawy.json`

Przy buildzie mapy JSON ma pierwszeństwo przed `docs/podwyko lista.xlsx`. Odczyt **Popraw adres** przy generate odbywa się bezpośrednio z Google Sheets (Service Account).

## Migracja overrides

Istniejące wpisy w `data/phase5-address-overrides.json` nadal działają jako fallback (krok 1 ladderu), dopóki nie zostaną skopiowane do zakładki **Popraw adres**.

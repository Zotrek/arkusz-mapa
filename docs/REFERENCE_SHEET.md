# Arkusz referencyjny (transporty + słowniki)

Słowniki **Lista podwykonawców** i **Popraw adres** żyją w **tym samym dokumencie Google Sheets** co rejestr transportów (`GOOGLE_TRANSPORT_SHEETS_ID`). Nie dodawaj ich do arkusza plomb — faza 4 kasuje wszystkie zakładki poza źródłową.

## Wspólna lista podwykonawców

Jak historycznie `docs/podwyko lista.xlsx`: **jedna lista** dla obu comboboxów w Word/mapa (**Kto odbiera** i **Miejsce dostawy**). Nie ma osobnych list jak w druga-mila.

## Zakładki

| Zakładka | Kolumny | Rola |
|----------|---------|------|
| *(pierwsza)* | Rejestr transportów | Bez zmian — patrz [TRANSPORT_SHEET.md](./TRANSPORT_SHEET.md) |
| **Lista podwykonawców** | Nazwa, Dane do Worda | Wspólna lista comboboxów |
| **Popraw adres** | Podmiot handlowy, Sklep, Adres, Lat, Lon, Uwagi, UpdatedAt, Author | Najwyższy priorytet współrzędnych przy `npm run generate` |

Zakładki tworzą się automatycznie przy pierwszym zapisie z mapy (Apps Script) lub ręcznie z nagłówkami jak wyżej.

**Migracja:** starsze zakładki **Przewoźnicy** i **Miejsca dostawy** (jeśli istnieją) są nadal **odczytywane i scalane** przy `listReferenceData`. Nowe wpisy trafiają wyłącznie do **Lista podwykonawców**.

## Web App (Apps Script)

Plik: [`google-apps-script/transport-log.gs`](../google-apps-script/transport-log.gs)

| Metoda | Opis |
|--------|------|
| GET `action=listReferenceData` | `{ podwykoLista, poprawAdres }` |
| POST `mode=addReferencePodwyko` | Nowy wpis na wspólnej liście |
| POST `mode=addPoprawAdres` | Ręczna poprawka współrzędnych |

Legacy POST (`addReferencePrzewoznik`, `addReferenceDostawa`) mapuje na ten sam zapis.

Po wdrożeniu skryptu ustaw `TRANSPORT_WEBAPP_URL` (jak w [TRANSPORT_SHEET.md](./TRANSPORT_SHEET.md)).

## Ladder współrzędnych (faza 5)

Kolejność przy generowaniu mapy:

1. **Popraw adres** (Google Sheet + fallback `data/phase5-address-overrides.json`)
2. **`data/phase5-cache.json`** (repo — committowane poprawki)
3. **`.cache/phase5-cache.json`** — tylko klucze, których nie ma w `data/`
4. **Nominatim** (geokodowanie)

## UI na mapie

Gdy `TRANSPORT_WEBAPP_URL` jest ustawiony:

- Przycisk **„Dodaj do listy / popraw adres”** w panelu wyszukiwania
- **„Popraw adres”** w popupie pinezki (prefill podmiot / sklep / adres / współrzędne)

Zapis idzie od razu do Google Sheets. Aby zobaczyć nową pinezkę po poprawce adresu, uruchom ponownie `npm run generate`.

## Sync z / do Google Sheets

### Wgranie lokalnej listy do arkusza (seed)

Gdy zakładka **Lista podwykonawców** jest pusta, a dane są w `docs/podwyko lista.xlsx`:

```bash
npm run push:reference
```

Scalanie: wpisy z XLSX + istniejące w arkuszu (bez duplikatów po parze Nazwa/Dane), zapis na zakładkę **Lista podwykonawców**.

### Pobranie z Web App do JSON (opcjonalnie)

```bash
npm run pull:reference
```

Zapisuje:

- `data/reference-podwyko-lista.json`

Przy buildzie mapy JSON ma pierwszeństwo przed `docs/podwyko lista.xlsx`. Odczyt **Popraw adres** przy generate odbywa się bezpośrednio z Google Sheets (Service Account).

## Migracja overrides

Istniejące wpisy w `data/phase5-address-overrides.json` nadal działają jako fallback (krok 1 ladderu), dopóki nie zostaną skopiowane do zakładki **Popraw adres**.

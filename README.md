# Arkusz Mapa (CLI)

Skrypt uruchamiany lokalnie, który realizuje pipeline:

1. Odczyt danych z Google Sheets
2. Wykrycie duplikatów `Numer plomby` (kolumna H)
3. Grupowanie adresów dla rekordów bez duplikatów
4. Geokodowanie (Nominatim / OSM) – wiele wariantów zapytań (m.in. z/bez kodu na początku); kod z arkusza jest weryfikowany z kodem z wyniku OSM
5. Aktualizacja zakładek w arkuszu:
   - `Duplikaty plomb`
   - `Błędne adresy`
6. Wygenerowanie mapy HTML:
   - `mapa_YYYY-MM-DD_HH-mm-ss.html`

## Wymagania

- Node.js 18+
- Dostęp do Google Sheets API
- Konto Service Account z plikiem JSON

## Konfiguracja

1. Skopiuj `.env.example` do `.env`
2. Uzupełnij zmienne:
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS` (ścieżka do pliku JSON)
   - `OUTPUT_DIR` (folder na mapy)
3. Udostępnij arkusz Google adresowi e-mail Service Account (uprawnienia edycji).

## Instalacja

```bash
npm install
```

## Uruchomienie

```bash
npm run generate
```

## Build

```bash
npm run build
```

Kompilacja TypeScript → `dist/`. Do uruchomienia pipeline’u użyj `npm run generate` (tsx).

## Testy

```bash
npm test
```

## Wyniki

- Zakładka `Duplikaty plomb` jest nadpisywana przy każdym uruchomieniu.
- Zakładka `Błędne adresy` zawiera rekordy, których nie udało się geokodować.
- Mapa HTML jest generowana jako nowy plik w `OUTPUT_DIR`. Można ją otwierać bezpośrednio z dysku (file://) – kafelki pochodzą z TileServerS (dane OSM), bez wymogu HTTP Referer.

Szczegóły geokodowania (Nominatim, warianty zapytań, analiza adresów): `dev_docs/OSM_adresy_analiza.md`.

# Arkusz transportów — integracja z mapą

Rejestr transportów (osobny arkusz Google Sheets) synchronizuje się z mapą HTML na GitHub Pages przez **Google Apps Script Web App**.

## Arkusz

- **ID (przykład):** `1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk`
- **Wiersz 1 — nagłówki (kolejność kolumn):**
  1. Numer transportowy
  2. Adres sklepu
  3. Podmiot handlowy
  4. Sklep
  5. Data odbioru
  6. Kto odbiera
  7. Miejsce zrzutu
  8. Rodzaj zbiórki
  9. Ilość worków

## Wdrożenie Apps Script (jednorazowo)

1. Otwórz arkusz transportów → **Rozszerzenia → Apps Script**.
2. Skopiuj treść pliku [`google-apps-script/transport-log.gs`](../google-apps-script/transport-log.gs) do edytora (usuń domyślny `Code.gs` lub zastąp).
3. **Wdróż → Nowe wdrożenie → Typ: Aplikacja internetowa**
   - Wykonaj jako: **Ja**
   - Kto ma dostęp: **Każdy**
4. Skopiuj **URL aplikacji internetowej** (kończy się na `/exec`).
5. Ustaw zmienną środowiskową / sekret GitHub:
   - `TRANSPORT_WEBAPP_URL=https://script.google.com/macros/s/…/exec`
6. Opcjonalnie: `GOOGLE_TRANSPORT_SHEETS_ID` — ID arkusza (dokumentacja / przyszłe walidacje).

## API Web App

| Metoda | Parametry | Opis |
|--------|-----------|------|
| GET | `action=previewNumber` | Podgląd następnego numeru (max kolumna A + 1) |
| GET | `action=lastTransportDate&podmiot=…&adres=…` | Ostatnia data odbioru dla klucza **podmiot + adres** |
| POST | JSON w body (`Content-Type: text/plain`) | Atomowy zapis wiersza (`LockService`) + zwraca `numer` |

Przykład POST (body):

```json
{
  "adresSklepu": "00-001 Warszawa ul. Testowa 1",
  "podmiotHandlowy": "Firma SA",
  "sklep": "Sklep 123",
  "dataOdbioru": "15.06.2026",
  "ktoOdbiera": "Janex",
  "miejsceZrzutu": "Magazyn",
  "rodzajZbiorki": "ręczna",
  "iloscWorkow": 5
}
```

## Lokalnie i CI

W `.env`:

```env
TRANSPORT_WEBAPP_URL=https://script.google.com/macros/s/…/exec
GOOGLE_TRANSPORT_SHEETS_ID=1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk
```

GitHub Actions (`arkusz-mapa-pages.yml`) przekazuje `TRANSPORT_WEBAPP_URL` do `npm run generate`.

Bez `TRANSPORT_WEBAPP_URL` mapa generuje protokoły **bez** zapisu do arkusza (numer trzeba wpisać ręcznie).

## Zachowanie mapy

1. **Otwarcie modala** — pobranie ostatniej daty transportu (podmiot + adres) i podglądu numeru.
2. **Filtrowanie plomb** — z protokołu usuwane są worki ze datą zamknięcia **wcześniejszą** niż ostatni transport (data równa zostaje).
3. **Pobierz .docx** — zapis wiersza w arkuszu, potem pobranie Worda z numerem z serwera.

## Limity Apps Script

Darmowe konto Google — dzienne limity czasu wykonania i liczby wywołań. Przy typowej pracy kilku osób dziennie wystarcza. Szczegóły: [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

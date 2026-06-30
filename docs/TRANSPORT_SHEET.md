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

| GET | `action=modalData&podmiot=…&adres=…` | **Zalecane** — numer + ostatnia data w jednym requestcie |

| GET | `action=previewNumber` | Podgląd następnego numeru (cache Script Properties) |

| GET | `action=lastTransportDate&podmiot=…&adres=…` | Ostatnia data odbioru (kolumna E) dla klucza **podmiot + adres** |

| POST | JSON w body (`Content-Type: text/plain`) | Atomowy zapis wiersza (`LockService`) + zwraca `numer`. Opcjonalne `numer` w body — jeśli użytkownik wpisał ręcznie, ten numer trafia do arkusza zamiast automatycznego |



Przykład POST (body):



```json

{

  "numer": "1460",

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

2. **Filtrowanie plomb** — z protokołu usuwane są worki ze datą zamknięcia **wcześniejszą** niż ostatni transport (kolumna E). Przy dacie transportu 20.06.2026 zostają plomby z 20.06, 25.06 itd., a znikają np. 10.06, 15.06.

3. **Pobierz .docx** — zapis wiersza w arkuszu, potem pobranie Worda z numerem z serwera. Jeśli użytkownik **zmieni** numer w polu (względem podglądu), zapisany i w dokumencie będzie ten wpisany ręcznie; bez zmiany — atomowa numeracja po stronie serwera.



## Limity Apps Script



Darmowe konto Google — dzienne limity czasu wykonania i liczby wywołań. Przy typowej pracy kilku osób dziennie wystarcza. Szczegóły: [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).



## Numeracja (cache)



Numer kolejny trzymany jest w **Script Properties** (`transportMaxNum`) — podgląd i zapis POST nie skanują całej kolumny A.

Po ręcznej edycji numerów w arkuszu uruchom w edytorze Apps Script funkcję **`rebuildTransportCounterFromSheet`** (Run), potem **Deploy → Manage deployments → Edit → New version** jeśli zmieniłeś kod.


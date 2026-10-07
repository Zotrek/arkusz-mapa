# Arkusz transportów — integracja z mapą

Rejestr transportów (osobny arkusz Google Sheets) synchronizuje się z mapą HTML na GitHub Pages przez **Google Apps Script Web App**.

**Słowniki referencyjne** (Lista podwykonawców, Popraw adres) — ten sam arkusz i Web App: [REFERENCE_SHEET.md](./REFERENCE_SHEET.md).



- **ID (przykład):** `1hvSvy9c069SefhYH3rCUDtCViRhAoRQ6DDj_EIlmWNk`

- **Zakładki (Web App szuka po nazwie):**

  - `Arkusz1` — rejestr transportów (Na zgłoszenie)
  - `odebrane z harmonogramu` — 1 wiersz = 1 worek (źródło sync)
  - `zestawienie z harmonogramu` — rejestr odbiorów Harmonogram (bez nr zlecenia; Rodzaj zbiórki z Tryb zbiórki; sync uzupełnia, nigdy nie czyści; nazwy kontrahenta/punktu także przy 0 workach z odebrane)

- **Wiersz 1 — nagłówki rejestru Arkusz1 (kolejność kolumn):**

  1. Numer transportowy

  2. Adres sklepu

  3. Podmiot handlowy

  4. Sklep

  5. Data odbioru

  6. Kto odbiera

  7. Miejsce zrzutu

  8. Rodzaj zbiórki

  9. Ilość worków

  10. transport się odbył

  11. Trasa

  12. Stawka za trasę

  13. Stawka za podjazd

  14. Stawka za worek

  15. Rozliczony

  16. Numer faktury

  17. Koszt odbioru

  18. Koszt odbioru per worek

  19. Komentarz 1

  20. Komentarz 2

- **Nagłówki `zestawienie z harmonogramu`:** jak Arkusz1, **bez** „Nr zlecenia transportowego” (kolumny przesunięte o −1). Rodzaj zbiórki = agregacja z kolumny Tryb zbiórki w `odebrane z harmonogramu`. Kolumna „transport się odbył” (po Ilość worków) ma listę tak/nie. Sync nigdy nie czyści zakładki. Przy 0 workach **Nazwa kontrahenta** i **Nazwa punktu** biorą się z dowolnego wiersza `odebrane` tego adresu. Zapis `saveRateHarmonogram` od razu uzupełnia stawki/trasę na nierozliczonych wierszach tej pary sklep+podwykonawca (bez czekania na pipeline). Sync dopisuje wiersz **dzień po** teoretycznej dacie odbioru (odbiór 01.10 → zestawienie od 02.10; kolumna Data odbioru zostaje 01.10).



1. Otwórz arkusz transportów → **Rozszerzenia → Apps Script**.

2. Skopiuj treść pliku [`google-apps-script/transport-log.gs`](../google-apps-script/transport-log.gs) do edytora (usuń domyślny `Code.gs` lub zastąp).

3. **Wdróż → Nowe wdrożenie → Typ: Aplikacja internetowa**

   - Wykonaj jako: **Ja**

   - Kto ma dostęp: **Każdy**

4. Skopiuj **URL aplikacji internetowej** (kończy się na `/exec`).

5. Ustaw zmienną środowiskową / sekret GitHub:

   - `TRANSPORT_WEBAPP_URL=https://…workers.dev/api/transport`  
     (Cloudflare Worker — **nie** bezpośredni `script.google.com/…/exec`)

6. Opcjonalnie: `GOOGLE_TRANSPORT_SHEETS_ID` — tylko lokalnie / sekrety CI (nie w publicznym HTML).

**Hasło strony + proxy:** pełna instrukcja Cloudflare i `GAS_SHARED_SECRET` → [`cloudflare/SETUP.md`](../../cloudflare/SETUP.md) (monorepo).



## API Web App



| Metoda | Parametry | Opis |

|--------|-----------|------|

| GET | `action=modalData&podmiot=…&adres=…` | **Zalecane** — numer + ostatnia data + kto odbiera w jednym requestcie. Wiersz z kolumną 18 = `nie` nie wchodzi w datę |

| GET | `action=previewNumber` | Podgląd następnego numeru (cache Script Properties) |

| GET | `action=lastTransportDate&podmiot=…&adres=…` | Ostatnia data odbioru (kolumna E) + **Kto odbiera** (kolumna F) dla klucza **podmiot + adres**. Wiersz z kolumną 18 = `nie` nie wchodzi |

| GET | `action=bulkLastTransportDates` | Ostatnie daty + kto odbiera dla wszystkich sklepów (mapa / popup). Wiersz z kolumną 18 = `nie` nie wchodzi |

| GET/POST | `action=settlementSearch&tryb=harmonogram` | Odczyt zestawienia z `zestawienie z harmonogramu` |

| POST | `action=syncZestawienieHarmonogram` | Agregacja odebrane + dni Bazy cen → zestawienie (domyślnie bieżący miesiąc → dziś) |

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

  "iloscWorkow": 5,

  "komentarz1": "Uwaga do arkusza",

  "komentarz2": "",

  "trasa": "gpw-18.09.26-01",

  "stawkaTrasy": "150"

}

```

Klucze `trasa` i `stawkaTrasy` są opcjonalne. Są w body tylko przy odbiorze z trasy. Bez klucza `trasa` nowy wiersz nie wypełnia kolumn 11 i 12. Pusta `stawkaTrasy` zostaje pusta na nowym wierszu i nie czyści stawki na pozostałych wierszach tej nazwy. Kwota, także `0`, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 11.

Kolumny 13 i 14 (**Stawka za podjazd**, **Stawka za worek**) wypełnia makro ze snapshotu **Bazy stawek** (adres z kolumny 2 + **Kto odbiera** + **Data odbioru**). Remis albo brak pary → puste. Kolumna 10 = **transport się odbył**. Komentarze trafiają na kolumny 19–20.

Przed dopisaniem jakiegokolwiek wiersza protokołu, także bez trasy, makro wpisuje nagłówki 10–20, jeśli te komórki są puste. To tekst nagłówka, nie pusta komórka. Kolumn 1–9 nie rusza i nie przesuwa. W tym samym kroku, raz, zakłada na kolumnie 10 listę `tak` / `nie` (inne wartości też da się wpisać, także z Excela) i przekreślenie całego wiersza, gdy komórka ma `nie`. Przekreślenie jest regułą formatowania arkusza, nie klasą na stronie. Aplikacja rozliczeń tych nagłówków nie wpisuje. Brak kolumny / pusta wartość = transport się odbył.

Nowa kwota trasy, także zero, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 11. Pusta stawka z protokołu tego nie robi. Zapis nie patrzy na **Kto odbiera** ani na datę. Wiersz z **Rozliczony** `tak` jest pomijany. Kolumn 17 i 18 ten zapis nie rusza. Lock jest ten sam co przy numerze protokołu.

### Migracja układu V3 (transport się odbył po Ilość worków)

- **V1 → V3:** `migrateRegisterLayoutRates` — komentarze z 10–11 na 19–20, transport@10, trasa 11–12, snapshot 13–14, rozliczenie 15–18.
- **V2 → V3:** `migrateRegisterLayoutTransportOdbył` — przesuwa „transport się odbył” z kol. 18→10 (Arkusz1) i 17→9 (zestawienie); trasa i stawki o +1.

Idempotentne. Po sukcesie: **Wdróż → Nowa wersja** Web App.

Runbook: [MIGRATE_REGISTER_RATES.md](./MIGRATE_REGISTER_RATES.md).



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

2. **Popup pinezki** — po `bulkLastTransportDates` pokazuje **Ostatni transport** (data) oraz **Ostatni odbiór** (skrócona nazwa z kolumny F „Kto odbiera” z wiersza o najnowszej dacie). Wiersz z kolumną 10 = `nie` nie jest tym odbiorem. Pusta komórka, inna wartość i brak kolumny nadal są.

3. **Filtrowanie plomb** — z protokołu usuwane są worki ze datą zamknięcia **wcześniejszą** niż ostatni transport (kolumna E), z pominięciem wierszy, w których kolumna 10 ma `nie`. Taki wiersz nie ustawia daty odcięcia. Przy dacie transportu 20.06.2026 zostają plomby z 20.06, 25.06 itd., a znikają np. 10.06, 15.06. **Rodzaj zbiórki** (Word `{{rodzaj_zbiorki}}` i kolumna H arkusza) liczy się tylko z tych pozostawionych worków, nie z całej historii pinezki.

4. **Bez listy plomb** — checkbox w modalu Word. Zamiast numerów plomb w dokumencie trafia **10 wierszy kropek**; liczba kropek w wierszu = (maks. długość numeru plomby wśród worków w protokole) × 2. Rejestr transportu i `{{rodzaj_zbiorki}}` nadal bazują na rzeczywistych workach.

5. **Pobierz .docx** — zapis wiersza w arkuszu, potem pobranie Worda z numerem z serwera. Jeśli użytkownik **zmieni** numer w polu (względem podglądu), zapisany i w dokumencie będzie ten wpisany ręcznie; bez zmiany — atomowa numeracja po stronie serwera. Pola **Komentarz 1** / **Komentarz 2** w modalu trafiają tylko do arkusza (kolumny 19–20), nie do protokołu Word.



## Limity Apps Script



Darmowe konto Google — dzienne limity czasu wykonania i liczby wywołań. Przy typowej pracy kilku osób dziennie wystarcza. Szczegóły: [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).



## Numeracja (cache)



Numer kolejny trzymany jest w **Script Properties** (`transportMaxNum`) — podgląd i zapis POST nie skanują całej kolumny A.

Po ręcznej edycji numerów w arkuszu uruchom w edytorze Apps Script funkcję **`rebuildTransportCounterFromSheet`** (Run), potem **Deploy → Manage deployments → Edit → New version** jeśli zmieniłeś kod.


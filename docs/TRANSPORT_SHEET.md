# Arkusz transportów — integracja z mapą

Rejestr transportów (osobny arkusz Google Sheets) synchronizuje się z mapą HTML na GitHub Pages przez **Google Apps Script Web App**.

**Słowniki referencyjne** (Lista podwykonawców, Popraw adres) — ten sam arkusz i Web App: [REFERENCE_SHEET.md](./REFERENCE_SHEET.md).



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

  10. Trasa

  11. Stawka za trasę

  12. Stawka za podjazd

  13. Stawka za worek

  14. Rozliczony

  15. Numer faktury

  16. Koszt odbioru

  17. Koszt odbioru per worek

  18. transport się odbył

  19. Komentarz 1

  20. Komentarz 2



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

| GET | `action=modalData&podmiot=…&adres=…` | **Zalecane** — numer + ostatnia data + kto odbiera w jednym requestcie. Wiersz z kolumną 18 = `nie` nie wchodzi w datę |

| GET | `action=previewNumber` | Podgląd następnego numeru (cache Script Properties) |

| GET | `action=lastTransportDate&podmiot=…&adres=…` | Ostatnia data odbioru (kolumna E) + **Kto odbiera** (kolumna F) dla klucza **podmiot + adres**. Wiersz z kolumną 18 = `nie` nie wchodzi |

| GET | `action=bulkLastTransportDates` | Ostatnie daty + kto odbiera dla wszystkich sklepów (mapa / popup). Wiersz z kolumną 18 = `nie` nie wchodzi |

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

Klucze `trasa` i `stawkaTrasy` są opcjonalne. Są w body tylko przy odbiorze z trasy. Bez klucza `trasa` nowy wiersz nie wypełnia kolumn 10 i 11. Pusta `stawkaTrasy` zostaje pusta na nowym wierszu i nie czyści stawki na pozostałych wierszach tej nazwy. Kwota, także `0`, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 10.

Kolumny 12 i 13 (**Stawka za podjazd**, **Stawka za worek**) wypełnia makro ze snapshotu **Bazy stawek** (adres z kolumny 2 + **Kto odbiera** + **Data odbioru**). Remis albo brak pary → puste. Komentarze trafiają na kolumny 19–20.

Przed dopisaniem jakiegokolwiek wiersza protokołu, także bez trasy, makro wpisuje nagłówki 10–20, jeśli te komórki są puste. To tekst nagłówka, nie pusta komórka. Kolumn 1–9 nie rusza i nie przesuwa. W tym samym kroku, raz, zakłada na kolumnie 18 listę `tak` / `nie` (inne wartości też da się wpisać, także z Excela) i przekreślenie całego wiersza, gdy komórka ma `nie`. Przekreślenie jest regułą formatowania arkusza, nie klasą na stronie. Aplikacja rozliczeń tych nagłówków nie wpisuje. Dopóki po wdrożeniu nie zapisze się żadnego nowego protokołu, kolumny 18 nie ma. Brak kolumny znaczy to samo co pusta: transport się odbył.

Nowa kwota trasy, także zero, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 10. Pusta stawka z protokołu tego nie robi. Zapis nie patrzy na **Kto odbiera** ani na datę. Wiersz z **Rozliczony** `tak` jest pomijany. Kolumn 16 i 17 ten zapis nie rusza. Lock jest ten sam co przy numerze protokołu.

### Migracja układu V2

Jednorazowa funkcja `migrateRegisterLayoutRates_` w Apps Script (wywołanie ręczne po wdrożeniu skryptu): przenosi komentarze z 10–11 na 19–20, trasę na 10–11, dopisuje snapshot podjazdu/worka w 12–13, zostawia rozliczenie na 14–18. Idempotentna (V2 = nagłówek J = `Trasa` i L = `Stawka za podjazd`).

**Stan pośredni (bug):** gdy J/K nadal mają komentarze, a R/S też mają nagłówki „Komentarz” — to nadal V1. Migracja to naprawia. Do czasu migracji nowe protokoły są blokowane (błąd w logu).

Po sukcesie w dzienniku powinno być m.in. `"h10":"Trasa","h12":"Stawka za podjazd","h19":"Komentarz 1"`. Potem: **Wdróż → Nowa wersja** Web App.

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

2. **Popup pinezki** — po `bulkLastTransportDates` pokazuje **Ostatni transport** (data) oraz **Ostatni odbiór** (skrócona nazwa z kolumny F „Kto odbiera” z wiersza o najnowszej dacie). Wiersz z kolumną 18 = `nie` nie jest tym odbiorem. Pusta komórka, inna wartość i brak kolumny 18 nadal są.

3. **Filtrowanie plomb** — z protokołu usuwane są worki ze datą zamknięcia **wcześniejszą** niż ostatni transport (kolumna E), z pominięciem wierszy, w których kolumna 18 ma `nie`. Taki wiersz nie ustawia daty odcięcia. Przy dacie transportu 20.06.2026 zostają plomby z 20.06, 25.06 itd., a znikają np. 10.06, 15.06. **Rodzaj zbiórki** (Word `{{rodzaj_zbiorki}}` i kolumna H arkusza) liczy się tylko z tych pozostawionych worków, nie z całej historii pinezki.

4. **Bez listy plomb** — checkbox w modalu Word. Zamiast numerów plomb w dokumencie trafia **10 wierszy kropek**; liczba kropek w wierszu = (maks. długość numeru plomby wśród worków w protokole) × 2. Rejestr transportu i `{{rodzaj_zbiorki}}` nadal bazują na rzeczywistych workach.

5. **Pobierz .docx** — zapis wiersza w arkuszu, potem pobranie Worda z numerem z serwera. Jeśli użytkownik **zmieni** numer w polu (względem podglądu), zapisany i w dokumencie będzie ten wpisany ręcznie; bez zmiany — atomowa numeracja po stronie serwera. Pola **Komentarz 1** / **Komentarz 2** w modalu trafiają tylko do arkusza (kolumny J/K), nie do protokołu Word.



## Limity Apps Script



Darmowe konto Google — dzienne limity czasu wykonania i liczby wywołań. Przy typowej pracy kilku osób dziennie wystarcza. Szczegóły: [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).



## Numeracja (cache)



Numer kolejny trzymany jest w **Script Properties** (`transportMaxNum`) — podgląd i zapis POST nie skanują całej kolumny A.

Po ręcznej edycji numerów w arkuszu uruchom w edytorze Apps Script funkcję **`rebuildTransportCounterFromSheet`** (Run), potem **Deploy → Manage deployments → Edit → New version** jeśli zmieniłeś kod.


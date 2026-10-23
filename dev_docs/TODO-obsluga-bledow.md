# TODO: obsługa błędów na mapie

Zrobione: błąd awizacji Bolęcin zostaje u góry do kliknięcia **Zamknij**. Brak `BOLECIN_SHEETS_ID` jest po polsku, nie jako surowy wyjątek. Na karcie są też: zapis rejestru (`MAP-E-REGISTER-SAVE`), brak numeru (`MAP-E-NO-NUMBER`), biblioteki Word (`MAP-E-WORD-LIBS`), zbiorcze protokoły z adresem i etapem (`MAP-E-BULK-GENERATE`, wcześniej sam licznik `MAP-E-BULK-PARTIAL`), składanie jednego protokołu (`MAP-E-DOC-RENDER`), ostatnie daty transportu (`MAP-E-TRANSPORT-DATES`), podgląd numeru (`MAP-E-DOC-NUMBER`, `MAP-E-BULK-DOC-NUMBER`), nazwa i stawka trasy (`MAP-E-ROUTE-NAME`, `MAP-E-ROUTE-NAME-FRESH`, `MAP-E-ROUTE-RATE`), brak wolnego numeru (`MAP-E-ROUTE-FULL`), słowniki i zapis admina (`MAP-E-ADMIN-DICTS`, `MAP-E-ADMIN-SAVE`), granice województw (`MAP-E-VOIVODESHIP`), zły base64 szablonu (`MAP-E-TEMPLATE-BYTES`), kody harmonogramu (`MAP-E-HARMONOGRAM`), odświeżenie po zapisie (`MAP-E-HARM-RELOAD`), odpowiedź inna niż JSON (`MAP-E-NOT-JSON`), stawki zbiorcze (`MAP-E-BULK-RATES`, `MAP-E-BULK-RATES-PARTIAL`) i różne hasło Pages/Worker (`MAP-E-AUTH-MISMATCH`). Przy `npm run generate` ten sam blok `ARKUSZ-MAPA-ERROR` idzie w log: pusty szablon Word (`MAP-E-WORD-TEMPLATE`), pominięty arkusz referencji (`MAP-E-REFERENCE-SKIP`), Nominatim bez odpowiedzi (`MAP-E-GEOCODE-NET`) i GeoJSON województw (`MAP-E-VOIVODESHIP-BUILD`).

## Szablon karty

Funkcja `showMapErrorCard` jest w wygenerowanej mapie (`src/map/browser/errorsApi.ts`). Kody z listy są podpięte. Przy generowaniu mapy ten sam blok idzie w log (`mapErrorReport.ts`), bo karty wtedy nie ma.

Karta stoi u góry, na środku. Nie zasłania mapy: pinezki, filtry i formularze dalej działają. Znika po **Zamknij**, nie chowa się sama.

Na karcie widać, co się nie udało, jaki jest skutek i zdanie „Możesz dalej pracować na mapie.” Pod spodem jest raport. **Kopiuj raport** wkłada do schowka blok do wklejenia w czacie:

```
ARKUSZ-MAPA-ERROR
kod: MAP-E-TRANSPORT-DATES
miejsce: map/browser/errorsApi.ts loadBulkTransportDates
objaw: Nie udało się pobrać ostatnich dat transportu.
skutek: Pinezki są bez ostatniego odbioru. Filtr worków nie odcina starych dat.
technicznie: Failed to fetch
```

`kod` i `miejsce` wskazują funkcję. `technicznie` to surowy komunikat. Po wklejeniu tego bloku da się błąd namierzyć bez szukania w konsoli.

```javascript
showMapErrorCard({
  code: 'MAP-E-TRANSPORT-DATES',
  summary: 'Nie udało się pobrać ostatnich dat transportu.',
  effect: 'Pinezki są bez ostatniego odbioru. Filtr worków nie odcina starych dat.',
  place: 'map/browser/errorsApi.ts loadBulkTransportDates',
  technical: String(err && err.message || err)
});
```

Walidacja formularza też idzie na kartę (`showMapFormError_` w `map/browser/errorsApi.ts`, `reportManualAdminForm_` w panelu admina, `MAP-E-HARM-FORM` w harmonogramie). `alert` zostaje tylko jako zapas, gdy na stronie nie ma miejsca na karty. Kody z listy są podpięte: na mapie karta, przy `npm run generate` ten sam blok w logu.

| Kod | Kiedy |
| --- | --- |
| `MAP-E-REGISTER-SAVE` | Zapis rejestru transportu. Przy ręcznym numerze objaw mówi „Dokument pobrany” tylko wtedy, gdy Word naprawdę się pobrał |
| `MAP-E-NO-NUMBER` | Brak numeru zlecenia |
| `MAP-E-WORD-LIBS` | Biblioteki Word nie załadowały się (tylko błąd ładowania skryptów; kolejna próba ładuje je od nowa) |
| `MAP-E-HARMONOGRAM` | Kody harmonogramu i surowy wyjątek zamiast tekstu |
| `MAP-E-NOT-JSON` | Odpowiedź, która nie jest JSON |
| `MAP-E-ADMIN-SAVE` | Zapis admina nie wszedł (`ok: false` albo błąd sieci) |
| `MAP-E-ADMIN-AFTER-SAVE` | Zapis admina wszedł, ale odświeżenie formularza rzuciło wyjątek — nie powtarzać zapisu |
| `MAP-E-ADMIN-FORM` | Walidacja formularza admina (puste pola, złe współrzędne) |
| `MAP-E-TRANSPORT-DATES` | Ostatnie daty transportu na starcie |
| `MAP-E-DOC-NUMBER` | Podgląd numeru w jednym protokole |
| `MAP-E-BULK-DOC-NUMBER` | Podgląd numeru w zbiorczym |
| `MAP-E-ROUTE-NAME` | Propozycja nazwy trasy |
| `MAP-E-ROUTE-NAME-FRESH` | Nowa nazwa przy konflikcie stawki |
| `MAP-E-ROUTE-RATE` | Stawka istniejącej trasy |
| `MAP-E-ADMIN-DICTS` | Słowniki admina |
| `MAP-E-VOIVODESHIP` | Granice województw |
| `MAP-E-BULK-GENERATE` | Zbiorcze protokoły: powód i adres |
| `MAP-E-BULK-RATES` | Błąd stawek zbiorczych |
| `MAP-E-WORD-TEMPLATE` | Pusty szablon Word, log przy `npm run generate` |
| `MAP-E-REFERENCE-SKIP` | Pominięty arkusz referencji przy generowaniu mapy |
| `MAP-E-DOC-RENDER` | Jeden protokół: wyjątek przy składaniu Word |
| `MAP-E-TEMPLATE-BYTES` | Zły base64 szablonu przy otwarciu modalu |
| `MAP-E-ROUTE-FULL` | Brak wolnego numeru trasy 01–99 |
| `MAP-E-BULK-RATES-PARTIAL` | Zbiorcze stawki: wcześniejsze sklepy już zapisane |
| `MAP-E-HARM-RELOAD` | Po zapisie harmonogramu „Zapisano” chowa błąd odświeżenia |
| `MAP-E-AUTH-MISMATCH` | Hasło Pages i Worker się różnią (503) |
| `MAP-E-GEOCODE-NET` | Nominatim przy generowaniu wrzuca adres do błędnych |
| `MAP-E-GEOCODE-BLOCKED` | Nominatim odrzucił kilka zapytań z rzędu (403/429/5xx) — geokodowanie przerwane do końca przebiegu |
| `MAP-E-VOIVODESHIP-BUILD` | GeoJSON przy generowaniu: puste województwo z lat/lng |
| `MAP-E-SHEETS-WRITE` | Krok zapisu do arkuszy przy generowaniu (odebrane, Baza cen, zestawienie, stawki raportu, zakładki fazy 4) — mapa powstaje, CLI kończy kodem 2, workflow publikuje i na końcu oznacza job jako czerwony |
| `MAP-E-DOC-GENERATE` | Nieoczekiwany wyjątek po rozstrzygnięciu nazwy/stawki trasy (jeden i zbiorczy protokół), także w podsumowaniu zbiorczym i po udanym zapisie rejestru |
| `MAP-E-DOC-FORM` | Protokół: brak przewoźnika albo miejsca dostawy z listy |
| `MAP-E-DOC-DATE` | Protokół: brak albo nieistniejąca data załadunku |
| `MAP-E-DOC-POINT` | Protokół: punkt zniknął z mapy (`__currentDocPointIdx` poza listą) |
| `MAP-E-DOC-WAIT` | „Generuj” kliknięte, zanim modal pobrał numer i filtr worków |
| `MAP-E-TRANSPORT-WAIT` | Otwarcie protokołu (jednego lub zbiorczego), zanim mapa pobrała dane transportu |
| `MAP-E-BULK-SELECT` | Zbiorczy protokół albo stawki bez zaznaczonych pinezek |
| `MAP-E-BULK-EMPTY` | Zbiorczy protokół: modal bez listy punktów |
| `MAP-E-BULK-OFFLINE` | Zbiorczy protokół bez `TRANSPORT_WEBAPP_URL` |
| `MAP-E-RATES-OFFLINE` | Stawki zbiorcze bez `TRANSPORT_WEBAPP_URL` |
| `MAP-E-RATES-NO-ADDRESS` | Stawki zbiorcze: zaznaczone pinezki bez adresu sklepu |
| `MAP-E-BULK-RATES-FORM` | Walidacja formularza stawek zbiorczych (brak sklepów, połączenia, podwykonawcy, kwot) |
| `MAP-E-HARM-FORM` | Walidacja grupowania harmonogramu (`zaznacz`, `rozne`, `brak_dni`) |
| `MAP-E-BOLECIN` | Awizacja do Bolęcina nie weszła (protokół mógł się zapisać) |
| `MAP-E-MARKER-REFRESH` | Daty transportu pobrane, ale odświeżenie pinezek rzuciło wyjątek |
| `MAP-E-UNKNOWN` | Zapas w raporcie, gdy wywołanie nie podało kodu — nie powinien się pojawiać |

## Zaplanowane wcześniej

- [x] **Pozostałe błędy protokołu** — ten sam pasek do zamknięcia, nie toast na dole na 6 s. Zapis rejestru, brak numeru, biblioteki Word, częściowo nieudane zbiorcze (`map/browser/docGenerate.ts`, `showMapErrorCard`). Składanie jednego protokołu: `finishWithNumber` łapie wyjątek z `renderDocxAndDownload` i zostawia kartę `MAP-E-DOC-RENDER`. W zbiorczym ten sam wyjątek wpada w licznik i jest w `MAP-E-BULK-GENERATE`.
- [x] **Jeden słownik tekstów** — `BOLECIN_SHEETS_ID` i kody harmonogramu (`zaznacz`, `brak_dat`, `nie_bolecin`). `harmonogramErrorText` zwraca polski tekst. Surowy wyjątek i kody inne niż walidacja (`zaznacz`, `rozne`, `brak_dni`) idą na kartę `MAP-E-HARMONOGRAM`.
- [x] **Odpowiedź, która nie jest JSON** — `readMapJson_` w `fetchTransportGet`, `appendTransportRow`, `harmonogramGet` / `harmonogramPost`, `postReferencePayload` i słownikach admina. HTML albo limit dostaje `MAP-E-NOT-JSON` (objaw zostaje ten z miejsca wywołania). 401 zostaje na overlayu.
- [x] **Admin ręczny** — zapis listy, poprawki i stawek woła `MAP-E-ADMIN-SAVE`. W `technicznie` jest `resp.error` albo komunikat sieci. Walidacja pustych pól idzie na status formularza i kartę `MAP-E-ADMIN-FORM`. Wyjątek przy czyszczeniu formularza po udanym zapisie to `MAP-E-ADMIN-AFTER-SAVE`, nie „zapis nieudany”.

Dwa przypadki, które nie są walidacją pól:

- [x] **Brak wolnego numeru trasy** — `resolveRouteFieldsBeforeSave` w `map/browser/routeForm.ts` (`MAP-E-ROUTE-FULL`). Zapis przerwany, stawka poprzedniej trasy zostaje. Osobno od `MAP-E-ROUTE-NAME-FRESH`.
- [x] **Hasło Pages i Worker** — `maybeMismatchAlert` w `sitePasswordFetchSnippet.ts` (`MAP-E-AUTH-MISMATCH`). Status 503 i `proxy_auth_mismatch`. 401 zostaje na overlayu „Zaloguj ponownie”.

## Brak komunikatu dla użytkownika

Błąd jest połknięty albo widać go tylko w konsoli. Mapa idzie dalej jakby nic.

- [x] **Ostatnie daty transportu na starcie** — `loadBulkTransportDates` w `map/browser/errorsApi.ts` (`MAP-E-TRANSPORT-DATES`). `catch` i odpowiedź `ok: false` zostawiają kartę. `__transportDatesLoaded` i tak schodzi na `true`, pinezki idą dalej bez ostatniego odbioru. Po pierwszym odczycie mapa bierze Script Properties, nie skan rejestru. HTML 5xx ma jedną powtórkę.
- [x] **Podgląd numeru w jednym protokole** — `loadDocModalData` (`MAP-E-DOC-NUMBER`). Sieć i `ok: false` zostawiają kartę. Nad przyciskiem zostaje liczba worków, nie zdanie o błędzie. Przycisk i tak się odblokowuje. Ostatni odbiór idzie z tego samego cache co start mapy. HTML 5xx ma jedną powtórkę.
- [x] **Podgląd numeru w zbiorczym** — `loadBulkDocModalData` (`MAP-E-BULK-DOC-NUMBER`). `catch` i `ok: false` wołają kartę, potem `finishBulkLoading('')`. Modal idzie dalej. Sam podgląd czyta `transportMaxNum` i nie otwiera arkusza — skan kolumny A kończył się HTML-em Cloudflare 524 (`MAP-E-NOT-JSON`). Zapis dalej sprawdza wiersz. HTML 5xx ma jedną powtórkę.
- [x] **Propozycja nazwy trasy** — `refreshRouteNameField` (`MAP-E-ROUTE-NAME`). Błąd sieci, brak tablicy `names` oraz wyjątek w `namesBlockingNewRoute` / `proposeRouteName` zostawiają kartę i nie liczą nazwy z pustej listy. Lista nazw po pierwszym odczycie siedzi w Script Properties. HTML 5xx ma jedną powtórkę.
- [x] **Nowa nazwa przy konflikcie stawki** — `proposeFreshRouteName` (`MAP-E-ROUTE-NAME-FRESH`). Błąd sieci albo brak `names` przerywa zapis kartą i zwraca `null`. Wyjątek przy liczeniu nazwy ma tę samą kartę z objawem „Nie udało się wyliczyć nazwy nowej trasy.”. Pusta propozycja przy pełnych numerach 01–99 to osobna karta `MAP-E-ROUTE-FULL`.
- [x] **Stawka istniejącej trasy** — `lookupRouteRateNow` (`MAP-E-ROUTE-RATE`). `catch` i `ok: false` zostawiają kartę, gdy ticket jest aktualny. Pusta stawka przy `ok: true` to trasa bez zapisu, nie błąd. Strona HTML 5xx (`DEADLINE_EXCEEDED`, karta `MAP-E-NOT-JSON`) ma jedną powtórkę po 1,5 s. `routeRateByName_` szuka tylko w kolumnie Trasa i czyta wiersze trafień jednym `getValues`. Znana stawka zostaje w Script Properties, żeby kolejny odczyt nie skanował zakładek.
- [x] **Słowniki admina** — `loadReferenceDataFromWebApp` w `buildMapManualAdmin.ts` (`MAP-E-ADMIN-DICTS`). `catch` i `ok: false` zostawiają kartę. Lista podwykonawców zostaje ta z HTML.
- [x] **Granice województw** — `fetch` GeoJSON w `map/browser/bootstrap.ts` (`MAP-E-VOIVODESHIP`). Status inny niż 2xx i `catch` zostawiają kartę obok `console.warn`. Mapa działa, filtr województwa nie ma granic.
- [x] **Zły plik szablonu przy otwarciu modalu** — `prewarmDocxTemplateCache` w `map/browser/docxRender.ts` (`MAP-E-TEMPLATE-BYTES`). Zły base64 w `getWordTemplateBytes` zostawia kartę. Osobno od `MAP-E-WORD-TEMPLATE` (brak `{{ }}` przy `npm run generate`).

`refreshClusterIcons` przy wyjątku loguje do konsoli i zostawia stare ikony klastrów. To rysunek, nie zapis.

## Trudne do zobaczenia

Komunikat jest, ale mały, poza ekranem albo znika, zanim da się go przeczytać. Powód często zostaje tylko w konsoli.

- [x] **Zbiorcze protokoły gubią powód i adres** — `runBulkDocGenerate` w `map/browser/docGenerate.ts` (`MAP-E-BULK-GENERATE`). Karta ma adres, etap (`rejestr nie zapisany` albo `Word nie powstał, wiersz rejestru mógł już wejść`) i surowy powód.
- [x] **Błąd stawek zbiorczych kasuje się przy edycji** — `validateBulkRatesFields` czyści tylko status `validation`. Błąd zapisu (`data-status-source="save"`) zostaje po kolejnym znaku w kwocie. Sieć i `ok: false` idą na kartę `MAP-E-BULK-RATES`.
- [x] **Zbiorcze stawki: część sklepów już w arkuszu** — `runBulkRatesSave` (`MAP-E-BULK-RATES-PARTIAL`). Skutek mówi, ile sklepów już weszło i przy którym adresie przerwano. `catch` bierze `err`. Nieznany `resp.error` jest w zdaniu i w `technicznie`.
- [x] **Podpowiedź 12 px zamiast błędu** — błąd pobrania danych transportu nie wpisuje się w `doc-filter-info`. Zostaje karta `MAP-E-DOC-NUMBER`. Podpowiedź nad przyciskiem to znowu liczba worków.
- [x] **Harmonogram: błąd nad scrollem** — błąd pobrania, grupowania, odłączenia, zapisu i awizacji idzie na kartę `MAP-E-HARMONOGRAM`. `catch` bierze obiekt błędu. Walidacja zaznaczenia idzie na status panelu i kartę `MAP-E-HARM-FORM`.
- [x] **Po zapisie harmonogramu sukces chowa błąd listy** — `groupHarmonogram` i `saveHarmonogram` (`MAP-E-HARM-RELOAD`). `harmonogramLoad` zwraca, czy lista doszła. Przy błędzie nie ma „Zapisano”.
- [x] **Admin: jedna linia na dole formularza** — nieudany zapis idzie na kartę `MAP-E-ADMIN-SAVE` u góry mapy. Krótki status w panelu zostaje. Otwarcie panelu dalej czyści ten status, karta nie.
- [x] **Pusty szablon Word** — `warnIfWordTemplateMissingPlaceholders` w `wordMapSupport.ts` (`MAP-E-WORD-TEMPLATE`). Przy `npm run generate` brak `{{ }}` w `word/document.xml` wypisuje blok `ARKUSZ-MAPA-ERROR` przez `console.error`. Protokół dalej się buduje, pola zostaną puste.
- [x] **Popraw adres przy generowaniu mapy** — `runPhase7Pipeline` w `phase7.ts` (`MAP-E-REFERENCE-SKIP`). Błąd arkusza referencji zostawia blok w `logger.error`. Mapa powstaje bez poprawek adresów.
- [x] **Składanie jednego Worda znika po 6 s** — `finishWithNumber` w `map/browser/docGenerate.ts` (`MAP-E-DOC-RENDER`). Wyjątek z `renderDocxAndDownload` (zły tag, puste pole szablonu) zostaje na karcie do **Zamknij**. Surowy komunikat jest w polu `technicznie`.
- [x] **Nominatim przy generowaniu myli sieć z błędnym adresem** — `executePhase5` w `phase5.ts` (`MAP-E-GEOCODE-NET`). Brak odpowiedzi, `!response.ok` (w `technicznie` jest status) albo treść inna niż lista JSON w którymkolwiek wariancie zapytania nie wrzuca adresu do błędnych i nie zapisuje `status: bad` w cache. Błędnym adresem zostaje tylko pusta odpowiedź, gdy wszystkie warianty dostały HTTP 200. Przy 403/429/5xx odstęp rośnie wykładniczo (z `Retry-After`, maks. 60 s); po 5 odmowach z rzędu `MAP-E-GEOCODE-BLOCKED` i koniec geokodowania w tym przebiegu. W logu jest blok `ARKUSZ-MAPA-ERROR`.
- [x] **Województwo z GeoJSON przy generowaniu** — `loadWojewodztwaFeaturesForPhase5` w `phase5.ts` (`MAP-E-VOIVODESHIP-BUILD`). Pusty albo nieudany GeoJSON wypisuje blok `ARKUSZ-MAPA-ERROR`. Uzupełnianie z lat/lng odpada. Osobno od `MAP-E-VOIVODESHIP` (filtr na otwartej mapie, karta).

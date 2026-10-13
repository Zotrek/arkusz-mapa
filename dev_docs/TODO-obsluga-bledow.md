# TODO: obsługa błędów na mapie

Zrobione: błąd awizacji Bolęcin zostaje u góry do kliknięcia **Zamknij**. Brak `BOLECIN_SHEETS_ID` jest po polsku, nie jako surowy wyjątek. Na karcie są też: zapis rejestru (`MAP-E-REGISTER-SAVE`), brak numeru (`MAP-E-NO-NUMBER`), biblioteki Word (`MAP-E-WORD-LIBS`), częściowo nieudane zbiorcze (`MAP-E-BULK-PARTIAL`) i składanie jednego protokołu (`MAP-E-DOC-RENDER`).

## Szablon karty

Funkcja `showMapErrorCard` jest w wygenerowanej mapie (`phase6.ts`). Kody z listy, których nie ma w „Zrobione”, jeszcze nie są podpięte.

Karta stoi u góry, na środku. Nie zasłania mapy: pinezki, filtry i formularze dalej działają. Znika po **Zamknij**, nie chowa się sama.

Na karcie widać, co się nie udało, jaki jest skutek i zdanie „Możesz dalej pracować na mapie.” Pod spodem jest raport. **Kopiuj raport** wkłada do schowka blok do wklejenia w czacie:

```
ARKUSZ-MAPA-ERROR
kod: MAP-E-TRANSPORT-DATES
miejsce: phase6.ts loadBulkTransportDates
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
  place: 'phase6.ts loadBulkTransportDates',
  technical: String(err && err.message || err)
});
```

Walidacja formularza zostaje na `alert`. Kody z listy, których nie ma w „Zrobione”, są umową na podpięcie. Punkty „trudne do zobaczenia” użyją tej samej karty.

| Kod | Kiedy |
| --- | --- |
| `MAP-E-REGISTER-SAVE` | Zapis rejestru transportu |
| `MAP-E-NO-NUMBER` | Brak numeru zlecenia |
| `MAP-E-WORD-LIBS` | Biblioteki Word |
| `MAP-E-BULK-PARTIAL` | Częściowo nieudane zbiorcze |
| `MAP-E-HARMONOGRAM` | Kody harmonogramu i surowy wyjątek zamiast tekstu |
| `MAP-E-NOT-JSON` | Odpowiedź, która nie jest JSON |
| `MAP-E-ADMIN-SAVE` | Zapis admina bez treści `resp.error` |
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
| `MAP-E-VOIVODESHIP-BUILD` | GeoJSON przy generowaniu: puste województwo z lat/lng |

## Zaplanowane wcześniej

- [x] **Pozostałe błędy protokołu** — ten sam pasek do zamknięcia, nie toast na dole na 6 s. Zapis rejestru, brak numeru, biblioteki Word, częściowo nieudane zbiorcze (`phase6.ts`, `showMapErrorCard`). Składanie jednego protokołu: `finishWithNumber` łapie wyjątek z `renderDocxAndDownload` i zostawia kartę `MAP-E-DOC-RENDER`. W zbiorczym ten sam wyjątek wpada w licznik i jest w `MAP-E-BULK-GENERATE`.
- [ ] **Jeden słownik tekstów** — `BOLECIN_SHEETS_ID` i kody harmonogramu (`zaznacz`, `brak_dat`, `nie_bolecin`). Panel harmonogramu trzyma status, ale przy braku właściwości wkleja surowy wyjątek (`buildMapHarmonogram.ts`, `harmonogramErrorText`).
- [ ] **Odpowiedź, która nie jest JSON** — `fetchTransportGet`, `appendTransportRow`, `harmonogramGet` / `harmonogramPost`, `postReferencePayload` robią `res.json()` bez sprawdzenia statusu. Strona logowania Google albo limit kończy się ogólnym „nie udało się”.
- [ ] **Admin ręczny** — „Zapis nieudany.” / „Zapis poprawki nieudany.” bez treści `resp.error` (`buildMapManualAdmin.ts`).

Walidacja formularza zostaje na `alert`. Dwa przypadki też są na `alert`, ale to nie walidacja pól — mają iść na kartę:

- [ ] **Brak wolnego numeru trasy** — `resolveRouteFieldsBeforeSave` w `phase6.ts` (`MAP-E-ROUTE-FULL`). „Brak wolnego numeru trasy (01–99). Zapis przerwany…”. Nie ma raportu. Osobno od `MAP-E-ROUTE-NAME-FRESH`, gdzie błąd sieci udaje pustą listę i może wziąć zajęty numer.
- [ ] **Hasło Pages i Worker** — `maybeMismatchAlert` w `sitePasswordFetchSnippet.ts` (`MAP-E-AUTH-MISMATCH`). Status 503 i `proxy_auth_mismatch`. 401 zostaje na overlayu „Zaloguj ponownie” — to blok sesji, nie karta mapy.

## Brak komunikatu dla użytkownika

Błąd jest połknięty albo widać go tylko w konsoli. Mapa idzie dalej jakby nic.

- [ ] **Ostatnie daty transportu na starcie** — `loadBulkTransportDates` w `phase6.ts`. `catch` tylko `console.error`, potem `__transportDatesLoaded = true`. To samo, gdy odpowiedź ma `ok: false`. Pinezki bez ostatniego odbioru, filtr worków bez odcięcia, zero komunikatu.
- [ ] **Podgląd numeru w jednym protokole** — `loadDocModalData`. Sieć ma tekst w filtrze modalu. Odpowiedź `ok: false` nie: numer zostaje pusty i przycisk się odblokowuje.
- [ ] **Podgląd numeru w zbiorczym** — `loadBulkDocModalData`. `catch` woła `finishBulkLoading('')`. Modal idzie dalej bez informacji, że podgląd numeru padł.
- [ ] **Propozycja nazwy trasy** — `refreshRouteNameField`. `catch` zwraca `[]` i liczy nazwę tak, jakby żadna trasa nie była zajęta. To samo, gdy odpowiedź nie ma tablicy `names` (`ok: false`). Wyjątek w `namesBlockingNewRoute` / `proposeRouteName` (`catch (eOcc)`, `catch (eProp)`) też daje pustą propozycję, bez komunikatu. Może zaproponować numer, który już jest.
- [ ] **Nowa nazwa przy konflikcie stawki** — `proposeFreshRouteName`. Ten sam wzorzec: błąd sieci albo brak `names` → pusta lista zajętych → następny numer z pustej listy.
- [ ] **Stawka istniejącej trasy** — `lookupRouteRateNow`. `catch` jest pusty, loader znika, pole stawki zostaje puste. Odpowiedź `ok: false` robi to samo: stawki z odpowiedzi nie ma i nikt tego nie mówi.
- [ ] **Słowniki admina** — `loadReferenceDataFromWebApp` w `buildMapManualAdmin.ts`. Pusty `catch`. Gdy `ok` jest false, `then` też nic nie mówi. Lista podwykonawców zostaje ta z HTML.
- [ ] **Granice województw** — `fetch` GeoJSON w `phase6.ts`. Tylko `console.warn`. Mapa działa, filtr województwa nie ma granic do trafienia.
- [ ] **Zły plik szablonu przy otwarciu modalu** — `prewarmDocxTemplateCache` w `phase6.ts` (`MAP-E-TEMPLATE-BYTES`). `getWordTemplateBytes` przy złym base64 robi tylko `console.warn`. Osobno od `MAP-E-WORD-TEMPLATE` (brak `{{ }}` przy `npm run generate`).

`refreshClusterIcons` przy wyjątku loguje do konsoli i zostawia stare ikony klastrów. To rysunek, nie zapis.

## Trudne do zobaczenia

Komunikat jest, ale mały, poza ekranem albo znika, zanim da się go przeczytać. Powód często zostaje tylko w konsoli.

- [ ] **Zbiorcze protokoły gubią powód i adres** — `runBulkDocGenerate` w `phase6.ts`. `catch` robi `console.error` i licznik. Na ekranie zostaje „Nie udało się: N”, toast 6 s na dole (do zamknięcia tylko wtedy, gdy był też błąd Bolęcina). Wiersz rejestru mógł już wejść, a Word paść — tego rozróżnienia nie widać.
- [ ] **Błąd stawek zbiorczych kasuje się przy edycji** — `validateBulkRatesFields` czyści czerwony `bulk-rates-status`, gdy pola są poprawne. „Błąd sieci przy sklepie 3/10” znika po kolejnym znaku w kwocie.
- [ ] **Zbiorcze stawki: część sklepów już w arkuszu** — `runBulkRatesSave` w `phase6.ts` (`MAP-E-BULK-RATES-PARTIAL`). Przy błędzie sklepu 3/10 sklepy 1–2 są zapisane, a status mówi tylko o miejscu przerwania. `catch` nie bierze `err`. Nieznany `resp.error` spada do „Zapis nieudany.” (`saveRateErrorMessage`).
- [ ] **Podpowiedź 12 px zamiast błędu** — `doc-filter-info` i `bulk-rates-status` mają styl podpowiedzi (12 px, szary). Zdanie „Nie udało się pobrać danych transportu…” stoi nad przyciskiem „Pobierz .docx”, a przycisk i tak się włącza.
- [ ] **Harmonogram: błąd nad scrollem** — `#harmonogram-group-status` to 12 px pod tytułem. Przycisk awizacji jest na karcie niżej. Po błędzie tekst jest powyżej widoku. „Odśwież” woła `harmonogramLoad`, które na starcie czyści status. `catch` przy pobraniu, grupowaniu, odłączeniu, zapisie i awizacji nie bierze obiektu błędu — zostaje stałe zdanie, bez szczegółu.
- [ ] **Po zapisie harmonogramu sukces chowa błąd listy** — `groupHarmonogram` i `saveHarmonogram` w `buildMapHarmonogram.ts` (`MAP-E-HARM-RELOAD`). Zapis się udaje, potem `harmonogramLoad()`. Ta funkcja przy błędzie sieci ustawia status i i tak się rozwiązuje, a zewnętrzne `.then` wpisuje „Zapisano…”. Lista może być nieodświeżona, a na ekranie jest sukces.
- [ ] **Admin: jedna linia na dole formularza** — `#manual-admin-status`, 12 px, za polami. Długi panel trzeba zjechać w dół. Otwarcie panelu czyści status (`openManualAdminModal`).
- [ ] **Pusty szablon Word** — `warnIfWordTemplateMissingPlaceholders` w `wordMapSupport.ts` pisze tylko `console.warn` przy `npm run generate`. Na mapie protokół się pobiera, pola `{{ }}` zostają puste.
- [ ] **Popraw adres przy generowaniu mapy** — `phase7.ts` łapie błąd arkusza referencji i loguje „Reference sheet skipped”. Mapa powstaje bez poprawek adresów. W logu CI łatwo to przegapić.
- [x] **Składanie jednego Worda znika po 6 s** — `finishWithNumber` w `phase6.ts` (`MAP-E-DOC-RENDER`). Wyjątek z `renderDocxAndDownload` (zły tag, puste pole szablonu) zostaje na karcie do **Zamknij**. Surowy komunikat jest w polu `technicznie`.
- [ ] **Nominatim przy generowaniu myli sieć z błędnym adresem** — `executePhase5` w `phase5.ts` (`MAP-E-GEOCODE-NET`). Brak odpowiedzi albo `!response.ok` (ten drugi bez logu statusu) kończy adres w błędnych. Mapa powstaje, pinezka jest w złym kubełku. W logu jest `warn` albo cisza.
- [ ] **Województwo z GeoJSON przy generowaniu** — `loadWojewodztwaFeaturesForPhase5` w `phase5.ts` (`MAP-E-VOIVODESHIP-BUILD`). Pusty albo nieudany GeoJSON to `logger.warn`, uzupełnianie z lat/lng odpada. Osobno od `MAP-E-VOIVODESHIP` (filtr na otwartej mapie, `console.warn`).

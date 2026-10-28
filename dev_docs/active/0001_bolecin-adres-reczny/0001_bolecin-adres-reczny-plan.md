# Plan: ręczny adres i nazwa w awizacji do Bolęcina

> **Task:** 0001_bolecin-adres-reczny  
> **Status:** zaplanowane  
> **Accepted:** 2026-10-28

Założenie jest w [`docs/TRANSPORT_SHEET.md`](../../../docs/TRANSPORT_SHEET.md), sekcja „Założenie (2026-10-28)”. Ten plan mówi, jak dojść do niego testami, zanim ruszy kod.

## Cel

W oknie **Awizacja do Bolęcina** dwa puste pola na dole: adres odbioru i nazwa kontrahenta. Ich treść (albo pustość) wchodzi tylko do kolumn arkusza Bolęcin **Adres odbioru** i **Nazwa kontrahenta / podmiot handlowy**. Word, rejestr transportu i pozostałe arkusze biorą adres i nazwę z punktu.

## Zakres

- Okno po wyborze Bolęcina / Biosystem jako miejsca dostawy: jeden protokół i zbiorcza awizacja.
- Zapis protokołu z `awizujBolecin: true` (`protocolBolecinFields_` w `transport-log.gs`).
- Awizacja z karty harmonogramu (`mode=awizujBolecin`) zostaje przy adresach i nazwach z członków grupy.

## Zachowanie po wdrożeniu

| Miejsce | Adres i nazwa kontrahenta |
|---------|---------------------------|
| Pola okna | Puste przy otwarciu. Podpis w liczbie pojedynczej albo mnogiej, zależnie od jednego protokołu albo zbiorczej. |
| Arkusz Bolęcin, te dwie kolumny | Wyłącznie `bolecinAdres` i `bolecinNazwa`. Puste albo brak klucza w body zostawia pustą komórkę. |
| Rejestr (`adresSklepu`, `podmiotHandlowy`) i Word | Z punktu, jak dziś. |
| Worki, rodzaj zbiórki, data, kto, miejsce, okno, nr, rodzaj transportu | Jak dziś. W zbiorczej jeden wiersz i suma worków. |

Klucz wiersza zostaje trójką adres + data + kto. Dwa wpisy z pustym adresem, tą samą datą i tym samym przewoźnikiem nadpisują jeden wiersz.

## Dlaczego serwer, nie samo okno

Dziś `protocolBolecinFields_` przy pustym `bolecinAdres` / `bolecinNazwa` podstawia `adresSklepu` i `podmiotHandlowy`. Samo puste pole w oknie nic by nie zmieniło. Pojedynczy protokół w ogóle nie wysyła tych dwóch kluczy, więc kolumny i tak wypełnia sklep. Po zmianie oba klucze idą z pól, także jako pusty string, a serwer ich nie uzupełnia.

## TDD

Najpierw czerwone testy, potem najmniejsza zmiana, która je zazieleni. Istniejące asercje, które wymagają podstawienia adresu sklepu, przestawiamy w tym samym kroku co nowe testy — inaczej zielony suite utrwala stare zachowanie.

### 1. Serwer (`src/harmonogramGroup.gas.test.ts`)

Funkcja: `protocolBolecinFields_`.

- `test_protocolBolecinFields_when_manual_address_absent_should_leave_adres_and_nazwa_empty` — jest `adresSklepu` i `podmiotHandlowy`, nie ma `bolecinAdres` ani `bolecinNazwa` → `adres` i `nazwa` puste. Data, kto, miejsce, rodzaj zbiórki i worki dalej z protokołu.
- `test_protocolBolecinFields_when_manual_fields_blank_should_not_fall_back_to_shop` — spacje w obu polach → puste komórki.
- `test_protocolBolecinFields_when_manual_fields_typed_should_copy_them_to_bolecin_columns` — wpisany tekst wygrywa z adresem sklepu i podmiotem.

W `test_protocolBolecinFields_when_flag_and_bolecin_should_map_registration_to_awizacja` pierwsza asercja dziś oczekuje adresu sklepu. Po czerwonym kroku oczekuje pustego adresu i pustej nazwy. Druga asercja (jawne `bolecinAdres` / `bolecinNazwa`, suma worków, rodzaj) zostaje.

Uruchomić ten plik. Ma paść na starym `prefer_`. Dopiero wtedy w `protocolBolecinFields_` adres i nazwa biorą się z `collapseText_(bolecinAdres|bolecinNazwa)`. Komentarz przy POST protokołu na górze `transport-log.gs` (ok. linie 87–92) opisuje nowe reguły tych dwóch kolumn.

### 2. Okno (`src/phase6.test.ts`)

- W HTML są puste inputy `bolecin-aw-adres` i `bolecin-aw-nazwa` (max. 500 znaków, jak komentarze). Nie ma w nich adresu punktu.
- `test_readBolecinAwizacjaInputs_when_fields_empty_should_return_blank_address_and_name`
- `test_assignBolecinAwizacja_when_fields_empty_should_send_blank_bolecin_address_and_keep_shop_fields` — `bolecinAdres` i `bolecinNazwa` to `''`, a `adresSklepu` i `podmiotHandlowy` zostają z punktu.
- `test_assignBolecinAwizacja_when_fields_typed_should_send_typed_address_and_name`
- `test_assignBulkBolecinAwizacja_when_manual_fields_empty_should_not_copy_joined_point_labels` — zbiorcza nie skleja adresów ani nazw z punktów do payloadu. Suma worków i rodzaj zbiórki zostają. `test_assignBulkBolecinAwizacja_when_many_protocols_should_sum_bags_into_one_row` przestaje oczekiwać `ul. B 2; ul. A 1` w `bolecinAdres`.
- `test_fillBolecinAwizacjaSummary_when_opened_should_leave_address_inputs_empty` — otwarcie czyści oba pola i ustawia podpis (pojedynczy albo mnogi). Linie podsumowania adresu i nazwy znikają. Reszta podsumowania zostaje.

Uruchomić te testy. Mają paść. Potem:

- `src/map/modalsHtml.ts` — dwa pola nad blokiem „Z protokołu do arkusza Bolęcin”.
- `src/map/browser/bolecin.ts` — odczyt pól, zapis do `payload.bolecinAdres` / `payload.bolecinNazwa` w `assignBolecinAwizacja_` (wspólne dla jednego protokołu i zbiorczej). `assignBulkBolecinAwizacja_` nie nadpisuje ich wynikiem `collectBulkAwizacjaParts_`.
- Jeśli po tym `parts.adres` i `parts.nazwa` nic nie czyta, sklejanie adresów i nazw w `collectBulkAwizacjaParts_` wypada (zostają rodzaj i worki).

`docGenerate.ts` nie dostaje nowej ścieżki: Word i rejestr już składają payload z punktu, zanim dołożą się pola awizacji.

### 3. Dokumentacja po zielonym suite

W `docs/TRANSPORT_SHEET.md` zdanie „do czasu wdrożenia kod nadal bierze je z protokołu” schodzi. Zostaje opis z założenia. W `-context.md` data i wynik checkpointu.

## Checkpoint

Po każdym z kroków 1 i 2, i na końcu:

`npm test` w `arkusz-mapa/`. Czerwony suite nowego kroku zatrzymuje robotę do poprawki testu albo implementacji tego kroku. Krok 2 startuje dopiero, gdy krok 1 jest zielony.

## Pliki

- `src/harmonogramGroup.gas.test.ts` — czerwone testy serwera
- `google-apps-script/transport-log.gs` — `protocolBolecinFields_` i komentarz kontraktu
- `src/phase6.test.ts` — czerwone testy okna
- `src/map/modalsHtml.ts` — pola
- `src/map/browser/bolecin.ts` — odczyt, czyszczenie, payload
- `docs/TRANSPORT_SHEET.md` — założenie już jest; po wdrożeniu opis bieżącego zachowania

## Poza tym zadaniem

- `mode=awizujBolecin` i `appendBolecinMapped_` dla harmonogramu
- szablon Worda, kolumny rejestru, klucz trójki

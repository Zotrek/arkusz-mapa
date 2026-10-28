# Tasks: ręczny adres i nazwa w awizacji do Bolęcina

> **Task:** 0001_bolecin-adres-reczny  
> **Updated:** 2026-10-28

Test przed kodem. Czerwony wynik nowego kroku zatrzymuje robotę. Krok 2 startuje po zielonym kroku 1.

## 0. Założenie

- [x] Założenie w `docs/TRANSPORT_SHEET.md` (2026-10-28)
- [x] Plan i kontekst tego zadania

## 1. Serwer

- [x] Testy w `src/harmonogramGroup.gas.test.ts` (mają paść na obecnym `prefer_`):
  - `test_protocolBolecinFields_when_manual_address_absent_should_leave_adres_and_nazwa_empty`
  - `test_protocolBolecinFields_when_manual_fields_blank_should_not_fall_back_to_shop`
  - `test_protocolBolecinFields_when_manual_fields_typed_should_copy_them_to_bolecin_columns`
  - w `test_protocolBolecinFields_when_flag_and_bolecin_should_map_registration_to_awizacja` adres i nazwa puste, gdy kluczy awizacji nie ma
- [x] Uruchomić `src/harmonogramGroup.gas.test.ts` i zobaczyć czerwień na tych asercjach
- [x] `protocolBolecinFields_`: adres i nazwa tylko z `bolecinAdres` / `bolecinNazwa`
- [x] Komentarz kontraktu przy POST protokołu w `transport-log.gs`
- [x] **CHECKPOINT 1:** `npm test` w `arkusz-mapa/` — pass

## 2. Okno

- [x] Testy w `src/phase6.test.ts` (mają paść przed polami w HTML i przed zmianą `assign*`):
  - puste inputy `bolecin-aw-adres` i `bolecin-aw-nazwa`
  - `test_readBolecinAwizacjaInputs_when_fields_empty_should_return_blank_address_and_name`
  - `test_assignBolecinAwizacja_when_fields_empty_should_send_blank_bolecin_address_and_keep_shop_fields`
  - `test_assignBolecinAwizacja_when_fields_typed_should_send_typed_address_and_name`
  - `test_assignBulkBolecinAwizacja_when_manual_fields_empty_should_not_copy_joined_point_labels`
  - `test_fillBolecinAwizacjaSummary_when_opened_should_leave_address_inputs_empty`
  - `test_assignBulkBolecinAwizacja_when_many_protocols_should_sum_bags_into_one_row` bez sklejanego adresu w `bolecinAdres`
- [x] Uruchomić `src/phase6.test.ts` i zobaczyć czerwień na tych asercjach
- [x] Pola w `src/map/modalsHtml.ts`, odczyt i payload w `src/map/browser/bolecin.ts`
- [x] Sklejanie adresów i nazw w `collectBulkAwizacjaParts_` usunąć, jeśli po odpięciu od payloadu nic go nie czyta
- [x] **CHECKPOINT 2:** `npm test` w `arkusz-mapa/` — pass

## Documentation Updates

- [x] Założenie w `docs/TRANSPORT_SHEET.md` przed kodem
- [x] Po zielonym suite: w tym samym pliku zdjąć „do czasu wdrożenia kod nadal bierze je z protokołu”
- [x] `-context.md`: data checkpointów i status
- [x] `-tasks.md` po każdym kroku

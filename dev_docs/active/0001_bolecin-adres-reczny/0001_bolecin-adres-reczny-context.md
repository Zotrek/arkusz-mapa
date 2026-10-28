# Context: ręczny adres i nazwa w awizacji do Bolęcina

> **Task:** 0001_bolecin-adres-reczny  
> **Last Updated:** 2026-10-28  
> **Status:** wdrożone

## Decyzje

- Źródło: rozmowa 2026-10-28. Założenie zapisane w `docs/TRANSPORT_SHEET.md`.
- Puste pola. Żadnego przepisywania adresu punktu ani nazwy podmiotu do okna i do dwóch kolumn arkusza Bolęcin.
- Zasięg: tylko wiersz z okna „Awizacja do Bolęcina” (jeden protokół i zbiorcza). Word, rejestr (`adresSklepu`, `podmiotHandlowy` w `appendTransportRow_`) i karta harmonogramu (`mode=awizujBolecin`) bez zmian.
- Serwer nie robi `prefer_(bolecinAdres, adresSklepu)` ani `prefer_(bolecinNazwa, podmiotHandlowy)`. Okno wysyła oba klucze także jako pusty string. Rodzaj zbiórki i worki nadal mają fallback z protokołu.
- Klucz wiersza adres + data + kto zostaje. Pusty adres przy tej samej dacie i tym samym przewoźniku nadpisuje wcześniejszy wiersz.
- Długość pól: 500 znaków, jak komentarze protokołu. Kilka adresów wpisanych ręcznie nie mieści się w 120.

## Gdzie to siedzi

- Okno: `src/map/modalsHtml.ts` (`bolecin-aw-modal`), logika `src/map/browser/bolecin.ts`.
- Podpięcie payloadu: `assignBolecinAwizacja_` (jeden protokół i zbiorcza, `docGenerate.ts`) ustawia `bolecinAdres` i `bolecinNazwa` z pól, także jako pusty string. `assignBulkBolecinAwizacja_` dokłada rodzaj zbiórki i sumę worków, bez sklejania adresów i nazw z punktów.
- Zapis: `protocolBolecinFields_` w `google-apps-script/transport-log.gs`. Kolumny łapie `bolecinFieldKey_` po nagłówku zawierającym `adres odbioru` albo `nazwa kontrahenta`.
- Testy: `src/harmonogramGroup.gas.test.ts` (serwer, `node:vm` na `.gs`), `src/phase6.test.ts` (HTML i funkcje okna).

## Checkpoint

- 2026-10-28 **CHECKPOINT 1:** `npm test` w `arkusz-mapa/` — pass (1014). `protocolBolecinFields_` bierze adres i nazwę tylko z `bolecinAdres` / `bolecinNazwa`. Czerwone testy serwera padały na starym `prefer_` (brak klucza i same spacje podstawiały sklep).
- 2026-10-28 **CHECKPOINT 2:** `npm test` w `arkusz-mapa/` — pass (1020). Okno ma puste pola, otwarcie je czyści, zbiorcza nie skleja adresu ani nazwy do payloadu.

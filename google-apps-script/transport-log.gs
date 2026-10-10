/**
 * Rejestr transportów + słowniki referencyjne — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *   + Script properties: GAS_SHARED_SECRET (wymagane). Publiczny front woła Cloudflare Worker.
 *
 * GET ?action=modalData&podmiot=…&adres=…  (zalecane — jeden request)
 * GET ?action=bulkLastTransportDates  (ostatnie daty + kto odbiera dla wszystkich sklepów — mapa)
 * GET ?action=previewNumber
 * GET ?action=lastTransportDate&podmiot=…&adres=…  (data + kto odbiera)
 * GET ?action=listReferenceData  → { ok, data: { podwykoLista, poprawAdres } }
 * GET ?action=routeNameProposal  → { ok, names }  (kolumna 11, zajęte nazwy; propozycję liczy strona)
 * GET ?action=routeRateByName&name=…  → { ok, stawka }  (stawka z nierozliczonego wiersza, pusta gdy nazwy nie było)
 * GET ?action=listContractors  → { ok, data: [ { nazwa, dane } ] }  (odczyt, bez zapisu)
 * GET ?action=listStoreAddresses → { ok, data: [ { adres, sklep }, … ] }
 *   Unikalny adres (po normalizacji al./pl./Św.) z kolumny 2. Nazwa z kolumny 4 (Sklep), pierwsza niepusta.
 * GET ?action=settlementSearch&podwykonawca=…&dataDo=dd.mm.yyyy&dataOd=…
 *   dataOd opcjonalna. tryb=harmonogram → zakładka „zestawienie z harmonogramu” (+ rates z Bazy cen).
 *   To samo POST { action: settlementSearch, … }. Nic nie zapisuje.
 * POST { action: syncZestawienieHarmonogram, dataOd?, dataDo? }
 *   Agreguje odebrane + dni podjazdu z Bazy cen → „zestawienie z harmonogramu”.
 *   Domyślne okno: 1. bieżącego miesiąca → dziś. Rozliczony=tak nie nadpisuje.
 * GET ?action=settlementStats&dataOd=dd.mm.yyyy&dataDo=dd.mm.yyyy&podwykonawca=…
 *   Oba krańce dat wymagane. podwykonawca opcjonalny (pusty = wszyscy). Nic nie zapisuje.
 *   Wiersze: rejestr (mode=report) + grupy worków z „odebrane z harmonogramu” (mode=schedule).
 *   Pola: P/Q/I, status, snapshoty L/M, adres, data, podwykonawca, mode; rates do remisów.
 * POST { action: patchBags | patchRouteRate | detachRoute | attachRoute | resolveRateTie | approve }
 *   Zapis od razu, pod tym samym lockiem co protokół. saveRate tu nie powstaje drugi raz.
 *   tryb=harmonogram|schedule → zapis na „zestawienie z harmonogramu”; inaczej Arkusz1.
 *   Rejestr: sheetRow + transportNumber. Odpada, gdy w tym wierszu kolumna 1 jest inna.
 *   Kolumn 17 i 18 nie ruszają patchBags, patchRouteRate, detachRoute, attachRoute.
 *   resolveRateTie pisze tylko w Bazie stawek.
 *   approve — jedyny zapis kolumn 15–18. Bez numeru faktury albo bez zaznaczenia odmawia całości.
 *   Zła para i wiersz już `tak` pomija, resztę zaznaczenia zapisuje. Koszt bierze z body, nie z bazy.
 *   Remisu z Bazy stawek nie blokuje (koszt ze snapshotu kolumn 13–14).
 *   Sklep z „nie odbył się” dostaje samo `nie` w kolumnie 10 (Arkusz1) / 9 (zestawienie).
 *   Zwykłe rozliczenie (bez tej flagi) dopisuje też `tak` w „transport się odbył” obok Rozliczony.
 *   Wiersza spoza zaznaczenia nie rusza.
 *   Na żywy arkusz approve wchodzi w W1, nie w M6. Nagłówków rejestru nie wpisuje.
 * POST (body JSON, Content-Type: text/plain):
 *   (brak mode) — append wiersza transportu + atomowa numeracja
 *   Opcjonalnie `trasa` i `stawkaTrasy` (kolumny 11–12). Bez klucza `trasa` te kolumny zostają puste.
 *   Pusta `stawkaTrasy` zostaje pusta tylko na nowym wierszu i nie czyści stawki innych wierszy tej nazwy.
 *   Kwota, także 0, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 11.
 *   Kolumny 13–14 (Stawka za podjazd / Stawka za worek) zawsze ze snapshotu Bazy stawek
 *   (adres po normalizacji al./pl./Św. + kto odbiera + data odbioru). Remis albo brak pary → puste.
 *   Kolumna 10 = transport się odbył. Komentarze 1–2 na kolumnach 19–20.
 *   mode=addReferencePodwyko | addPoprawAdres | saveRate | saveRateHarmonogram
 *   (legacy: addReferencePrzewoznik | addReferenceDostawa → zapis do Lista podwykonawców)
 *   saveRate — Baza stawek. Body: sklep, podwykonawca, kwotaPodjazd, kwotaWorek, odKiedy.
 *   Klucz: adres (po normalizacji al./pl./Św.) + podwykonawca + data. Trafione wiersze nadpisuje
 *   (także kilka wariantów tego samego adresu); adres w arkuszu ustawia na kanoniczny z mapy.
 *   Kwota 0 i puste pole są dozwolone. Usuwania nie ma. Rejestru (kolumny 15–18) nie rusza.
 *   Brak zakładki Baza stawek: ten zapis ją zakłada, z nagłówkami w wierszu 1.
 *   saveRateHarmonogram — Baza cen harmonogram. Body jak saveRate + dniOdbiorow + opcjonalnie nazwaTrasy, kwotaTrasy.
 *   Ceny: ten sam klucz co saveRate. Nazwa+cena trasy razem albo obie puste (pusta para przy overwrite nie czyści).
 *   Dni: przy istniejącym połączeniu sklep + podwykonawca aktualizuje tylko gdy się zmieniły (wszystkie wiersze pary).
 *   Zmiana kanonicznych dni (pn, cz ≠ samo pn) czyści „Id harmonogramu” na tych wierszach.
 *   Po zapisie: stawki/trasa na nierozliczonych wierszach „zestawienie z harmonogramu” tej pary (jak sync).
 *   Brak zakładki: zakłada z nagłówkami jak sync pipeline.
 * GET ?action=listHarmonogramy → { ok, harmonogramy, doZgrupowania }
 *   Do zgrupowania: sklepy bez pasującego id, kubełki = te same dni + ten sam podwykonawca.
 * POST mode=groupHarmonogram { rows: [nr wiersza Bazy cen, …] } → { ok, id }  (H0001…)
 * POST mode=saveHarmonogram { id, cenaTrasy, miejsceZrzutu, oknoAwizacji, awizacja,
 *   rodzajZbiorki, rodzajTransportu, spodziewaneWorki }
 * POST mode=ungroupHarmonogram { rows: […] } — czyści id, nagłówka harmonogramu nie usuwa.
 * POST mode=awizujBolecin { id, nazwy?: { adres: nazwa } }
 *   Tylko gdy miejsce zrzutu to Bolęcin/Biosystem. Jeden wiersz na datę (bieżący miesiąc,
 *   od 22. także następny). Adresy i nazwy sklepów sklejone. Ta sama trójka adres+data+kto
 *   nie dopisuje drugi raz. Puste „Spodziewane worki” zostają puste.
 *   Wymaga Script property BOLECIN_SHEETS_ID (arkusz Bolęcin, edycja konta Web App).
 * POST protokołu z awizujBolecin: true (miejsce Bolęcin/Biosystem) dopisuje jeden wiersz
 *   tego odbioru do arkusza Bolęcin: okno awizacji, nr rejestracyjny w kolumnie awizacja,
 *   rodzaj transportu oraz adres, nazwa, data, kto, miejsce, rodzaj zbiórki i worki.
 *   Ta sama trójka adres+data+kto nadpisuje istniejący wiersz.
 * migrateRegisterLayoutRates_ — V1→V3 (wywołanie ręczne). V2→V3: migrateRegisterLayoutTransportOdbył.
 *
 * Bezpieczeństwo: doGet/doPost wymagają Script property GAS_SHARED_SECRET
 * (Cloudflare Worker dokleja secret= / body.secret). Bez property = błąd.
 *
 * Zakładki (ten sam plik; rejestr po nazwie, nie po kolejności kart):
 *   Na zgłoszenie {MiesiącPL} {YYYY} — rejestr miesięczny (np. Na zgłoszenie Październik 2026)
 *   Harmonogram {MiesiącPL} {YYYY} — zestawienie miesięczne (np. Harmonogram Październik 2026)
 *   Arkusz1 — legacy Na zgłoszenie (historia sprzed migracji miesięcznej)
 *   zestawienie z harmonogramu — legacy Harmonogram (historia)
 *   odebrane z harmonogramu — 1 wiersz = 1 worek (źródło sync)
 *   Lista podwykonawców, Popraw adres, Baza stawek, Baza cen harmonogram, Harmonogramy
 *   (legacy odczyt: Przewoźnicy, Miejsca dostawy — scalane przy listReferenceData)
 */

/** Legacy rejestr Na zgłoszenie. Kolejność kart w pliku nie ma znaczenia. */
var REGISTER_SHEET_NAME = 'Arkusz1';
/** Prefiks zakładek miesięcznych Na zgłoszenie. */
var REPORT_MONTH_SHEET_PREFIX = 'Na zgłoszenie ';
/** Prefiks zakładek miesięcznych Harmonogram. */
var SCHEDULE_MONTH_SHEET_PREFIX = 'Harmonogram ';
var MONTH_NAMES_PL = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];

var COL = {
  numer: 1,
  adres: 2,
  podmiot: 3,
  sklep: 4,
  dataOdbioru: 5,
  ktoOdbiera: 6,
  miejsceZrzutu: 7,
  rodzajZbiorki: 8,
  iloscWorkow: 9,
  transportOdbył: 10,
  trasa: 11,
  stawkaTrasy: 12,
  stawkaPodjazdu: 13,
  stawkaWorka: 14,
  rozliczony: 15,
  numerFaktury: 16,
  kosztOdbioru: 17,
  kosztPerWorek: 18,
  komentarz1: 19,
  komentarz2: 20,
};

/** Tekst nagłówka, nie pusta komórka. Kolumn 1–9 to nie rusza. Aplikacja rozliczeń tego nie wpisuje. */
var REGISTER_HEADERS_10_20 = [
  'transport się odbył',
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'Komentarz 1',
  'Komentarz 2',
];

/** Pełne nagłówki rejestru Na zgłoszenie (nowe zakładki miesięczne). */
var REGISTER_HEADERS_FULL = [
  'Numer transportowy',
  'Adres sklepu',
  'Podmiot handlowy',
  'Sklep',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ilość worków',
].concat(REGISTER_HEADERS_10_20);

/** Marker migracji V2 — nagłówek kolumny 12 przy układzie Trasa@10. */
var REGISTER_LAYOUT_V2_MARKER = 'Stawka za podjazd';

/** J to kolumna 10 (transport się odbył). Reguła arkusza, nie klasa w przeglądarce. */
var TRANSPORT_HAPPENED_STRIKE_FORMULA = '=$J2="nie"';

var TRANSPORT_MAX_NUM_KEY = 'transportMaxNum';
/** Cache wiersza ostatniego numeru: „sheetName\\trow”. */
var TRANSPORT_LAST_ROW_KEY = 'transportLastRow';
var TRANSPORT_LAST_SHEET_KEY = 'transportLastSheet';
/** Tajny klucz Worker → GAS. Ustaw w Apps Script → Project settings → Script properties: GAS_SHARED_SECRET. Nie commituj. */
var GAS_SHARED_SECRET_KEY = 'GAS_SHARED_SECRET';

var REF_PODWYKO_SHEET_NAME = 'Lista podwykonawców';
var REF_PRZ_SHEET_NAME = 'Przewoźnicy';
var REF_DOS_SHEET_NAME = 'Miejsca dostawy';
var REF_POPRAW_SHEET_NAME = 'Popraw adres';
var RATE_SHEET_NAME = 'Baza stawek';
var HARMONOGRAM_RATE_SHEET_NAME = 'Baza cen harmonogram';
var ODEBRANE_Z_HARMONOGRAMU_SHEET_NAME = 'odebrane z harmonogramu';
var SCHEDULE_REGISTER_SHEET_NAME = 'zestawienie z harmonogramu';
var HARMONOGRAM_RATE_HEADERS = [
  'Adres sklepu',
  'Podwykonawca',
  'Nazwa trasy',
  'Cena za podjazd',
  'Cena za worek',
  'Cena za trasę',
  'Od kiedy obowiązuje cena',
  'Dni odbiorów',
  'Id harmonogramu',
];
var HARMONOGRAMY_SHEET_NAME = 'Harmonogramy';
var HARMONOGRAM_ID_HEADER = 'Id harmonogramu';
var INCLUDE_NEXT_MONTH_FROM_DAY = 22;
var BOLECIN_SHEETS_ID_PROP = 'BOLECIN_SHEETS_ID';
var HARMONOGRAMY_HEADERS = [
  'Id',
  'Podwykonawca',
  'Dni odbiorów',
  'Cena za trasę',
  'Miejsce zrzutu',
  'Okno awizacji',
  'Awizacja',
  'Rodzaj zbiórki',
  'Rodzaj transportu',
  'Spodziewane worki',
];
var BOLECIN_HEADER_ROW = [
  'Okno awizacji',
  'Adres odbioru',
  'Nazwa kontrahenta / podmiot handlowy',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ile worków',
  'rodzaj traportu',
  'awizacja',
];

/** Nagłówki zestawienia Harmonogram — bez nr zlecenia. */
var SCHEDULE_REGISTER_HEADERS = [
  'Adres odbioru',
  'Nazwa kontrahenta / podmiot handlowy',
  'Nazwa punktu / nazwa skrócona',
  'Data odbioru',
  'Kto odbiera',
  'Miejsce zrzutu',
  'Rodzaj zbiórki',
  'Ilość worków',
  'transport się odbył',
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'Komentarz 1',
  'Komentarz 2',
];

/** Kolumny zestawienia (1-based) — bez nr zlecenia. */
var SCHEDULE_COL = {
  adres: 1,
  podmiot: 2,
  sklep: 3,
  dataOdbioru: 4,
  ktoOdbiera: 5,
  miejsceZrzutu: 6,
  rodzajZbiorki: 7,
  iloscWorkow: 8,
  transportOdbył: 9,
  trasa: 10,
  stawkaTrasy: 11,
  stawkaPodjazdu: 12,
  stawkaWorka: 13,
  rozliczony: 14,
  numerFaktury: 15,
  kosztOdbioru: 16,
  kosztPerWorek: 17,
  komentarz1: 18,
  komentarz2: 19,
};
var REF_PODWYKO_HEADER = ['Nazwa', 'Dane do Worda'];
var REF_PRZ_HEADER = [
  'Nazwa wyświetlana',
  'Nazwa do protokołu',
  'Adres',
  'NIP',
  'nr BDO',
];
var REF_DOS_HEADER = ['Nazwa', 'Dane do Worda'];
var REF_POPRAW_HEADER = [
  'Podmiot handlowy',
  'Sklep',
  'Adres',
  'Lat',
  'Lon',
  'Uwagi',
  'UpdatedAt',
  'Author',
  'Województwo',
];

var REF_PRZ_NIP_COL = 4;
var REF_PRZ_BDO_COL = 5;

function doGet(e) {
  try {
    var secretGate = requireAppSecret_(e, null);
    if (secretGate) return secretGate;
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'modalData') {
      var podmiot = (e.parameter.podmiot || '').toString();
      var adres = (e.parameter.adres || '').toString();
      return jsonResponse(buildModalDataResponse_(podmiot, adres));
    }
    if (action === 'bulkLastTransportDates') {
      return jsonResponse(buildBulkLastTransportDatesResponse_());
    }
    if (action === 'previewNumber') {
      return jsonResponse({ ok: true, numer: String(getPreviewNumber_()) });
    }
    if (action === 'lastTransportDate') {
      var podmiotLegacy = (e.parameter.podmiot || '').toString();
      var adresLegacy = (e.parameter.adres || '').toString();
      var info = findLastTransportInfo_(podmiotLegacy, adresLegacy);
      var ms = info ? info.ms : null;
      return jsonResponse({
        ok: true,
        lastTransportDateMs: ms,
        lastTransportDateYmd: ms != null ? formatYmdFromMs_(ms) : null,
        lastKtoOdbiera: info && info.ktoOdbiera ? info.ktoOdbiera : '',
      });
    }
    if (action === 'listReferenceData') {
      return jsonResponse({ ok: true, data: listReferenceData_() });
    }
    if (action === 'routeNameProposal') {
      return jsonResponse({ ok: true, names: listOccupiedRouteNames_() });
    }
    if (action === 'routeRateByName') {
      var routeName = (e.parameter.name || '').toString();
      return jsonResponse({ ok: true, stawka: routeRateByName_(routeName) });
    }
    if (action === 'listContractors') {
      return jsonResponse({ ok: true, data: listContractors_() });
    }
    if (action === 'listStoreAddresses') {
      return jsonResponse({ ok: true, data: listStoreAddresses_() });
    }
    if (action === 'listHarmonogramy') {
      return jsonResponse(listHarmonogramy_());
    }
    if (action === 'settlementSearch') {
      return jsonResponse(settlementSearch_(e.parameter));
    }
    if (action === 'settlementStats') {
      return jsonResponse(settlementStats_(e.parameter));
    }
    return jsonResponse({ ok: false, error: 'unknown action' }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) || '{}';
  var body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
  var secretGate = requireAppSecret_(e, body);
  if (secretGate) return secretGate;
  if (body && body.secret != null) {
    delete body.secret;
  }
  if (body && String(body.action || '') === 'settlementSearch') {
    try {
      return jsonResponse(settlementSearch_(body));
    } catch (err) {
      return jsonResponse({ ok: false, error: String(err) }, 500);
    }
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var writeAction = body && body.action ? String(body.action) : '';
    if (writeAction === 'syncZestawienieHarmonogram') {
      return jsonResponse(syncZestawienieHarmonogram_(body));
    }
    if (isSettlementWriteAction_(writeAction)) {
      return jsonResponse(runSettlementWrite_(writeAction, body));
    }
    var mode = body && body.mode ? String(body.mode) : '';
    if (mode === 'addReferencePodwyko') {
      return handleAddReferencePodwykoPost_(body);
    }
    if (mode === 'addReferencePrzewoznik' || mode === 'addReferenceDostawa') {
      return handleAddReferencePodwykoPost_(normalizeLegacyPodwykoBody_(body, mode));
    }
    if (mode === 'addPoprawAdres') {
      return handleAddPoprawAdresPost_(body);
    }
    if (mode === 'saveRate') {
      return handleSaveRatePost_(body);
    }
    if (mode === 'saveRateHarmonogram') {
      return handleSaveRateHarmonogramPost_(body);
    }
    if (mode === 'groupHarmonogram') {
      return handleGroupHarmonogramPost_(body);
    }
    if (mode === 'saveHarmonogram') {
      return handleSaveHarmonogramPost_(body);
    }
    if (mode === 'ungroupHarmonogram') {
      return handleUngroupHarmonogramPost_(body);
    }
    if (mode === 'awizujBolecin') {
      return handleAwizujBolecinPost_(body);
    }
    if (wantsProtocolBolecin_(body)) {
      getBolecinSheetsId_();
    }
    var numer = resolveTransportNumber_(body);
    appendTransportRow_(numer, body);
    if (wantsProtocolBolecin_(body)) {
      upsertProtocolBolecin_(body);
    }
    return jsonResponse({ ok: true, numer: String(numer) });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  } finally {
    lock.releaseLock();
  }
}

/** Jednorazowo: Extensions → Apps Script → wybierz rebuildTransportCounterFromSheet → Run */
function rebuildTransportCounterFromSheet() {
  var result = scanMaxNumberAndRowFromSheet_();
  setStoredMaxNumber_(result.max);
  if (result.row > 0) {
    setStoredLastRow_(result.row);
  } else {
    clearStoredLastRow_();
  }
}

function jsonResponse(obj, statusCode) {
  var out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
  return out;
}

/**
 * Odrzuca wywołanie bez tajnego klucza (Worker dokleja secret= / body.secret).
 * Brak właściwości skryptu = fail-closed (najpierw ustaw GAS_SHARED_SECRET, potem Deploy).
 * @returns {GoogleAppsScript.Content.TextOutput|null} odpowiedź błędu albo null gdy OK
 */
function requireAppSecret_(e, body) {
  var expected = String(
    PropertiesService.getScriptProperties().getProperty(GAS_SHARED_SECRET_KEY) || '',
  ).trim();
  if (!expected) {
    return jsonResponse(
      { ok: false, error: 'GAS_SHARED_SECRET not configured in Script properties' },
      503,
    );
  }
  var got = '';
  if (e && e.parameter && e.parameter.secret != null) {
    got = String(e.parameter.secret);
  }
  if (!got && body && body.secret != null) {
    got = String(body.secret);
  }
  if (got !== expected) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  return null;
}

/** Legacy Arkusz1 — tylko gdy zakładka istnieje (historia). */
function getDataSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTER_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'Brak zakładki "' +
        REGISTER_SHEET_NAME +
        '" — rejestr transportów szukany po nazwie, nie po kolejności kart.',
    );
  }
  return sheet;
}

/** dd.mm.yyyy → { day, month, year } albo null. */
function parsePickupDateParts_(value) {
  var text = settlementDateText_(value);
  if (!text) {
    return null;
  }
  var m = String(text).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) {
    return null;
  }
  var day = parseInt(m[1], 10);
  var month = parseInt(m[2], 10);
  var year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { day: day, month: month, year: year };
}

/** Dziś w timezone skryptu. */
function todayParts_() {
  var now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

/** „Październik 2026” z daty dd.mm.yyyy; puste/złe → dziś. */
function monthLabelFromDateText_(dateText) {
  var parsed = parsePickupDateParts_(dateText);
  var d = parsed != null ? parsed : todayParts_();
  return MONTH_NAMES_PL[d.month - 1] + ' ' + d.year;
}

function reportMonthSheetName_(dateText) {
  return REPORT_MONTH_SHEET_PREFIX + monthLabelFromDateText_(dateText);
}

function scheduleMonthSheetName_(dateText) {
  return SCHEDULE_MONTH_SHEET_PREFIX + monthLabelFromDateText_(dateText);
}

/** kind: 'report' | 'schedule' */
function isMonthRegisterSheetName_(kind, name) {
  var n = settlementText_(name);
  if (kind === 'schedule') {
    return n.indexOf(SCHEDULE_MONTH_SHEET_PREFIX) === 0 && n.length > SCHEDULE_MONTH_SHEET_PREFIX.length;
  }
  return n.indexOf(REPORT_MONTH_SHEET_PREFIX) === 0 && n.length > REPORT_MONTH_SHEET_PREFIX.length;
}

/**
 * Zakładki rejestru po nazwie (nie po kolejności kart): legacy + wszystkie miesięczne.
 * @returns {Array<{ name: string, sheet: GoogleAppsScript.Spreadsheet.Sheet }>}
 */
function listRegisterSheets_(kind) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var out = [];
  var seen = {};
  var legacyName = kind === 'schedule' ? SCHEDULE_REGISTER_SHEET_NAME : REGISTER_SHEET_NAME;
  var legacy = ss.getSheetByName(legacyName);
  if (legacy) {
    out.push({ name: legacyName, sheet: legacy });
    seen[legacyName] = true;
  }
  var i;
  for (i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    if (seen[name] || !isMonthRegisterSheetName_(kind, name)) {
      continue;
    }
    out.push({ name: name, sheet: sheet });
    seen[name] = true;
  }
  return out;
}

function prepareReportRegisterSheet_(sheet) {
  if (isRegisterLayoutV1_(sheet)) {
    throw new Error(
      'Rejestr ma stary układ kolumn (komentarze w J/K). Uruchom migrateRegisterLayoutRates w Apps Script, potem wdróż Web App.',
    );
  }
  if (isRegisterLayoutV2_(sheet)) {
    throw new Error(
      'Rejestr ma układ V2 (Trasa w J). Uruchom migrateRegisterLayoutTransportOdbył w Apps Script, potem wdróż Web App.',
    );
  }
  ensureTransportRegisterColumns_(sheet);
  return sheet;
}

function prepareScheduleRegisterSheet_(sheet) {
  if (isScheduleLayoutV2_(sheet)) {
    migrateScheduleTransportOdbyłColumn_();
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheet.getName()) || sheet;
  }
  if (!isScheduleLayoutV2_(sheet)) {
    ensureRefSheetHeader_(sheet, SCHEDULE_REGISTER_HEADERS);
  }
  ensureScheduleTransportHappenedRules_(sheet);
  return sheet;
}

/**
 * Zakładka miesiąca: create + nagłówki jeśli brak. Lookup wyłącznie po nazwie.
 * kind: 'report' | 'schedule'
 */
function getOrCreateMonthRegisterSheet_(kind, dateText) {
  var name =
    kind === 'schedule' ? scheduleMonthSheetName_(dateText) : reportMonthSheetName_(dateText);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (sheet.getLastRow() < 1) {
      var headers = kind === 'schedule' ? SCHEDULE_REGISTER_HEADERS : REGISTER_HEADERS_FULL;
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  if (kind === 'schedule') {
    return prepareScheduleRegisterSheet_(sheet);
  }
  return prepareReportRegisterSheet_(sheet);
}

/** Legacy zestawienie — create gdy brak (migracje / odczyt). */
function getOrCreateScheduleRegisterSheet_() {
  var sheet = getOrCreateRefSheet_(SCHEDULE_REGISTER_SHEET_NAME, SCHEDULE_REGISTER_HEADERS);
  return prepareScheduleRegisterSheet_(sheet);
}

/** Zakładka do zapisu po nazwie z body (wymagane przy rozliczeniach). */
function getRegisterSheetByName_(sheetName, kind) {
  var name = settlementText_(sheetName);
  if (!name) {
    return null;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    return null;
  }
  if (kind === 'schedule') {
    if (name !== SCHEDULE_REGISTER_SHEET_NAME && !isMonthRegisterSheetName_('schedule', name)) {
      return null;
    }
    return sheet;
  }
  if (name !== REGISTER_SHEET_NAME && !isMonthRegisterSheetName_('report', name)) {
    return null;
  }
  return sheet;
}

/** Lista tak/nie na kolumnie „transport się odbył” (I). */
function ensureScheduleTransportHappenedRules_(sheet) {
  var gridRows = sheet.getMaxRows() < 2 ? 1 : sheet.getMaxRows() - 1;
  if (!dataValidationHasTakNie_(sheet.getRange(2, SCHEDULE_COL.transportOdbył).getDataValidation())) {
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['tak', 'nie'], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, SCHEDULE_COL.transportOdbył, gridRows, 1).setDataValidation(validation);
  }
  var formula = '=$I2="nie"';
  var rules = sheet.getConditionalFormatRules();
  var hasStrike = false;
  var expected = formula.replace(/\s/g, '');
  var ri;
  for (ri = 0; ri < rules.length; ri++) {
    var rule = rules[ri];
    if (!rule || typeof rule.getBooleanCondition !== 'function') {
      continue;
    }
    var condition = rule.getBooleanCondition();
    if (!condition || typeof condition.getCriteriaValues !== 'function') {
      continue;
    }
    var values = condition.getCriteriaValues();
    var f = values && values.length ? String(values[0]) : '';
    if (f.replace(/\s/g, '') === expected) {
      hasStrike = true;
      break;
    }
  }
  if (!hasStrike) {
    var strike = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setStrikethrough(true)
      .setRanges([sheet.getRange(2, 1, gridRows, SCHEDULE_COL.komentarz2)])
      .build();
    rules.push(strike);
    sheet.setConditionalFormatRules(rules);
  }
}
/**
 * tryb=harmonogram|schedule → zakładka Harmonogram (miesięczna lub legacy).
 * Inaczej Na zgłoszenie. Wymaga body.sheetName (lookup po nazwie).
 */
function settlementRegisterSheetForWrite_(body) {
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var schedule = tryb === 'harmonogram' || tryb === 'schedule';
  var sheet = getRegisterSheetByName_(body && body.sheetName, schedule ? 'schedule' : 'report');
  if (!sheet) {
    throw new Error('sheetName required — zakładka rejestru szukana po nazwie');
  }
  return sheet;
}

/** Kolumna Trasa, bez pustych — skan legacy + miesięczne Na zgłoszenie. */
function listOccupiedRouteNames_() {
  var names = [];
  var seen = {};
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var values = sheet.getRange(2, COL.trasa, lastRow - 1, 1).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      var name = String(values[i][0] == null ? '' : values[i][0]).trim();
      if (!name || seen[name]) {
        continue;
      }
      seen[name] = true;
      names.push(name);
    }
  }
  return names;
}

/**
 * Stawka z ostatniego nierozliczonego wiersza o tym tekście w kolumnie Trasa.
 * Skan legacy + miesięczne. Rozliczony `tak` pomija.
 */
function routeRateByName_(name) {
  var wanted = String(name == null ? '' : name).trim();
  if (!wanted) {
    return '';
  }
  var found = null;
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var numRows = lastRow - 1;
    var names = sheet.getRange(2, COL.trasa, numRows, 1).getValues();
    var rates = sheet.getRange(2, COL.stawkaTrasy, numRows, 1).getValues();
    var settled = sheet.getRange(2, COL.rozliczony, numRows, 1).getValues();
    var i;
    for (i = 0; i < numRows; i++) {
      var rowName = String(names[i][0] == null ? '' : names[i][0]).trim();
      if (rowName !== wanted) {
        continue;
      }
      var flag = String(settled[i][0] == null ? '' : settled[i][0]).trim().toLowerCase();
      if (flag === 'tak') {
        continue;
      }
      var rate = rates[i][0];
      found = rate == null || rate === '' ? '' : String(rate).trim();
    }
  }
  return found == null ? '' : found;
}

function buildModalDataResponse_(podmiot, adres) {
  var numer = getPreviewNumber_();
  var info = findLastTransportInfo_(podmiot, adres);
  var ms = info ? info.ms : null;
  return {
    ok: true,
    numer: String(numer),
    lastTransportDateMs: ms,
    lastTransportDateYmd: ms != null ? formatYmdFromMs_(ms) : null,
    lastKtoOdbiera: info && info.ktoOdbiera ? info.ktoOdbiera : '',
  };
}

function getStoredMaxNumber_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TRANSPORT_MAX_NUM_KEY);
  if (raw == null || raw === '') {
    return null;
  }
  var n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function setStoredMaxNumber_(max) {
  PropertiesService.getScriptProperties().setProperty(TRANSPORT_MAX_NUM_KEY, String(max));
}

function getStoredLastRow_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TRANSPORT_LAST_ROW_KEY);
  if (raw == null || raw === '') {
    return null;
  }
  var row = parseInt(raw, 10);
  return isNaN(row) || row < 2 ? null : row;
}

function getStoredLastSheetName_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TRANSPORT_LAST_SHEET_KEY);
  return raw == null || raw === '' ? '' : String(raw);
}

function setStoredLastRow_(row, sheetName) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(TRANSPORT_LAST_ROW_KEY, String(row));
  if (sheetName != null && String(sheetName) !== '') {
    props.setProperty(TRANSPORT_LAST_SHEET_KEY, String(sheetName));
  }
}

function clearStoredLastRow_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(TRANSPORT_LAST_ROW_KEY);
  props.deleteProperty(TRANSPORT_LAST_SHEET_KEY);
}

function parseNumberFromCell_(cell) {
  if (cell === '' || cell === null) {
    return null;
  }
  var digits = String(cell).replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  var n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

/** Skan max numeru po legacy + wszystkich miesięcznych Na zgłoszenie. */
function scanMaxNumberAndRowFromSheet_() {
  var max = 0;
  var maxRow = 0;
  var maxSheet = '';
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      var n = parseNumberFromCell_(values[i][0]);
      if (n != null && n >= max) {
        max = n;
        maxRow = i + 2;
        maxSheet = sheets[s].name;
      }
    }
  }
  return { max: max, row: maxRow, sheetName: maxSheet };
}

function scanMaxNumberFromSheet_() {
  return scanMaxNumberAndRowFromSheet_().max;
}

function isNumberAtRow_(expected, row, sheetName) {
  var sheet = getRegisterSheetByName_(sheetName || REGISTER_SHEET_NAME, 'report');
  if (!sheet || row > sheet.getLastRow()) {
    return false;
  }
  return parseNumberFromCell_(sheet.getRange(row, COL.numer).getValue()) === expected;
}

/** O(1): cache wiersza + nazwy zakładki; pełny skan gdy brak cache. */
function isLastAssignedNumberStillInSheet_(stored) {
  if (stored <= 0) {
    return true;
  }
  var row = getStoredLastRow_();
  var sheetName = getStoredLastSheetName_();
  if (row == null || !sheetName) {
    var found = findHighestRowWithNumber_(stored);
    if (found) {
      setStoredLastRow_(found.row, found.sheetName);
      row = found.row;
      sheetName = found.sheetName;
    }
  }
  if (row == null || !sheetName) {
    return false;
  }
  return isNumberAtRow_(stored, row, sheetName);
}

function findHighestRowWithNumber_(target) {
  var foundRow = null;
  var foundSheet = '';
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      if (parseNumberFromCell_(values[i][0]) === target) {
        foundRow = i + 2;
        foundSheet = sheets[s].name;
      }
    }
  }
  return foundRow == null ? null : { row: foundRow, sheetName: foundSheet };
}

function ensureStoredMaxNumberSeeded_() {
  var stored = getStoredMaxNumber_();
  if (stored != null) {
    return stored;
  }
  var result = scanMaxNumberAndRowFromSheet_();
  setStoredMaxNumber_(result.max);
  if (result.row > 0 && result.sheetName) {
    setStoredLastRow_(result.row, result.sheetName);
  }
  return result.max;
}

function resolveNextTransportNumber_(increment) {
  var stored = ensureStoredMaxNumberSeeded_();
  if (isLastAssignedNumberStillInSheet_(stored)) {
    var next = stored + 1;
    if (increment) {
      setStoredMaxNumber_(next);
    }
    return next;
  }
  // Usunięto ostatni numer (lub kilka z końca) — sync z arkuszem, bez wypełniania dziur w środku.
  var result = scanMaxNumberAndRowFromSheet_();
  var next = result.max + 1;
  if (increment) {
    setStoredMaxNumber_(next);
    if (result.row > 0 && result.sheetName) {
      setStoredLastRow_(result.row, result.sheetName);
    }
  }
  return next;
}

function getPreviewNumber_() {
  return resolveNextTransportNumber_(false);
}

function allocateNextNumber_() {
  return resolveNextTransportNumber_(true);
}

/** Ręczny numer z POST (body.numer) ma pierwszeństwo; pusty → kolejny automatyczny. */
function resolveTransportNumber_(body) {
  var manual = body && body.numer != null ? String(body.numer).trim() : '';
  if (manual === '') {
    return allocateNextNumber_();
  }
  var parsed = parseNumberFromCell_(manual);
  if (parsed != null) {
    var max = ensureStoredMaxNumberSeeded_();
    if (parsed > max) {
      setStoredMaxNumber_(parsed);
    }
  }
  return manual;
}

function computeNextNumber() {
  return getPreviewNumber_();
}

/** Checkbox trasy dopisuje klucz `trasa`, także gdy nazwa albo stawka jest pusta. */
function bodyHasRoute_(body) {
  return !!body && Object.prototype.hasOwnProperty.call(body, 'trasa');
}

function cellIsEmpty_(value) {
  return value == null || String(value).trim() === '';
}

/**
 * Przed dopisaniem jakiegokolwiek wiersza protokołu, także bez trasy.
 * Puste komórki 10–20 dostają tekst nagłówka. Wypełnionych nie nadpisuje.
 * Na układzie V1/V2 nie dopisuje nagłówków V3 — to psuje arkusz.
 * W tym samym kroku, raz: lista `tak` / `nie` na kolumnie 10 i przekreślenie wiersza z `nie`.
 */
function ensureTransportRegisterColumns_(sheet) {
  if (isRegisterLayoutV1_(sheet) || isRegisterLayoutV2_(sheet)) {
    return;
  }
  var width = REGISTER_HEADERS_10_20.length;
  var range = sheet.getRange(1, COL.transportOdbył, 1, width);
  var current = range.getValues()[0];
  var next = [];
  var changed = false;
  for (var i = 0; i < width; i++) {
    var cell = current.length > i ? current[i] : '';
    if (cellIsEmpty_(cell)) {
      next.push(REGISTER_HEADERS_10_20[i]);
      changed = true;
    } else {
      next.push(cell);
    }
  }
  if (changed) {
    range.setValues([next]);
  }
  ensureTransportHappenedRules_(sheet);
}

/** V3: kolumna 10 = transport się odbył, kolumna 11 = Trasa. */
function isRegisterLayoutV3_(sheet) {
  return (
    settlementText_(sheet.getRange(1, COL.transportOdbył).getValue()) === 'transport się odbył' &&
    settlementText_(sheet.getRange(1, COL.trasa).getValue()) === 'Trasa'
  );
}

/**
 * V2: kolumna 10 = Trasa, kolumna 12 = Stawka za podjazd (pozycje historyczne, nie COL).
 */
function isRegisterLayoutV2_(sheet) {
  if (isRegisterLayoutV3_(sheet)) {
    return false;
  }
  return (
    settlementText_(sheet.getRange(1, 10).getValue()) === 'Trasa' &&
    settlementText_(sheet.getRange(1, 12).getValue()) === REGISTER_LAYOUT_V2_MARKER
  );
}

/**
 * V1 / stan pośredni: komentarze nadal w 10–11 albo Trasa nadal w 12.
 * Dopisane puste nagłówki komentarzy w 19–20 nie oznaczają V2/V3.
 */
function isRegisterLayoutV1_(sheet) {
  if (isRegisterLayoutV3_(sheet) || isRegisterLayoutV2_(sheet)) {
    return false;
  }
  var h10 = settlementText_(sheet.getRange(1, 10).getValue());
  var h12 = settlementText_(sheet.getRange(1, 12).getValue());
  if (h10.indexOf('Komentarz') === 0) {
    return true;
  }
  if (h12 === 'Trasa') {
    return true;
  }
  return false;
}

function dataValidationHasTakNie_(validation) {
  if (!validation || typeof validation.getCriteriaValues !== 'function') {
    return false;
  }
  var values = validation.getCriteriaValues();
  var list = values && values.length ? values[0] : [];
  if (!list || !list.length) {
    return false;
  }
  var hasTak = false;
  var hasNie = false;
  for (var i = 0; i < list.length; i++) {
    var item = String(list[i]).trim();
    if (item === 'tak') {
      hasTak = true;
    }
    if (item === 'nie') {
      hasNie = true;
    }
  }
  return hasTak && hasNie;
}

function sheetHasNieStrikeRule_(sheet) {
  var rules = sheet.getConditionalFormatRules();
  var expected = TRANSPORT_HAPPENED_STRIKE_FORMULA.replace(/\s/g, '');
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (!rule || typeof rule.getBooleanCondition !== 'function') {
      continue;
    }
    var condition = rule.getBooleanCondition();
    if (!condition || typeof condition.getCriteriaValues !== 'function') {
      continue;
    }
    var values = condition.getCriteriaValues();
    var formula = values && values.length ? String(values[0]) : '';
    if (formula.replace(/\s/g, '') === expected) {
      return true;
    }
  }
  return false;
}

function ensureTransportHappenedRules_(sheet) {
  var gridRows = sheet.getMaxRows() < 2 ? 1 : sheet.getMaxRows() - 1;
  if (!dataValidationHasTakNie_(sheet.getRange(2, COL.transportOdbył).getDataValidation())) {
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['tak', 'nie'], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, COL.transportOdbył, gridRows, 1).setDataValidation(validation);
  }
  if (!sheetHasNieStrikeRule_(sheet)) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(TRANSPORT_HAPPENED_STRIKE_FORMULA)
      .setStrikethrough(true)
      .setRanges([sheet.getRange(2, 1, gridRows, COL.komentarz2)])
      .build();
    var rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);
  }
}

/**
 * Ten sam tekst w kolumnie Trasa na jednej zakładce.
 * Rozliczony `tak` pomija. Kolumny kosztu nie są w tym zapisie.
 */
function applyRouteRateToSheetUnsettled_(sheet, name, rate, trasaCol, stawkaCol, rozliczonyCol) {
  var wanted = String(name == null ? '' : name).trim();
  if (!wanted || !sheet) {
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  var numRows = lastRow - 1;
  var names = sheet.getRange(2, trasaCol, numRows, 1).getValues();
  var settled = sheet.getRange(2, rozliczonyCol, numRows, 1).getValues();
  var next = rate == null ? '' : String(rate).trim();
  var i;
  for (i = 0; i < numRows; i++) {
    var rowName = String(names[i][0] == null ? '' : names[i][0]).trim();
    if (rowName !== wanted) {
      continue;
    }
    var flag = String(settled[i][0] == null ? '' : settled[i][0]).trim().toLowerCase();
    if (flag === 'tak') {
      continue;
    }
    sheet.getRange(i + 2, stawkaCol).setValue(next);
  }
}

/**
 * Stawka trasy na wszystkich zakładkach Na zgłoszenie (legacy + miesięczne).
 * Lock trzyma `doPost`, tak jak przy numerze protokołu.
 */
function applyRouteRateToUnsettled_(sheet, name, rate) {
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    applyRouteRateToSheetUnsettled_(
      sheets[s].sheet,
      name,
      rate,
      COL.trasa,
      COL.stawkaTrasy,
      COL.rozliczony,
    );
  }
  if (sheet && sheets.length === 0) {
    applyRouteRateToSheetUnsettled_(sheet, name, rate, COL.trasa, COL.stawkaTrasy, COL.rozliczony);
  }
}

/** Stawka trasy na wszystkich zakładkach Harmonogram (legacy + miesięczne). */
function applyRouteRateToScheduleUnsettled_(name, rate) {
  var sheets = listRegisterSheets_('schedule');
  var s;
  for (s = 0; s < sheets.length; s++) {
    applyRouteRateToSheetUnsettled_(
      sheets[s].sheet,
      name,
      rate,
      SCHEDULE_COL.trasa,
      SCHEDULE_COL.stawkaTrasy,
      SCHEDULE_COL.rozliczony,
    );
  }
}

/**
 * Snapshot stawek podjazdu i worka z Bazy stawek na dzień odbioru.
 * Remis albo brak pary → puste komórki (koszt 0 w rozliczeniach).
 */
function resolveRegisterRateSnapshot_(shop, contractor, pickupDate) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET_NAME);
  if (!sheet) {
    return { pickup: '', bag: '' };
  }
  return resolveSnapshotFromRateList_(listRateAmountRows_(sheet), shop, contractor, pickupDate);
}

function resolveSnapshotFromRateList_(rates, shop, contractor, pickupDate) {
  var empty = { pickup: '', bag: '' };
  if (!shop || !contractor || !pickupDate || !rates || !rates.length) {
    return empty;
  }
  var shopKey = normalizeRateShopKey_(shop);
  var matching = [];
  var i;
  for (i = 0; i < rates.length; i++) {
    var rate = rates[i];
    if (normalizeRateShopKey_(rate.shop) !== shopKey || rate.contractor !== contractor) {
      continue;
    }
    if (!approveRateApplies_(rate.validFrom, pickupDate)) {
      continue;
    }
    matching.push(rate);
  }
  if (matching.length === 0) {
    return empty;
  }
  var best = matching[0].validFrom;
  for (i = 1; i < matching.length; i++) {
    if (approveCompareFrom_(matching[i].validFrom, best) > 0) {
      best = matching[i].validFrom;
    }
  }
  var winners = [];
  for (i = 0; i < matching.length; i++) {
    if (matching[i].validFrom === best) {
      winners.push(matching[i]);
    }
  }
  if (winners.length !== 1) {
    return empty;
  }
  return {
    pickup: winners[0].pickup == null || winners[0].pickup === '' ? '' : winners[0].pickup,
    bag: winners[0].bag == null || winners[0].bag === '' ? '' : winners[0].bag,
  };
}

function appendTransportRow_(numer, body) {
  var dataOdbioru = body.dataOdbioru || '';
  var sheet = getOrCreateMonthRegisterSheet_('report', dataOdbioru);
  var adres = body.adresSklepu || '';
  var kto = body.ktoOdbiera || '';
  var pickupDate = settlementDateText_(dataOdbioru) || '';
  var snapshot = resolveRegisterRateSnapshot_(cellStr_(adres), cellStr_(kto), pickupDate);
  var routeName = '';
  var routeRate = '';
  if (bodyHasRoute_(body)) {
    routeName = body.trasa == null ? '' : String(body.trasa).trim();
    routeRate = body.stawkaTrasy == null ? '' : sheetRateWriteValue_(body.stawkaTrasy);
  }
  var row = [
    numer,
    adres,
    body.podmiotHandlowy || '',
    body.sklep || '',
    dataOdbioru,
    kto,
    body.miejsceZrzutu || '',
    body.rodzajZbiorki || '',
    body.iloscWorkow != null ? body.iloscWorkow : '',
    '',
    routeName,
    routeRate,
    sheetRateWriteValue_(snapshot.pickup),
    sheetRateWriteValue_(snapshot.bag),
    '',
    '',
    '',
    '',
    body.komentarz1 || '',
    body.komentarz2 || '',
  ];
  sheet.appendRow(row);
  if (bodyHasRoute_(body) && routeRate !== '') {
    applyRouteRateToUnsettled_(sheet, routeName, routeRate);
  }
  var parsed = parseNumberFromCell_(numer);
  var stored = getStoredMaxNumber_();
  if (parsed != null && stored != null && parsed === stored) {
    setStoredLastRow_(sheet.getLastRow(), sheet.getName());
  }
}

function rowMatchesShop_(rowPodmiot, rowAdres, podmiot, adres) {
  var targetKey = buildTransportShopKey_(podmiot, adres);
  if (!targetKey || targetKey === '\0') {
    return false;
  }
  return buildTransportShopKey_(rowPodmiot, rowAdres) === targetKey;
}

/**
 * Od adresu do kolumny 10 (transport się odbył). Komórki poza siatką nie ma w wierszu: to samo co pusta.
 * `nie` nie wchodzi w ostatnią datę. Inna wartość, także pusta, zostaje odbiorem.
 */
function readTransportPickupRows_(sheet, lastRow) {
  var width = COL.transportOdbył - COL.adres + 1;
  return sheet.getRange(2, COL.adres, lastRow, width).getValues();
}

function transportDidNotHappen_(row) {
  var idx = COL.transportOdbył - COL.adres;
  var value = row && idx < row.length ? row[idx] : '';
  return String(value == null ? '' : value).trim().toLowerCase() === 'nie';
}

/**
 * Jednorazowy skan arkusza: klucz sklepu → { ms, ktoOdbiera } z wiersza o max dacie odbioru.
 * Przy tej samej dacie wygrywa późniejszy wiersz (kolejność w arkuszu).
 * Wiersz z kolumną 10 = `nie` nie ustawia daty odcięcia.
 */
function buildBulkLastTransportDatesMap_() {
  var result = {};
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var rows = readTransportPickupRows_(sheet, lastRow);
    var i;
    for (i = 0; i < rows.length; i++) {
      if (transportDidNotHappen_(rows[i])) {
        continue;
      }
      var rowAdres = rows[i][0];
      var rowPodmiot = rows[i][1];
      var rowData = rows[i][3];
      var rowKto = rows[i][4];
      var key = buildTransportShopKey_(rowPodmiot, rowAdres);
      if (!key || key === '\0') {
        continue;
      }
      var ms = parseDateToMs_(rowData);
      if (ms == null) {
        continue;
      }
      var prev = result[key];
      if (prev == null || ms >= prev.ms) {
        result[key] = {
          ms: ms,
          ktoOdbiera: String(rowKto || '').trim(),
        };
      }
    }
  }
  return result;
}

function buildBulkLastTransportDatesResponse_() {
  var raw = buildBulkLastTransportDatesMap_();
  var shops = [];
  var keys = Object.keys(raw);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var entry = raw[key];
    var ms = entry.ms;
    shops.push({
      key: key,
      lastTransportDateMs: ms,
      lastTransportDateYmd: formatYmdFromMs_(ms),
      lastKtoOdbiera: entry.ktoOdbiera || '',
    });
  }
  return { ok: true, shops: shops };
}

/** @returns {{ ms: number, ktoOdbiera: string }|null} Wiersz z kolumną 10 = `nie` nie jest ostatnim odbiorem. */
function findLastTransportInfo_(podmiot, adres) {
  if (!normalizeTransportKeyPart_(adres)) {
    return null;
  }
  var best = null;
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var rows = readTransportPickupRows_(sheet, lastRow);
    var i;
    for (i = 0; i < rows.length; i++) {
      if (transportDidNotHappen_(rows[i])) {
        continue;
      }
      var rowAdres = rows[i][0];
      var rowPodmiot = rows[i][1];
      var rowData = rows[i][3];
      var rowKto = rows[i][4];
      if (!rowMatchesShop_(rowPodmiot, rowAdres, podmiot, adres)) {
        continue;
      }
      var ms = parseDateToMs_(rowData);
      if (ms != null && (best == null || ms >= best.ms)) {
        best = {
          ms: ms,
          ktoOdbiera: String(rowKto || '').trim(),
        };
      }
    }
  }
  return best;
}

function findLastTransportDateMs_(podmiot, adres) {
  var info = findLastTransportInfo_(podmiot, adres);
  return info ? info.ms : null;
}

function buildTransportShopKey_(podmiot, adres) {
  return normalizeTransportKeyPart_(podmiot) + '\0' + normalizeTransportKeyPart_(adres);
}

function normalizeTransportKeyPart_(text) {
  var s = normalizeRateShopKey_(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  s = s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/Ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/Ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/Ę/g, 'e')
    .replace(/ń/g, 'n')
    .replace(/Ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/Ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/Ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/Ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/Ż/g, 'z');
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSerialDateToMs_(serial) {
  if (!isFinite(serial) || serial < 20000 || serial > 80000) {
    return null;
  }
  var ms = (serial - 25569) * 86400000;
  var d = new Date(ms);
  if (isNaN(d.getTime())) {
    return null;
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDateToMs_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number' && isFinite(value)) {
    return parseSerialDateToMs_(value);
  }
  var s = String(value || '').trim();
  if (!s) {
    return null;
  }
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return Date.UTC(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  }
  var dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    var y = parseInt(dmy[3], 10);
    if (y < 100) {
      y = y >= 70 ? 1900 + y : 2000 + y;
    }
    return Date.UTC(y, parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
  }
  if (/^\d{5,6}$/.test(s)) {
    var serialMs = parseSerialDateToMs_(parseInt(s, 10));
    if (serialMs != null) {
      return serialMs;
    }
  }
  var parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    var d = new Date(parsed);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function formatYmdFromMs_(ms) {
  var d = new Date(ms);
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function cellStr_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/** PL locale: "50,39196" → 50.39196 (parseFloat stops at comma otherwise). */
function parseCoord_(raw) {
  if (raw == null || raw === '') {
    return NaN;
  }
  if (typeof raw === 'number') {
    return raw;
  }
  return parseFloat(String(raw).trim().replace(',', '.'));
}

function normalizeNip_(value) {
  var s = cellStr_(value);
  if (!s) {
    return '';
  }
  s = s.replace(/^\s*nip\s*:?\s*/i, '').replace(/^\s*pl\s*/i, '').replace(/\s/g, '');
  if (/^\d{10}$/.test(s)) {
    return s;
  }
  var digits = s.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  return s;
}

function normalizeBdo_(value) {
  return cellStr_(value);
}

function formatPodwykoDaneForWord_(nazwaDoProtokolu, adres, nip, bdo) {
  var parts = [];
  var nazwa = cellStr_(nazwaDoProtokolu);
  var adr = cellStr_(adres);
  var n = normalizeNip_(nip);
  var b = normalizeBdo_(bdo);
  if (nazwa) {
    parts.push(nazwa);
  }
  if (adr) {
    parts.push(adr);
  }
  if (b) {
    parts.push(/^bdo\b/i.test(b) ? b : 'BDO ' + b);
  }
  if (n) {
    parts.push(/^nip\b/i.test(n) ? n : 'NIP ' + n);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function resolvePodwykoDaneFromBody_(body) {
  var nazwa =
    cellStr_(body && body.nazwa) ||
    cellStr_(body && body.label) ||
    cellStr_(body && body.nazwaWyswietlana);
  var nazwaDoProtokolu = cellStr_(body && body.nazwaDoProtokolu);
  var adres = cellStr_(body && body.adres);
  var nip = body && body.nip;
  var bdo = body && body.bdo;
  if (nazwaDoProtokolu || adres || nip || bdo) {
    return formatPodwykoDaneForWord_(nazwaDoProtokolu || nazwa, adres, nip, bdo);
  }
  return cellStr_(body && body.dane);
}

function ensureRefPrzTextColumns_(sheet) {
  if (!sheet) {
    return;
  }
  var maxRows = sheet.getMaxRows();
  sheet.getRange(2, REF_PRZ_NIP_COL, maxRows, 1).setNumberFormat('@');
  sheet.getRange(2, REF_PRZ_BDO_COL, maxRows, 1).setNumberFormat('@');
}

function writeRefPrzIdentifierCells_(sheet, row, nip, bdo) {
  if (nip) {
    sheet.getRange(row, REF_PRZ_NIP_COL).setNumberFormat('@').setValue(String(nip));
  }
  if (bdo) {
    sheet.getRange(row, REF_PRZ_BDO_COL).setNumberFormat('@').setValue(String(bdo));
  }
}

function getOrCreateRefSheet_(sheetName, headerRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    return sheet;
  }
  sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  return sheet;
}

/** Dopina brakujące kolumny nagłówka (np. Województwo) bez ruszania istniejących danych. */
function ensureRefSheetHeader_(sheet, headerRow) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet.getRange(1, 1, 1, Math.max(lastCol, headerRow.length)).getValues()[0];
  var changed = false;
  for (var i = 0; i < headerRow.length; i++) {
    var want = headerRow[i];
    var have = existing[i] != null ? String(existing[i]).trim() : '';
    if (have !== want) {
      existing[i] = want;
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, headerRow.length).setValues([existing.slice(0, headerRow.length)]);
  }
  return sheet;
}

function getOrCreateRefPoprawSheet_() {
  var sheet = getOrCreateRefSheet_(REF_POPRAW_SHEET_NAME, REF_POPRAW_HEADER);
  return ensureRefSheetHeader_(sheet, REF_POPRAW_HEADER);
}

function getOrCreateRefPrzSheet_() {
  var sheet = getOrCreateRefSheet_(REF_PRZ_SHEET_NAME, REF_PRZ_HEADER);
  ensureRefPrzTextColumns_(sheet);
  return sheet;
}

function refPrzKey_(label) {
  return String(label || '').trim().toLowerCase();
}

function refDosKey_(nazwa, dane) {
  return refPrzKey_(nazwa) + '|' + String(dane || '').trim().toLowerCase();
}

function refPoprawKey_(adres, podmiot, sklep) {
  return (
    normalizeTransportKeyPart_(adres) +
    '\0' +
    normalizeTransportKeyPart_(podmiot) +
    '\0' +
    normalizeTransportKeyPart_(sklep)
  );
}

function listReferencePrzewoznicy_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REF_PRZ_SHEET_NAME);
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var numDataRows = lastRow - 1;
  var lastCol = Math.max(sheet.getLastColumn(), REF_PRZ_HEADER.length);
  var values = sheet.getRange(2, 1, numDataRows, lastCol).getValues();
  var display = sheet.getRange(2, 1, numDataRows, lastCol).getDisplayValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = display[i];
    var label = cellStr_(r[0]);
    if (!label) {
      continue;
    }
    out.push({
      nazwaWyswietlana: label,
      nazwaDoProtokolu: cellStr_(r[1]) || label,
      adres: cellStr_(r[2]),
      nip: normalizeNip_(d[3] !== '' && d[3] != null ? d[3] : r[3]),
      bdo: normalizeBdo_(d[4] !== '' && d[4] != null ? d[4] : r[4]),
    });
  }
  return out;
}

function normalizePodwykoEntry_(nazwa, dane) {
  nazwa = cellStr_(nazwa);
  dane = cellStr_(dane);
  if (!nazwa && !dane) {
    return null;
  }
  if (!nazwa) {
    nazwa = dane.length > 100 ? dane.slice(0, 99).trim() + '…' : dane;
  }
  if (!dane) {
    dane = nazwa;
  }
  return { nazwa: nazwa, dane: dane };
}

function listReferencePodwykoSheet_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var numDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numDataRows, REF_PODWYKO_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var entry = normalizePodwykoEntry_(values[i][0], values[i][1]);
    if (entry) {
      out.push(entry);
    }
  }
  return out;
}

function listReferenceDostawa_() {
  return listReferencePodwykoSheet_(REF_DOS_SHEET_NAME);
}

function mergeReferencePodwykoLista_() {
  var seen = {};
  var out = [];
  function pushEntry(nazwa, dane) {
    var entry = normalizePodwykoEntry_(nazwa, dane);
    if (!entry) {
      return;
    }
    var key = refDosKey_(entry.nazwa, entry.dane);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    out.push(entry);
  }

  listReferencePodwykoSheet_(REF_PODWYKO_SHEET_NAME).forEach(function(item) {
    pushEntry(item.nazwa, item.dane);
  });
  listReferencePrzewoznicy_().forEach(function(item) {
    pushEntry(item.nazwaWyswietlana, item.nazwaDoProtokolu || item.nazwaWyswietlana);
  });
  listReferenceDostawa_().forEach(function(item) {
    pushEntry(item.nazwa, item.dane);
  });
  return out;
}

function listReferencePoprawAdres_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REF_POPRAW_SHEET_NAME);
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var numDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numDataRows, REF_POPRAW_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var adres = cellStr_(r[2]);
    var lat = parseCoord_(r[3]);
    var lon = parseCoord_(r[4]);
    if (!adres || isNaN(lat) || isNaN(lon)) {
      continue;
    }
    out.push({
      podmiotHandlowy: cellStr_(r[0]),
      sklep: cellStr_(r[1]),
      adres: adres,
      lat: lat,
      lon: lon,
      uwagi: cellStr_(r[5]),
      updatedAt: cellStr_(r[6]),
      author: cellStr_(r[7]),
      wojewodztwo: cellStr_(r[8]),
    });
  }
  return out;
}

function listReferenceData_() {
  return {
    podwykoLista: mergeReferencePodwykoLista_(),
    poprawAdres: listReferencePoprawAdres_(),
  };
}

function refPrzExists_(sheet, label) {
  var key = refPrzKey_(label);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }
  var numDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numDataRows, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (refPrzKey_(cellStr_(values[i][0])) === key) {
      return true;
    }
  }
  return false;
}

function refDosExists_(sheet, nazwa, dane) {
  var key = refDosKey_(nazwa, dane);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }
  var numDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numDataRows, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (refDosKey_(cellStr_(r[0]), cellStr_(r[1])) === key) {
      return true;
    }
  }
  return false;
}

function findPoprawAdresRow_(sheet, adres, podmiot, sklep) {
  var key = refPoprawKey_(adres, podmiot, sklep);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  var numDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numDataRows, 3).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (
      refPoprawKey_(cellStr_(r[2]), cellStr_(r[0]), cellStr_(r[1])) === key
    ) {
      return i + 2;
    }
  }
  return 0;
}

function normalizeLegacyPodwykoBody_(body, mode) {
  if (mode === 'addReferencePrzewoznik') {
    var label = cellStr_(body && body.nazwaWyswietlana) || cellStr_(body && body.label);
    return {
      nazwa: label,
      nazwaDoProtokolu: cellStr_(body && body.nazwaDoProtokolu) || label,
      adres: cellStr_(body && body.adres),
      nip: body && body.nip,
      bdo: body && body.bdo,
    };
  }
  return {
    nazwa: cellStr_(body && body.nazwa) || cellStr_(body && body.label),
    nazwaDoProtokolu: cellStr_(body && body.nazwaDoProtokolu),
    adres: cellStr_(body && body.adres),
    nip: body && body.nip,
    bdo: body && body.bdo,
    dane: cellStr_(body && body.dane),
  };
}

function handleAddReferencePodwykoPost_(body) {
  var normalized = body || {};
  var nazwa =
    cellStr_(normalized.nazwa) ||
    cellStr_(normalized.label) ||
    cellStr_(normalized.nazwaWyswietlana);
  var dane = resolvePodwykoDaneFromBody_(normalized);
  var entry = normalizePodwykoEntry_(nazwa, dane);
  if (!entry) {
    throw new Error('nazwa or dane required');
  }
  var sheet = getOrCreateRefSheet_(REF_PODWYKO_SHEET_NAME, REF_PODWYKO_HEADER);
  if (refDosExists_(sheet, entry.nazwa, entry.dane)) {
    return jsonResponse({ ok: false, error: 'duplicate' });
  }
  sheet.appendRow([entry.nazwa, entry.dane]);
  return jsonResponse({
    ok: true,
    entry: entry,
  });
}

function parsePoprawCoords_(body) {
  var lat = parseCoord_(body && body.lat);
  var lon = parseCoord_(body && (body.lon != null ? body.lon : body.lng));
  if (isNaN(lat) || isNaN(lon)) {
    throw new Error('lat and lon required');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('coordinates out of range');
  }
  return { lat: lat, lon: lon };
}

function handleAddPoprawAdresPost_(body) {
  var podmiot = cellStr_(body && body.podmiotHandlowy);
  var sklep = cellStr_(body && body.sklep);
  var adres = cellStr_(body && body.adres);
  var uwagi = cellStr_(body && body.uwagi);
  var wojewodztwo = cellStr_(body && body.wojewodztwo);
  var coords = parsePoprawCoords_(body);
  if (!adres) {
    throw new Error('adres required');
  }
  var sheet = getOrCreateRefPoprawSheet_();
  var existingRow = findPoprawAdresRow_(sheet, adres, podmiot, sklep);
  var now = new Date().toISOString();
  var author = Session.getActiveUser().getEmail() || '';
  var rowValues = [
    podmiot,
    sklep,
    adres,
    coords.lat,
    coords.lon,
    uwagi,
    now,
    author,
    wojewodztwo,
  ];
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, REF_POPRAW_HEADER.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return jsonResponse({
    ok: true,
    entry: {
      podmiotHandlowy: podmiot,
      sklep: sklep,
      adres: adres,
      lat: coords.lat,
      lon: coords.lon,
      uwagi: uwagi,
      updatedAt: now,
      author: author,
      wojewodztwo: wojewodztwo,
    },
  });
}

function isAllDigits_(text) {
  var i;
  if (!text) {
    return false;
  }
  for (i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

function normalizeRateDate_(text) {
  var raw = String(text == null ? '' : text).trim();
  if (!raw) {
    return '';
  }
  var parts = raw.split('.');
  if (parts.length !== 3) {
    return null;
  }
  if (!isAllDigits_(parts[0]) || parts[0].length > 2) {
    return null;
  }
  if (!isAllDigits_(parts[1]) || parts[1].length > 2) {
    return null;
  }
  if (!isAllDigits_(parts[2]) || parts[2].length !== 4) {
    return null;
  }
  var day = Number(parts[0]);
  var month = Number(parts[1]);
  var year = Number(parts[2]);
  if (day < 1 || month < 1 || month > 12 || year < 1000) {
    return null;
  }
  var checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day
  ) {
    return null;
  }
  var dayText = day < 10 ? '0' + String(day) : String(day);
  var monthText = month < 10 ? '0' + String(month) : String(month);
  return dayText + '.' + monthText + '.' + String(year);
}

function parseRateAmount_(text) {
  if (text == null) {
    return { empty: true };
  }
  var raw = String(text).trim().replace(',', '.');
  if (!raw) {
    return { empty: true };
  }
  var dot = raw.indexOf('.');
  if (dot >= 0 && raw.indexOf('.', dot + 1) >= 0) {
    return null;
  }
  var whole = dot < 0 ? raw : raw.slice(0, dot);
  var frac = dot < 0 ? '' : raw.slice(dot + 1);
  if (dot >= 0 && frac.length === 0) {
    return null;
  }
  if (!isAllDigits_(whole)) {
    return null;
  }
  if (frac && (!isAllDigits_(frac) || frac.length > 2)) {
    return null;
  }
  var value = Number(raw);
  if (value !== value || value === Infinity) {
    return null;
  }
  return { empty: false, value: value };
}

function rateAmountCell_(amount) {
  if (amount.empty) {
    return '';
  }
  return amount.value;
}

function normalizeRateShopKey_(text) {
  var s = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (!s) {
    return '';
  }
  s = s.replace(/(^|[\s,])(ul\.?|ulica|al\.?|aleja|alei|pl\.?|plac)\s+/gi, '$1');
  s = s.replace(/(^|[\s,])(gen|ks|kard|sw|św)\.(?=[\p{L}])/giu, function (_m, lead, abbr) {
    var lower = String(abbr).toLowerCase();
    if (lower.indexOf('gen') === 0) {
      return lead + 'Generała ';
    }
    if (lower.indexOf('ks') === 0) {
      return lead + 'Księdza ';
    }
    if (lower.indexOf('kard') === 0) {
      return lead + 'Kardynała ';
    }
    return lead + 'Świętego ';
  });
  s = s.replace(/(^|[\s,])gen\.\s*/gi, '$1Generała ');
  s = s.replace(/(^|[\s,])ks\.\s*/gi, '$1Księdza ');
  s = s.replace(/(^|[\s,])kard\.\s*/gi, '$1Kardynała ');
  s = s.replace(/(^|[\s,])sw\.\s*/gi, '$1Świętego ');
  s = s.replace(/(^|[\s,])św\.\s*/gi, '$1Świętego ');
  return s.toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
}

function decideSaveRate_(rows, shop, contractor, validFrom) {
  var shopKey = normalizeRateShopKey_(shop);
  var matches = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (
      normalizeRateShopKey_(row.shop) === shopKey &&
      row.contractor === contractor &&
      row.validFrom === validFrom
    ) {
      matches.push(row.row);
    }
  }
  if (matches.length >= 1) {
    return { action: 'overwrite', row: matches[0], rows: matches };
  }
  return { action: 'append' };
}

function rateCellDateKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return normalizeRateDate_(value.getDate() + '.' + (value.getMonth() + 1) + '.' + value.getFullYear());
  }
  return normalizeRateDate_(value);
}

/** Wiersze decyzji overwrite (jeden lub kilka wariantów tego samego adresu). */
function saveRateTargetRows_(decision) {
  if (decision.rows && decision.rows.length) {
    return decision.rows;
  }
  return [decision.row];
}

function listRateRows_(sheet) {
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, 5).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var dateKey = rateCellDateKey_(values[i][4]);
    rows.push({
      row: i + 2,
      shop: cellStr_(values[i][0]),
      contractor: cellStr_(values[i][1]),
      validFrom: dateKey == null ? '\u0000' : dateKey,
    });
  }
  return rows;
}

/** Jak listRateRows_, plus surowe wartości kwot z kolumn 3–4 (do snapshotu rejestru). */
function listRateAmountRows_(sheet) {
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, 5).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var dateKey = rateCellDateKey_(values[i][4]);
    rows.push({
      row: i + 2,
      shop: cellStr_(values[i][0]),
      contractor: cellStr_(values[i][1]),
      pickup: values[i][2],
      bag: values[i][3],
      validFrom: dateKey == null ? '\u0000' : dateKey,
    });
  }
  return rows;
}

function getOrCreateRateSheet_() {
  var name = 'Baza stawek';
  var header = ['Sklep', 'Podwykonawca', 'Kwota za podjazd', 'Kwota za worek', 'Od kiedy obowiązuje'];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existed = ss.getSheetByName(name) != null;
  var sheet = getOrCreateRefSheet_(name, header);
  if (!existed) {
    sheet.getRange(1, 5, sheet.getMaxRows(), 1).setNumberFormat('@');
  }
  return sheet;
}

function handleSaveRatePost_(body) {
  var shop = cellStr_(body && body.sklep);
  var contractor = cellStr_(body && body.podwykonawca);
  if (!shop || !contractor) {
    return jsonResponse({ ok: false, error: 'shop' });
  }
  var validFrom = normalizeRateDate_(body && body.odKiedy);
  if (validFrom === null) {
    return jsonResponse({ ok: false, error: 'date' });
  }
  var pickup = parseRateAmount_(body && body.kwotaPodjazd);
  var bag = parseRateAmount_(body && body.kwotaWorek);
  if (!pickup || !bag) {
    return jsonResponse({ ok: false, error: 'amount' });
  }
  var sheet = getOrCreateRateSheet_();
  var decision = decideSaveRate_(listRateRows_(sheet), shop, contractor, validFrom);
  var pickupCell = rateAmountCell_(pickup);
  var bagCell = rateAmountCell_(bag);
  if (decision.action === 'overwrite') {
    var targetRows = saveRateTargetRows_(decision);
    var ti;
    for (ti = 0; ti < targetRows.length; ti++) {
      var rowNum = targetRows[ti];
      sheet.getRange(rowNum, 1).setValue(shop);
      sheet.getRange(rowNum, 3, 1, 2).setValues([[pickupCell, bagCell]]);
    }
    return jsonResponse({ ok: true, action: 'overwrite', rows: targetRows.length });
  }
  var next = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(next, 5).setNumberFormat('@');
  sheet.getRange(next, 1, 1, 5).setValues([[shop, contractor, pickupCell, bagCell, validFrom]]);
  sheet.getRange(next, 5).setNumberFormat('@').setValue(String(validFrom));
  return jsonResponse({ ok: true, action: 'append' });
}

function getOrCreateHarmonogramRateSheet_() {
  var sheet = getOrCreateRefSheet_(HARMONOGRAM_RATE_SHEET_NAME, HARMONOGRAM_RATE_HEADERS);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet.getRange(1, 1, 1, Math.max(lastCol, HARMONOGRAM_RATE_HEADERS.length)).getValues()[0];
  var hasHeader = false;
  var i;
  for (i = 0; i < existing.length; i++) {
    if (String(existing[i] == null ? '' : existing[i]).trim()) {
      hasHeader = true;
      break;
    }
  }
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, HARMONOGRAM_RATE_HEADERS.length).setValues([HARMONOGRAM_RATE_HEADERS]);
  }
  ensureSheetColumn_(sheet, HARMONOGRAM_ID_HEADER);
  return sheet;
}

/** Wiersze Bazy cen: adres + podwykonawca + data z kolumny 7 + dni z kolumny 8. */
function listHarmonogramRateRows_(sheet) {
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, 8).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var dateKey = rateCellDateKey_(values[i][6]);
    rows.push({
      row: i + 2,
      shop: cellStr_(values[i][0]),
      contractor: cellStr_(values[i][1]),
      validFrom: dateKey == null ? '\u0000' : dateKey,
      days: cellStr_(values[i][7]),
    });
  }
  return rows;
}

/**
 * Przy istniejącym połączeniu sklep + podwykonawca aktualizuje „Dni odbiorów”
 * tylko gdy się zmieniły — na każdym wierszu tej pary (cen nie rusza).
 * Adres porównuje po normalizacji (al./pl./Św.); przy różnicy ustawia kanoniczny z mapy.
 */
function updateHarmonogramDaysIfChanged_(sheet, rows, shop, contractor, days) {
  var shopKey = normalizeRateShopKey_(shop);
  var updated = 0;
  var i;
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeRateShopKey_(row.shop) !== shopKey || row.contractor !== contractor) {
      continue;
    }
    if (row.shop !== shop) {
      sheet.getRange(row.row, 1).setValue(shop);
    }
    if (row.days === days) {
      continue;
    }
    var prevDays = canonicalHarmonogramDays_(row.days);
    var nextDays = canonicalHarmonogramDays_(days);
    sheet.getRange(row.row, 8).setValue(days);
    if (prevDays !== nextDays) {
      var idCol = ensureSheetColumn_(sheet, HARMONOGRAM_ID_HEADER);
      sheet.getRange(row.row, idCol).setValue('');
    }
    updated += 1;
  }
  return updated;
}

/**
 * Jak listHarmonogramRateRows_, plus kwoty i nazwa trasy (do snapshotu zestawienia).
 */
function listHarmonogramRateAmountRows_(sheet) {
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, 8).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var dateKey = rateCellDateKey_(values[i][6]);
    rows.push({
      row: i + 2,
      shop: cellStr_(values[i][0]),
      contractor: cellStr_(values[i][1]),
      routeName: cellStr_(values[i][2]),
      pickup: values[i][3],
      bag: values[i][4],
      routeAmount: values[i][5],
      validFrom: dateKey == null ? '\u0000' : dateKey,
    });
  }
  return rows;
}

/**
 * Najnowsza stawka z Bazy cen obowiązująca na dzień odbioru (jak sync zestawienia).
 * Remis tej samej daty → pierwsza trafiona. Brak pary → puste.
 */
function resolveHarmonogramSnapshot_(rates, shop, contractor, pickupDate) {
  var empty = { routeName: '', route: '', pickup: '', bag: '' };
  if (!shop || !contractor || !pickupDate || !rates || !rates.length) {
    return empty;
  }
  var shopFold = settlementFoldPl_(shop);
  var whoFold = settlementFoldPl_(contractor);
  var best = null;
  var i;
  for (i = 0; i < rates.length; i++) {
    var rate = rates[i];
    if (settlementFoldPl_(rate.shop) !== shopFold || settlementFoldPl_(rate.contractor) !== whoFold) {
      continue;
    }
    if (rate.validFrom === '\u0000') {
      continue;
    }
    if (rate.validFrom && settlementCompareDate_(rate.validFrom, pickupDate) > 0) {
      continue;
    }
    if (
      !best ||
      settlementCompareDate_(rate.validFrom || '01.01.1900', best.validFrom || '01.01.1900') > 0
    ) {
      best = rate;
    }
  }
  if (!best) {
    return empty;
  }
  return {
    routeName: best.routeName || '',
    route: best.routeAmount == null || best.routeAmount === '' ? '' : best.routeAmount,
    pickup: best.pickup == null || best.pickup === '' ? '' : best.pickup,
    bag: best.bag == null || best.bag === '' ? '' : best.bag,
  };
}

/**
 * Po zapisie Bazy cen: uzupełnia Trasa + stawki na nierozliczonych wierszach
 * rejestru Harmonogram (legacy + miesięczne) dla tej pary sklep+podwykonawca.
 * Zakładek nie zakłada. Rozliczonych nie rusza.
 */
function applyHarmonogramRatesToScheduleRegister_(shop, contractor) {
  var baza = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HARMONOGRAM_RATE_SHEET_NAME);
  if (!baza || !shop || !contractor) {
    return 0;
  }
  var rates = listHarmonogramRateAmountRows_(baza);
  if (!rates.length) {
    return 0;
  }
  var shopFold = settlementFoldPl_(shop);
  var whoFold = settlementFoldPl_(contractor);
  var updated = 0;
  var sheets = listRegisterSheets_('schedule');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var register = sheets[s].sheet;
    var lastRow = register.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var width = Math.max(register.getLastColumn(), SCHEDULE_COL.stawkaWorka);
    var values = register.getRange(2, 1, lastRow - 1, width).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      var mapped = mapSettlementScheduleRegisterRow_(i + 2, values[i], sheets[s].name);
      if (!mapped || mapped.settled) {
        continue;
      }
      if (
        settlementFoldPl_(mapped.address) !== shopFold ||
        settlementFoldPl_(mapped.contractor) !== whoFold
      ) {
        continue;
      }
      var snap = resolveHarmonogramSnapshot_(
        rates,
        mapped.address,
        mapped.contractor,
        mapped.pickupDate,
      );
      register.getRange(i + 2, SCHEDULE_COL.trasa, 1, 4).setValues([
        [
          snap.routeName,
          sheetRateWriteValue_(snap.route),
          sheetRateWriteValue_(snap.pickup),
          sheetRateWriteValue_(snap.bag),
        ],
      ]);
      updated += 1;
    }
  }
  return updated;
}

/**
 * Zapis cen i dni do Bazy cen harmonogram.
 * Ceny: te same reguły klucza co saveRate (adres + podwykonawca + data).
 * Dni: klucz sklep + podwykonawca — aktualizacja tylko gdy się zmieniły.
 * Nazwa trasy + cena za trasę: razem albo obie puste.
 * Pusta para przy overwrite nie czyści istniejących kolumn 3 i 6.
 * Po sukcesie: stawki na nierozliczonych wierszach zestawienia tej pary.
 */
function handleSaveRateHarmonogramPost_(body) {
  var shop = cellStr_(body && body.sklep);
  var contractor = cellStr_(body && body.podwykonawca);
  if (!shop || !contractor) {
    return jsonResponse({ ok: false, error: 'shop' });
  }
  var validFrom = normalizeRateDate_(body && body.odKiedy);
  if (validFrom === null) {
    return jsonResponse({ ok: false, error: 'date' });
  }
  var pickup = parseRateAmount_(body && body.kwotaPodjazd);
  var bag = parseRateAmount_(body && body.kwotaWorek);
  if (!pickup || !bag) {
    return jsonResponse({ ok: false, error: 'amount' });
  }
  var routeName = cellStr_(body && body.nazwaTrasy);
  var routeRate = parseRateAmount_(body && body.kwotaTrasy);
  if (!routeRate) {
    return jsonResponse({ ok: false, error: 'amount' });
  }
  if ((routeName && routeRate.empty) || (!routeName && !routeRate.empty)) {
    return jsonResponse({ ok: false, error: 'route' });
  }
  var days = cellStr_(body && body.dniOdbiorow);
  var sheet = getOrCreateHarmonogramRateSheet_();
  var rows = listHarmonogramRateRows_(sheet);
  var decision = decideSaveRate_(rows, shop, contractor, validFrom);
  var pickupCell = rateAmountCell_(pickup);
  var bagCell = rateAmountCell_(bag);
  var routeRateCell = rateAmountCell_(routeRate);
  var writeRoute = !!(routeName || !routeRate.empty);
  var daysUpdated = updateHarmonogramDaysIfChanged_(sheet, rows, shop, contractor, days);
  if (decision.action === 'overwrite') {
    var targetRows = saveRateTargetRows_(decision);
    var ti;
    for (ti = 0; ti < targetRows.length; ti++) {
      var rowNum = targetRows[ti];
      sheet.getRange(rowNum, 1).setValue(shop);
      if (writeRoute) {
        sheet
          .getRange(rowNum, 3, 1, 4)
          .setValues([[routeName, pickupCell, bagCell, routeRateCell]]);
      } else {
        sheet.getRange(rowNum, 4, 1, 2).setValues([[pickupCell, bagCell]]);
      }
    }
    var overwrittenSchedule = applyHarmonogramRatesToScheduleRegister_(shop, contractor);
    return jsonResponse({
      ok: true,
      action: 'overwrite',
      daysUpdated: daysUpdated,
      rows: targetRows.length,
      scheduleUpdated: overwrittenSchedule,
    });
  }
  var next = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(next, 7).setNumberFormat('@');
  sheet
    .getRange(next, 1, 1, 8)
    .setValues([[shop, contractor, routeName, pickupCell, bagCell, routeRateCell, validFrom, days]]);
  sheet.getRange(next, 7).setNumberFormat('@').setValue(String(validFrom));
  var appendedSchedule = applyHarmonogramRatesToScheduleRegister_(shop, contractor);
  return jsonResponse({
    ok: true,
    action: 'append',
    daysUpdated: daysUpdated,
    scheduleUpdated: appendedSchedule,
  });
}

function collapseText_(value) {
  return cellStr_(value).replace(/\s+/g, ' ');
}

function sheetHeaders_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  if (sheet.getLastRow() < 1) {
    return [];
  }
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function headerIndexNamed_(headers, name) {
  var want = String(name || '').trim().toLowerCase();
  var i;
  for (i = 0; i < headers.length; i++) {
    if (String(headers[i] == null ? '' : headers[i]).trim().toLowerCase() === want) {
      return i;
    }
  }
  return -1;
}

function cellAt_(row, index) {
  if (index < 0 || !row) {
    return '';
  }
  return cellStr_(row[index]);
}

/** Dopina kolumnę po nazwie. Nie przesuwa istniejących nagłówków. */
function ensureSheetColumn_(sheet, name) {
  var headers = sheetHeaders_(sheet);
  var idx = headerIndexNamed_(headers, name);
  if (idx >= 0) {
    return idx + 1;
  }
  var col = Math.max(sheet.getLastColumn(), 0) + 1;
  sheet.getRange(1, col).setValue(name);
  return col;
}

function canonicalHarmonogramDays_(raw) {
  var days = settlementParseWeekdays_(raw);
  var want = {};
  var i;
  for (i = 0; i < days.length; i++) {
    want[days[i]] = true;
  }
  var order = [
    { token: 'pn', jsDay: 1 },
    { token: 'wt', jsDay: 2 },
    { token: 'śr', jsDay: 3 },
    { token: 'cz', jsDay: 4 },
    { token: 'pt', jsDay: 5 },
    { token: 'sb', jsDay: 6 },
    { token: 'nd', jsDay: 0 },
  ];
  var out = [];
  for (i = 0; i < order.length; i++) {
    if (want[order[i].jsDay]) {
      out.push(order[i].token);
    }
  }
  return out.join(', ');
}

function nextHarmonogramId_(existingIds) {
  var max = 0;
  var i;
  for (i = 0; i < existingIds.length; i++) {
    var match = /^H(\d+)$/.exec(collapseText_(existingIds[i]));
    if (!match) {
      continue;
    }
    var value = Number(match[1]);
    if (value > max) {
      max = value;
    }
  }
  var text = String(max + 1);
  while (text.length < 4) {
    text = '0' + text;
  }
  return 'H' + text;
}

function isBolecinPlace_(text) {
  var combined = String(text || '')
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z');
  if (!combined.trim()) {
    return false;
  }
  return combined.indexOf('bolecin') >= 0 || combined.indexOf('biosystem') >= 0;
}

function formatDotDate_(d) {
  var day = d.getDate();
  var month = d.getMonth() + 1;
  var dd = day < 10 ? '0' + String(day) : String(day);
  var mm = month < 10 ? '0' + String(month) : String(month);
  return dd + '.' + mm + '.' + String(d.getFullYear());
}

function harmonogramProposalDates_(daysRaw, today) {
  var tokens = canonicalHarmonogramDays_(daysRaw);
  if (!tokens) {
    return [];
  }
  var parts = tokens.split(', ');
  var jsByToken = { pn: 1, wt: 2, 'śr': 3, cz: 4, pt: 5, sb: 6, nd: 0 };
  var wanted = {};
  var i;
  for (i = 0; i < parts.length; i++) {
    if (jsByToken[parts[i]] !== undefined) {
      wanted[jsByToken[parts[i]]] = true;
    }
  }
  var base = today || new Date();
  var year = base.getFullYear();
  var month = base.getMonth();
  var dayOfMonth = base.getDate();
  var out = [];
  var lastDay = new Date(year, month + 1, 0).getDate();
  var day;
  for (day = dayOfMonth; day <= lastDay; day++) {
    var date = new Date(year, month, day);
    if (wanted[date.getDay()]) {
      out.push(formatDotDate_(date));
    }
  }
  if (dayOfMonth >= INCLUDE_NEXT_MONTH_FROM_DAY) {
    var lastNext = new Date(year, month + 2, 0).getDate();
    for (day = 1; day <= lastNext; day++) {
      var next = new Date(year, month + 1, day);
      if (wanted[next.getDay()]) {
        out.push(formatDotDate_(next));
      }
    }
  }
  return out;
}

function joinHarmonogramLabels_(values) {
  var seen = {};
  var unique = [];
  var i;
  for (i = 0; i < values.length; i++) {
    var label = collapseText_(values[i]);
    if (!label) {
      continue;
    }
    var key = label.toLocaleLowerCase('pl');
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    unique.push(label);
  }
  unique.sort(function(a, b) {
    return a.localeCompare(b, 'pl');
  });
  return unique.join('; ');
}

function bolecinRowIdentity_(adres, data, kto) {
  return (
    collapseText_(adres).toLocaleLowerCase('pl') +
    '\n' +
    collapseText_(data).toLocaleLowerCase('pl') +
    '\n' +
    collapseText_(kto).toLocaleLowerCase('pl')
  );
}

function harmonogramBucketKey_(row) {
  return canonicalHarmonogramDays_(row.dni) + '\n' + collapseText_(row.podwykonawca);
}

function harmonogramSiblingKey_(row) {
  return normalizeRateShopKey_(row.adres) + '\n' + harmonogramBucketKey_(row);
}

function memberMatchesHarmonogram_(shop, group) {
  if (!shop.harmonogramId || shop.harmonogramId !== group.id) {
    return false;
  }
  if (collapseText_(shop.podwykonawca) !== collapseText_(group.podwykonawca)) {
    return false;
  }
  var days = canonicalHarmonogramDays_(shop.dni);
  return days.length > 0 && days === canonicalHarmonogramDays_(group.dni);
}

function collapseHarmonogramShops_(rows) {
  var byAdres = {};
  var order = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var adres = collapseText_(rows[i].adres);
    if (!adres) {
      continue;
    }
    if (!byAdres[adres]) {
      byAdres[adres] = [];
      order.push(adres);
    }
    byAdres[adres].push(rows[i].sheetRow);
  }
  order.sort(function(a, b) {
    return a.localeCompare(b, 'pl');
  });
  var out = [];
  for (i = 0; i < order.length; i++) {
    var list = byAdres[order[i]].slice();
    list.sort(function(a, b) {
      return a - b;
    });
    out.push({ adres: order[i], rows: list });
  }
  return out;
}

function buildHarmonogramList_(shops, groups, today) {
  var byId = {};
  var i;
  for (i = 0; i < groups.length; i++) {
    byId[collapseText_(groups[i].id)] = groups[i];
  }
  var members = {};
  var loose = [];
  for (i = 0; i < shops.length; i++) {
    var shop = shops[i];
    var group = byId[collapseText_(shop.harmonogramId)];
    if (group && memberMatchesHarmonogram_(shop, group)) {
      if (!members[group.id]) {
        members[group.id] = [];
      }
      members[group.id].push(shop);
      continue;
    }
    if (!collapseText_(shop.adres) || !collapseText_(shop.podwykonawca) || !canonicalHarmonogramDays_(shop.dni)) {
      continue;
    }
    loose.push(shop);
  }
  var memberSibling = {};
  var memberId;
  for (memberId in members) {
    if (!Object.prototype.hasOwnProperty.call(members, memberId)) {
      continue;
    }
    var memberRows = members[memberId];
    var mr;
    for (mr = 0; mr < memberRows.length; mr++) {
      memberSibling[harmonogramSiblingKey_(memberRows[mr])] = memberId;
    }
  }
  var stillLoose = [];
  for (i = 0; i < loose.length; i++) {
    var joined = memberSibling[harmonogramSiblingKey_(loose[i])];
    if (!joined) {
      stillLoose.push(loose[i]);
      continue;
    }
    members[joined].push(loose[i]);
  }
  var harmonogramy = [];
  var sortedGroups = groups.slice();
  sortedGroups.sort(function(a, b) {
    return String(a.id).localeCompare(String(b.id), 'pl');
  });
  for (i = 0; i < sortedGroups.length; i++) {
    var item = sortedGroups[i];
    if (!collapseText_(item.id)) {
      continue;
    }
    harmonogramy.push({
      id: item.id,
      podwykonawca: item.podwykonawca,
      dni: canonicalHarmonogramDays_(item.dni),
      cenaTrasy: item.cenaTrasy || '',
      miejsceZrzutu: item.miejsceZrzutu || '',
      oknoAwizacji: item.oknoAwizacji || '',
      awizacja: item.awizacja || '',
      rodzajZbiorki: item.rodzajZbiorki || '',
      rodzajTransportu: item.rodzajTransportu || '',
      spodziewaneWorki: item.spodziewaneWorki || '',
      bolecin: isBolecinPlace_(item.miejsceZrzutu),
      daty: harmonogramProposalDates_(item.dni, today),
      sklepy: collapseHarmonogramShops_(members[item.id] || []),
    });
  }
  var buckets = {};
  var bucketKeys = [];
  for (i = 0; i < stillLoose.length; i++) {
    var key = harmonogramBucketKey_(stillLoose[i]);
    if (!buckets[key]) {
      buckets[key] = [];
      bucketKeys.push(key);
    }
    buckets[key].push(stillLoose[i]);
  }
  bucketKeys.sort(function(a, b) {
    return a.localeCompare(b, 'pl');
  });
  var doZgrupowania = [];
  for (i = 0; i < bucketKeys.length; i++) {
    var rows = buckets[bucketKeys[i]];
    doZgrupowania.push({
      podwykonawca: collapseText_(rows[0].podwykonawca),
      dni: canonicalHarmonogramDays_(rows[0].dni),
      sklepy: collapseHarmonogramShops_(rows),
    });
  }
  return { harmonogramy: harmonogramy, doZgrupowania: doZgrupowania };
}

function selectedShopsForGroup_(shops, rows) {
  var wanted = {};
  var count = 0;
  var i;
  for (i = 0; i < rows.length; i++) {
    var n = Number(rows[i]);
    if (n === Math.floor(n) && n >= 2) {
      wanted[n] = true;
      count += 1;
    }
  }
  if (!count) {
    return { ok: false, error: 'zaznacz' };
  }
  var picked = [];
  for (i = 0; i < shops.length; i++) {
    if (wanted[shops[i].sheetRow]) {
      picked.push(shops[i]);
    }
  }
  if (!picked.length) {
    return { ok: false, error: 'zaznacz' };
  }
  var bucket = harmonogramBucketKey_(picked[0]);
  for (i = 1; i < picked.length; i++) {
    if (harmonogramBucketKey_(picked[i]) !== bucket) {
      return { ok: false, error: 'rozne' };
    }
  }
  var dni = canonicalHarmonogramDays_(picked[0].dni);
  var podwykonawca = collapseText_(picked[0].podwykonawca);
  if (!dni || !podwykonawca) {
    return { ok: false, error: 'brak_dni' };
  }
  var siblings = {};
  for (i = 0; i < picked.length; i++) {
    siblings[harmonogramSiblingKey_(picked[i])] = true;
  }
  var sheetRows = [];
  for (i = 0; i < shops.length; i++) {
    if (siblings[harmonogramSiblingKey_(shops[i])]) {
      sheetRows.push(shops[i].sheetRow);
    }
  }
  sheetRows.sort(function(a, b) {
    return a - b;
  });
  return { ok: true, dni: dni, podwykonawca: podwykonawca, sheetRows: sheetRows };
}

function readHarmonogramShopRows_(sheet) {
  var headers = sheetHeaders_(sheet);
  var adresIx = headerIndexNamed_(headers, 'Adres sklepu');
  var whoIx = headerIndexNamed_(headers, 'Podwykonawca');
  var daysIx = headerIndexNamed_(headers, 'Dni odbiorów');
  var idIx = headerIndexNamed_(headers, HARMONOGRAM_ID_HEADER);
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2 || adresIx < 0 || whoIx < 0 || daysIx < 0) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    rows.push({
      sheetRow: i + 2,
      adres: cellAt_(values[i], adresIx),
      podwykonawca: cellAt_(values[i], whoIx),
      dni: cellAt_(values[i], daysIx),
      harmonogramId: cellAt_(values[i], idIx),
    });
  }
  return rows;
}

function readHarmonogramHeads_(sheet) {
  var headers = sheetHeaders_(sheet);
  var ix = {
    id: headerIndexNamed_(headers, 'Id'),
    podwykonawca: headerIndexNamed_(headers, 'Podwykonawca'),
    dni: headerIndexNamed_(headers, 'Dni odbiorów'),
    cena: headerIndexNamed_(headers, 'Cena za trasę'),
    miejsce: headerIndexNamed_(headers, 'Miejsce zrzutu'),
    okno: headerIndexNamed_(headers, 'Okno awizacji'),
    awizacja: headerIndexNamed_(headers, 'Awizacja'),
    rodzajZbiorki: headerIndexNamed_(headers, 'Rodzaj zbiórki'),
    rodzajTransportu: headerIndexNamed_(headers, 'Rodzaj transportu'),
    worki: headerIndexNamed_(headers, 'Spodziewane worki'),
  };
  var last = sheet.getLastRow();
  var rows = [];
  if (last < 2 || ix.id < 0) {
    return rows;
  }
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var id = cellAt_(values[i], ix.id);
    if (!id) {
      continue;
    }
    rows.push({
      sheetRow: i + 2,
      id: id,
      podwykonawca: cellAt_(values[i], ix.podwykonawca),
      dni: cellAt_(values[i], ix.dni),
      cenaTrasy: cellAt_(values[i], ix.cena),
      miejsceZrzutu: cellAt_(values[i], ix.miejsce),
      oknoAwizacji: cellAt_(values[i], ix.okno),
      awizacja: cellAt_(values[i], ix.awizacja),
      rodzajZbiorki: cellAt_(values[i], ix.rodzajZbiorki),
      rodzajTransportu: cellAt_(values[i], ix.rodzajTransportu),
      spodziewaneWorki: cellAt_(values[i], ix.worki),
    });
  }
  return rows;
}

function getOrCreateHarmonogramySheet_() {
  var sheet = getOrCreateRefSheet_(HARMONOGRAMY_SHEET_NAME, HARMONOGRAMY_HEADERS);
  var i;
  for (i = 0; i < HARMONOGRAMY_HEADERS.length; i++) {
    ensureSheetColumn_(sheet, HARMONOGRAMY_HEADERS[i]);
  }
  return sheet;
}

function listHarmonogramy_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var baza = ss.getSheetByName(HARMONOGRAM_RATE_SHEET_NAME);
  var head = ss.getSheetByName(HARMONOGRAMY_SHEET_NAME);
  var shops = baza ? readHarmonogramShopRows_(baza) : [];
  var groups = head ? readHarmonogramHeads_(head) : [];
  var view = buildHarmonogramList_(shops, groups, new Date());
  return { ok: true, harmonogramy: view.harmonogramy, doZgrupowania: view.doZgrupowania };
}

function rowNumbersFromBody_(body) {
  var raw = body && body.rows;
  var rows = [];
  if (!raw || !raw.length) {
    return rows;
  }
  var i;
  for (i = 0; i < raw.length; i++) {
    var n = Number(raw[i]);
    if (n === Math.floor(n)) {
      rows.push(n);
    }
  }
  return rows;
}

function putHarmonogramCell_(sheet, headers, sheetRow, name, value) {
  var ix = headerIndexNamed_(headers, name);
  if (ix >= 0) {
    sheet.getRange(sheetRow, ix + 1).setValue(value);
  }
}

function handleGroupHarmonogramPost_(body) {
  var baza = getOrCreateHarmonogramRateSheet_();
  var shops = readHarmonogramShopRows_(baza);
  var selection = selectedShopsForGroup_(shops, rowNumbersFromBody_(body));
  if (!selection.ok) {
    return jsonResponse({ ok: false, error: selection.error });
  }
  var headsSheet = getOrCreateHarmonogramySheet_();
  var heads = readHarmonogramHeads_(headsSheet);
  var byRow = {};
  var i;
  for (i = 0; i < shops.length; i++) {
    byRow[shops[i].sheetRow] = shops[i];
  }
  var existingId = '';
  for (i = 0; i < selection.sheetRows.length; i++) {
    var shop = byRow[selection.sheetRows[i]];
    var g;
    for (g = 0; g < heads.length; g++) {
      if (shop && memberMatchesHarmonogram_(shop, heads[g])) {
        if (existingId && existingId !== heads[g].id) {
          return jsonResponse({ ok: false, error: 'juz' });
        }
        existingId = heads[g].id;
      }
    }
  }
  var ids = [];
  for (i = 0; i < heads.length; i++) {
    ids.push(heads[i].id);
  }
  var id = existingId || nextHarmonogramId_(ids);
  var idCol = ensureSheetColumn_(baza, HARMONOGRAM_ID_HEADER);
  for (i = 0; i < selection.sheetRows.length; i++) {
    baza.getRange(selection.sheetRows[i], idCol).setValue(id);
  }
  if (existingId) {
    return jsonResponse({ ok: true, id: id, rows: selection.sheetRows.length });
  }
  var headers = sheetHeaders_(headsSheet);
  var blank = [];
  for (i = 0; i < headers.length; i++) {
    blank.push('');
  }
  var rowNum = Math.max(headsSheet.getLastRow(), 1) + 1;
  headsSheet.getRange(rowNum, 1, 1, blank.length).setValues([blank]);
  putHarmonogramCell_(headsSheet, headers, rowNum, 'Id', id);
  putHarmonogramCell_(headsSheet, headers, rowNum, 'Podwykonawca', selection.podwykonawca);
  putHarmonogramCell_(headsSheet, headers, rowNum, 'Dni odbiorów', selection.dni);
  return jsonResponse({ ok: true, id: id, rows: selection.sheetRows.length });
}

function handleSaveHarmonogramPost_(body) {
  var id = collapseText_(body && body.id);
  if (!id) {
    return jsonResponse({ ok: false, error: 'id' });
  }
  var cena = parseRateAmount_(body && body.cenaTrasy);
  if (!cena) {
    return jsonResponse({ ok: false, error: 'amount' });
  }
  var sheet = getOrCreateHarmonogramySheet_();
  var heads = readHarmonogramHeads_(sheet);
  var found = null;
  var i;
  for (i = 0; i < heads.length; i++) {
    if (heads[i].id === id) {
      found = heads[i];
    }
  }
  if (!found) {
    return jsonResponse({ ok: false, error: 'id' });
  }
  var headers = sheetHeaders_(sheet);
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Cena za trasę', rateAmountCell_(cena));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Miejsce zrzutu', collapseText_(body.miejsceZrzutu));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Okno awizacji', collapseText_(body.oknoAwizacji));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Awizacja', collapseText_(body.awizacja));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Rodzaj zbiórki', collapseText_(body.rodzajZbiorki));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Rodzaj transportu', collapseText_(body.rodzajTransportu));
  putHarmonogramCell_(sheet, headers, found.sheetRow, 'Spodziewane worki', collapseText_(body.spodziewaneWorki));
  return jsonResponse({ ok: true, id: id });
}

function handleUngroupHarmonogramPost_(body) {
  var rows = rowNumbersFromBody_(body);
  if (!rows.length) {
    return jsonResponse({ ok: false, error: 'zaznacz' });
  }
  var baza = getOrCreateHarmonogramRateSheet_();
  var idCol = ensureSheetColumn_(baza, HARMONOGRAM_ID_HEADER);
  var last = baza.getLastRow();
  var cleared = 0;
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i] < 2 || rows[i] > last) {
      continue;
    }
    baza.getRange(rows[i], idCol).setValue('');
    cleared += 1;
  }
  return jsonResponse({ ok: true, rows: cleared });
}

function getBolecinSheetsId_() {
  var id = String(
    PropertiesService.getScriptProperties().getProperty(BOLECIN_SHEETS_ID_PROP) || '',
  ).trim();
  if (!id) {
    throw new Error(
      'Brak Script property BOLECIN_SHEETS_ID — ustaw ID arkusza Bolęcin w Apps Script → Project settings → Script properties',
    );
  }
  return id;
}

function getOrCreateBolecinMonthSheet_(ss, dateText) {
  var name = monthLabelFromDateText_(dateText);
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    return sheet;
  }
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, BOLECIN_HEADER_ROW.length).setValues([BOLECIN_HEADER_ROW]);
  return sheet;
}

function bolecinFieldKey_(header) {
  var n = String(header || '').trim().toLowerCase();
  if (n.indexOf('okno') >= 0) {
    return 'oknoAwizacji';
  }
  if (n.indexOf('adres odbioru') >= 0) {
    return 'adres';
  }
  if (n.indexOf('nazwa kontrahenta') >= 0) {
    return 'nazwa';
  }
  if (n.indexOf('data odbioru') >= 0) {
    return 'data';
  }
  if (n.indexOf('kto odbiera') >= 0) {
    return 'kto';
  }
  if (n.indexOf('miejsce zrzutu') >= 0) {
    return 'miejsce';
  }
  if (n.indexOf('rodzaj zbi') >= 0) {
    return 'rodzajZbiorki';
  }
  if (n.indexOf('ile work') >= 0) {
    return 'worki';
  }
  if (n.indexOf('traport') >= 0 || n.indexOf('transport') >= 0) {
    return 'rodzajTransportu';
  }
  if (n === 'awizacja') {
    return 'awizacja';
  }
  return '';
}

function bolecinSheetHasIdentity_(sheet, identity) {
  var last = sheet.getLastRow();
  if (last < 2) {
    return false;
  }
  var headers = sheetHeaders_(sheet);
  var adresIx = -1;
  var dataIx = -1;
  var ktoIx = -1;
  var i;
  for (i = 0; i < headers.length; i++) {
    var key = bolecinFieldKey_(headers[i]);
    if (key === 'adres') adresIx = i;
    if (key === 'data') dataIx = i;
    if (key === 'kto') ktoIx = i;
  }
  if (adresIx < 0 || dataIx < 0 || ktoIx < 0) {
    return false;
  }
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  for (i = 0; i < values.length; i++) {
    var rowIdentity = bolecinRowIdentity_(
      cellAt_(values[i], adresIx),
      cellAt_(values[i], dataIx),
      cellAt_(values[i], ktoIx),
    );
    if (rowIdentity === identity) {
      return true;
    }
  }
  return false;
}

function appendBolecinMapped_(sheet, fields) {
  var headers = sheetHeaders_(sheet);
  var row = [];
  var any = false;
  var i;
  for (i = 0; i < headers.length; i++) {
    var key = bolecinFieldKey_(headers[i]);
    if (key) {
      any = true;
    }
    row.push(key && fields[key] != null ? String(fields[key]) : '');
  }
  if (!any) {
    sheet.appendRow([
      fields.oknoAwizacji || '',
      fields.adres || '',
      fields.nazwa || '',
      fields.data || '',
      fields.kto || '',
      fields.miejsce || '',
      fields.rodzajZbiorki || '',
      fields.worki || '',
      fields.rodzajTransportu || '',
      fields.awizacja || '',
    ]);
    return;
  }
  sheet.appendRow(row);
}

function wantsProtocolBolecin_(body) {
  if (!body) {
    return false;
  }
  var flag = body.awizujBolecin;
  if (!(flag === true || flag === 'true' || flag === 1 || flag === '1')) {
    return false;
  }
  return isBolecinPlace_(body.miejsceZrzutu);
}

function protocolBolecinFields_(body) {
  var worki = body.iloscWorkow != null ? String(body.iloscWorkow) : '';
  return {
    oknoAwizacji: collapseText_(body.oknoAwizacji),
    adres: collapseText_(body.adresSklepu),
    nazwa: collapseText_(body.podmiotHandlowy),
    data: collapseText_(body.dataOdbioru),
    kto: collapseText_(body.ktoOdbiera),
    miejsce: collapseText_(body.miejsceZrzutu),
    rodzajZbiorki: collapseText_(body.rodzajZbiorki),
    worki: collapseText_(worki),
    rodzajTransportu: collapseText_(body.rodzajTransportu),
    awizacja: collapseText_(body.awizacja),
  };
}

function findBolecinIdentityRow_(sheet, identity) {
  var last = sheet.getLastRow();
  if (last < 2) {
    return 0;
  }
  var headers = sheetHeaders_(sheet);
  var adresIx = -1;
  var dataIx = -1;
  var ktoIx = -1;
  var i;
  for (i = 0; i < headers.length; i++) {
    var key = bolecinFieldKey_(headers[i]);
    if (key === 'adres') adresIx = i;
    if (key === 'data') dataIx = i;
    if (key === 'kto') ktoIx = i;
  }
  if (adresIx < 0 || dataIx < 0 || ktoIx < 0) {
    return 0;
  }
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  for (i = 0; i < values.length; i++) {
    var rowIdentity = bolecinRowIdentity_(
      cellAt_(values[i], adresIx),
      cellAt_(values[i], dataIx),
      cellAt_(values[i], ktoIx),
    );
    if (rowIdentity === identity) {
      return i + 2;
    }
  }
  return 0;
}

function writeBolecinMappedRow_(sheet, sheetRow, fields) {
  var headers = sheetHeaders_(sheet);
  var any = false;
  var i;
  for (i = 0; i < headers.length; i++) {
    var key = bolecinFieldKey_(headers[i]);
    if (!key) {
      continue;
    }
    any = true;
    var value = fields[key] != null ? String(fields[key]) : '';
    sheet.getRange(sheetRow, i + 1).setValue(value);
  }
  return any;
}

/** Jeden wiersz protokołu. Istniejąca trójka adres + data + kto jest nadpisywana. */
function upsertProtocolBolecin_(body) {
  var fields = protocolBolecinFields_(body);
  var ss = SpreadsheetApp.openById(getBolecinSheetsId_());
  var monthSheet = getOrCreateBolecinMonthSheet_(ss, fields.data);
  var identity = bolecinRowIdentity_(fields.adres, fields.data, fields.kto);
  var existing = findBolecinIdentityRow_(monthSheet, identity);
  if (existing && writeBolecinMappedRow_(monthSheet, existing, fields)) {
    return;
  }
  appendBolecinMapped_(monthSheet, fields);
}

function handleAwizujBolecinPost_(body) {
  var id = collapseText_(body && body.id);
  if (!id) {
    return jsonResponse({ ok: false, error: 'id' });
  }
  var sheet = getOrCreateHarmonogramySheet_();
  var heads = readHarmonogramHeads_(sheet);
  var group = null;
  var i;
  for (i = 0; i < heads.length; i++) {
    if (heads[i].id === id) {
      group = heads[i];
    }
  }
  if (!group) {
    return jsonResponse({ ok: false, error: 'id' });
  }
  if (!isBolecinPlace_(group.miejsceZrzutu)) {
    return jsonResponse({ ok: false, error: 'nie_bolecin' });
  }
  var baza = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HARMONOGRAM_RATE_SHEET_NAME);
  var shops = baza ? readHarmonogramShopRows_(baza) : [];
  var members = [];
  for (i = 0; i < shops.length; i++) {
    if (memberMatchesHarmonogram_(shops[i], group)) {
      members.push(shops[i]);
    }
  }
  if (!members.length) {
    return jsonResponse({ ok: false, error: 'brak_sklepow' });
  }
  var nazwyMap = body && body.nazwy && typeof body.nazwy === 'object' ? body.nazwy : {};
  var adresy = [];
  var nazwy = [];
  for (i = 0; i < members.length; i++) {
    adresy.push(members[i].adres);
    var given = nazwyMap[members[i].adres];
    nazwy.push(given ? String(given) : members[i].adres);
  }
  var adres = joinHarmonogramLabels_(adresy);
  var nazwa = joinHarmonogramLabels_(nazwy);
  var dates = harmonogramProposalDates_(group.dni, new Date());
  if (!dates.length) {
    return jsonResponse({ ok: false, error: 'brak_dat' });
  }
  var ss = SpreadsheetApp.openById(getBolecinSheetsId_());
  var dopisane = 0;
  var pominiete = 0;
  for (i = 0; i < dates.length; i++) {
    var monthSheet = getOrCreateBolecinMonthSheet_(ss, dates[i]);
    var identity = bolecinRowIdentity_(adres, dates[i], group.podwykonawca);
    if (bolecinSheetHasIdentity_(monthSheet, identity)) {
      pominiete += 1;
      continue;
    }
    appendBolecinMapped_(monthSheet, {
      oknoAwizacji: group.oknoAwizacji,
      adres: adres,
      nazwa: nazwa,
      data: dates[i],
      kto: group.podwykonawca,
      miejsce: group.miejsceZrzutu,
      rodzajZbiorki: group.rodzajZbiorki,
      worki: group.spodziewaneWorki,
      rodzajTransportu: group.rodzajTransportu,
      awizacja: group.awizacja,
    });
    dopisane += 1;
  }
  return jsonResponse({ ok: true, dopisane: dopisane, pominiete: pominiete });
}

/**
 * Lista podwykonawców jak na mapie: Nazwa i Dane do Worda.
 * Ta sama scalona lista co listReferenceData.podwykoLista. Nie zakłada zakładki.
 */
function listContractors_() {
  return mergeReferencePodwykoLista_();
}

/**
 * Adresy do okna stawek: kolumna Adres sklepu plus nazwa z kolumny Sklep.
 * Nic nie zapisuje i zakładki nie zakłada.
 */
function listStoreAddresses_() {
  var all = [];
  var sheets = listRegisterSheets_('report');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var width = COL.sklep - COL.adres + 1;
    var values = sheet.getRange(2, COL.adres, lastRow - 1, width).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      all.push(values[i]);
    }
  }
  return uniqueStoreAddresses_(all);
}

function uniqueStoreAddresses_(rows) {
  var byKey = {};
  var order = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || typeof row.length !== 'number') {
      continue;
    }
    var adres = row[0] == null ? '' : String(row[0]).trim();
    var sklep = row.length > 2 && row[2] != null ? String(row[2]).trim() : '';
    if (!adres) {
      continue;
    }
    var key = normalizeRateShopKey_(adres);
    if (!key) {
      continue;
    }
    if (!byKey[key]) {
      byKey[key] = { adres: adres, sklep: sklep };
      order.push(key);
    } else if (!byKey[key].sklep && sklep) {
      byKey[key].sklep = sklep;
    }
  }
  var out = [];
  for (i = 0; i < order.length; i++) {
    out.push(byKey[order[i]]);
  }
  out.sort(function (a, b) {
    return a.adres.localeCompare(b.adres, 'pl');
  });
  return out;
}

/**
 * Odczyt zestawienia. Nie bierze locka i nic nie zapisuje.
 * tryb=harmonogram: legacy + miesięczne Harmonogram + rates z Bazy cen.
 * Inaczej: legacy Arkusz1 + miesięczne Na zgłoszenie + Baza stawek.
 */
function settlementSearch_(query) {
  var tryb = settlementText_(query && query.tryb).toLowerCase();
  if (tryb === 'harmonogram' || tryb === 'schedule') {
    return settlementSearchHarmonogram_(query);
  }
  var rateSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET_NAME);
  return buildSettlementRead_(
    query,
    readAllRegisterSettlementCells_('report', COL.kosztPerWorek),
    readSettlementCells_(rateSheet, 5),
  );
}

/**
 * Harmonogram: wiersze z legacy + miesięcznych; rates z Bazy cen.
 */
function settlementSearchHarmonogram_(query) {
  var baza = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HARMONOGRAM_RATE_SHEET_NAME);
  return buildSettlementHarmonogramRead_(
    query,
    readAllRegisterSettlementCells_('schedule', SCHEDULE_COL.kosztPerWorek),
    readSettlementCells_(baza, 8),
  );
}

/**
 * Odczyt zakładki „odebrane z harmonogramu” z nagłówkami (mapowanie po nazwie).
 * Brak zakładki = pusta lista.
 */
function readOdebraneSheetRows_(sheet) {
  if (!sheet) {
    return { headers: [], rows: [] };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { headers: [], rows: [] };
  }
  var headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = [];
  var h;
  for (h = 0; h < headerValues.length; h++) {
    headers.push(settlementText_(headerValues[h]));
  }
  if (lastRow < 2) {
    return { headers: headers, rows: [] };
  }
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var rows = [];
  var i;
  for (i = 0; i < values.length; i++) {
    var cells = [];
    var c;
    for (c = 0; c < lastCol; c++) {
      cells.push(values[i][c] != null ? values[i][c] : '');
    }
    rows.push(cells);
  }
  return { headers: headers, rows: rows };
}

/**
 * Odczyt Statystyk. Nie bierze locka i nic nie zapisuje.
 * Brak zakładki Baza stawek to pusta lista stawek, nie nowa zakładka.
 * Worki Harmonogram: zakładka „odebrane z harmonogramu” (1 wiersz = 1 worek).
 */
function settlementStats_(query) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rateSheet = ss.getSheetByName(RATE_SHEET_NAME);
  var odebrane = ss.getSheetByName(ODEBRANE_Z_HARMONOGRAMU_SHEET_NAME);
  return buildSettlementStats_(
    query,
    readAllRegisterSettlementCells_('report', COL.kosztPerWorek),
    readSettlementCells_(rateSheet, 5),
    readOdebraneSheetRows_(odebrane),
  );
}

/** Czyta istniejące kolumny i dopina puste. Nie woła setValue. Brak flagi „nie” = transport się odbył. */
function readSettlementCells_(sheet, width, sheetName) {
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    return [];
  }
  var numDataRows = lastRow - 1;
  var readWidth = lastCol < width ? lastCol : width;
  var values = sheet.getRange(2, 1, numDataRows, readWidth).getValues();
  var name = sheetName != null && sheetName !== '' ? String(sheetName) : sheet.getName();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var cells = [];
    var row = values[i];
    for (var c = 0; c < width; c++) {
      cells.push(c < row.length && row[c] != null ? row[c] : '');
    }
    out.push({ sheetName: name, sheetRow: i + 2, cells: cells });
  }
  return out;
}

/** Scalenie wierszy ze wszystkich zakładek rejestru danego trybu (legacy + miesięczne). */
function readAllRegisterSettlementCells_(kind, width) {
  var out = [];
  var sheets = listRegisterSheets_(kind);
  var s;
  for (s = 0; s < sheets.length; s++) {
    var chunk = readSettlementCells_(sheets[s].sheet, width, sheets[s].name);
    var i;
    for (i = 0; i < chunk.length; i++) {
      out.push(chunk[i]);
    }
  }
  return out;
}

/* settlement-read-pure:start */
function settlementText_(value) {
  if (value == null) {
    return '';
  }
  return String(value).trim();
}

function settlementFlag_(value) {
  return settlementText_(value).toLowerCase();
}

function settlementPad2_(n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
}

function settlementCalendarOk_(year, month, day) {
  var check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function settlementFormatDate_(year, month, day) {
  return settlementPad2_(day) + '.' + settlementPad2_(month) + '.' + String(year);
}

/** Tekst dd.mm.yyyy albo null. Data z arkusza (obiekt) idzie składnikami lokalnymi. Akceptuje też ISO yyyy-mm-dd. */
function settlementDateText_(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return null;
    }
    var year = value.getFullYear();
    var month = value.getMonth() + 1;
    var day = value.getDate();
    if (!settlementCalendarOk_(year, month, day)) {
      return null;
    }
    return settlementFormatDate_(year, month, day);
  }
  if (typeof value === 'number' && isFinite(value)) {
    if (value < 20000 || value > 80000) {
      return null;
    }
    var ms = (value - 25569) * 86400000;
    var serial = new Date(ms);
    if (isNaN(serial.getTime())) {
      return null;
    }
    return settlementFormatDate_(
      serial.getUTCFullYear(),
      serial.getUTCMonth() + 1,
      serial.getUTCDate(),
    );
  }
  var s = settlementText_(value);
  if (!s) {
    return null;
  }
  var match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (match) {
    var d = parseInt(match[1], 10);
    var m = parseInt(match[2], 10);
    var y = parseInt(match[3], 10);
    if (!settlementCalendarOk_(y, m, d)) {
      return null;
    }
    return settlementFormatDate_(y, m, d);
  }
  var iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (iso) {
    var yi = parseInt(iso[1], 10);
    var mi = parseInt(iso[2], 10);
    var di = parseInt(iso[3], 10);
    if (!settlementCalendarOk_(yi, mi, di)) {
      return null;
    }
    return settlementFormatDate_(yi, mi, di);
  }
  return null;
}

function settlementCompareDate_(a, b) {
  function parts(text) {
    var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    return {
      y: parseInt(match[3], 10),
      m: parseInt(match[2], 10),
      d: parseInt(match[1], 10),
    };
  }
  var left = parts(a);
  var right = parts(b);
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  if (left.m !== right.m) {
    return left.m - right.m;
  }
  return left.d - right.d;
}

function settlementDateInRange_(pickup, dataOd, dataDo) {
  if (settlementCompareDate_(pickup, dataDo) > 0) {
    return false;
  }
  if (dataOd && settlementCompareDate_(pickup, dataOd) < 0) {
    return false;
  }
  return true;
}

/** Dzień po dacie dd.mm.yyyy (UTC). */
function settlementAddOneDay_(dateText) {
  var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
  if (!match) {
    return null;
  }
  var next = new Date(
    Date.UTC(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10) + 1),
  );
  return settlementFormatDate_(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * Do zestawienia wiersz trafia dzień po dacie odbioru.
 * np. odbiór 01.10 → dopisanie gdy asOf ≥ 02.10 (Data odbioru zostaje 01.10).
 */
function settlementPickupReadyForZestawienie_(pickupDate, asOfDate) {
  var appearOn = settlementAddOneDay_(pickupDate);
  if (!appearOn) {
    return false;
  }
  return settlementCompareDate_(appearOn, asOfDate) <= 0;
}

function settlementAmountToGrosze_(value) {
  if (value == null || value === '') {
    return null;
  }
  var n;
  if (typeof value === 'number') {
    n = value;
  } else {
    var s = settlementText_(value).replace(/\s/g, '').replace(/zł/gi, '').replace(',', '.');
    if (s === '' || s === '-') {
      return null;
    }
    n = Number(s);
  }
  if (!isFinite(n)) {
    return null;
  }
  var negative = n < 0;
  var parts = Math.abs(n).toFixed(2).split('.');
  var grosze = Number(parts[0]) * 100 + Number(parts[1]);
  return negative ? -grosze : grosze;
}

function settlementBagCount_(value) {
  if (value == null || value === '') {
    return null;
  }
  var n;
  if (typeof value === 'number') {
    n = value;
  } else {
    var s = settlementText_(value).replace(/\s/g, '').replace(',', '.');
    if (s === '') {
      return null;
    }
    n = Number(s);
  }
  if (!isFinite(n)) {
    return null;
  }
  return n;
}

function settlementTransportNumber_(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value === 'number' && isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function settlementCell_(cells, index) {
  if (!cells || index >= cells.length || cells[index] == null) {
    return '';
  }
  return cells[index];
}

function settlementNormalizeQuery_(query) {
  var src = query || {};
  return {
    podwykonawca: settlementText_(src.podwykonawca),
    dataOd: settlementText_(src.dataOd),
    dataDo: settlementText_(src.dataDo),
  };
}

function settlementQueryError_(query) {
  var q = settlementNormalizeQuery_(query);
  if (!q.podwykonawca) {
    return 'podwykonawca required';
  }
  if (!q.dataDo) {
    return 'dataDo required';
  }
  if (!settlementDateText_(q.dataDo)) {
    return 'dataDo is not dd.mm.yyyy';
  }
  if (q.dataOd && !settlementDateText_(q.dataOd)) {
    return 'dataOd is not dd.mm.yyyy';
  }
  if (q.dataOd && settlementCompareDate_(settlementDateText_(q.dataOd), settlementDateText_(q.dataDo)) > 0) {
    return 'dataOd after dataDo';
  }
  return '';
}

function mapSettlementRegisterRow_(sheetRow, cells, sheetName) {
  var pickupDate = settlementDateText_(settlementCell_(cells, 4));
  if (!pickupDate) {
    return null;
  }
  return {
    sheetName: sheetName != null ? String(sheetName) : '',
    sheetRow: sheetRow,
    transportNumber: settlementTransportNumber_(settlementCell_(cells, 0)),
    address: settlementText_(settlementCell_(cells, 1)),
    shopName: settlementText_(settlementCell_(cells, 3)),
    pickupDate: pickupDate,
    contractor: settlementText_(settlementCell_(cells, 5)),
    bagCount: settlementBagCount_(settlementCell_(cells, 8)),
    didNotHappen: settlementFlag_(settlementCell_(cells, 9)) === 'nie',
    routeName: settlementText_(settlementCell_(cells, 10)),
    routeRate: settlementAmountToGrosze_(settlementCell_(cells, 11)),
    pickupRate: settlementAmountToGrosze_(settlementCell_(cells, 12)),
    bagRate: settlementAmountToGrosze_(settlementCell_(cells, 13)),
    settled: settlementFlag_(settlementCell_(cells, 14)) === 'tak',
    receptionCost: settlementAmountToGrosze_(settlementCell_(cells, 16)),
    costPerBag: settlementAmountToGrosze_(settlementCell_(cells, 17)),
  };
}

/** Mapowanie wiersza zestawienia Harmonogram (bez nr zlecenia). */
function mapSettlementScheduleRegisterRow_(sheetRow, cells, sheetName) {
  var pickupDate = settlementDateText_(settlementCell_(cells, 3));
  if (!pickupDate) {
    return null;
  }
  return {
    sheetName: sheetName != null ? String(sheetName) : '',
    sheetRow: sheetRow,
    transportNumber: '',
    address: settlementText_(settlementCell_(cells, 0)),
    shopName: settlementText_(settlementCell_(cells, 2)),
    pickupDate: pickupDate,
    contractor: settlementText_(settlementCell_(cells, 4)),
    bagCount: settlementBagCount_(settlementCell_(cells, 7)),
    didNotHappen: settlementFlag_(settlementCell_(cells, 8)) === 'nie',
    routeName: settlementText_(settlementCell_(cells, 9)),
    routeRate: settlementAmountToGrosze_(settlementCell_(cells, 10)),
    pickupRate: settlementAmountToGrosze_(settlementCell_(cells, 11)),
    bagRate: settlementAmountToGrosze_(settlementCell_(cells, 12)),
    settled: settlementFlag_(settlementCell_(cells, 13)) === 'tak',
    receptionCost: settlementAmountToGrosze_(settlementCell_(cells, 15)),
    costPerBag: settlementAmountToGrosze_(settlementCell_(cells, 16)),
  };
}

function mapSettlementRateRow_(sheetRow, cells) {
  var rawFrom = settlementCell_(cells, 4);
  var validFrom = '';
  var hasFrom = rawFrom instanceof Date || settlementText_(rawFrom) !== '';
  if (hasFrom) {
    validFrom = settlementDateText_(rawFrom);
    if (!validFrom) {
      return null;
    }
  }
  return {
    sheetRow: sheetRow,
    shop: settlementText_(settlementCell_(cells, 0)),
    contractor: settlementText_(settlementCell_(cells, 1)),
    pickupAmount: settlementAmountToGrosze_(settlementCell_(cells, 2)),
    bagAmount: settlementAmountToGrosze_(settlementCell_(cells, 3)),
    validFrom: validFrom,
  };
}

function settlementPublicRow_(mapped) {
  return {
    sheetName: mapped.sheetName || '',
    sheetRow: mapped.sheetRow,
    transportNumber: mapped.transportNumber,
    address: mapped.address,
    shopName: mapped.shopName,
    pickupDate: mapped.pickupDate,
    contractor: mapped.contractor,
    bagCount: mapped.bagCount,
    routeName: mapped.routeName,
    routeRate: mapped.routeRate,
    pickupRate: mapped.pickupRate,
    bagRate: mapped.bagRate,
  };
}

function settlementStatsPublicRow_(mapped) {
  return {
    sheetName: mapped.sheetName || '',
    sheetRow: mapped.sheetRow,
    transportNumber: mapped.transportNumber,
    address: mapped.address,
    shopName: mapped.shopName,
    pickupDate: mapped.pickupDate,
    contractor: mapped.contractor,
    bagCount: mapped.bagCount,
    routeName: mapped.routeName,
    routeRate: mapped.routeRate,
    pickupRate: mapped.pickupRate,
    bagRate: mapped.bagRate,
    settled: mapped.settled,
    happened: !mapped.didNotHappen,
    receptionCost: mapped.receptionCost,
    costPerBag: mapped.costPerBag,
    mode: mapped.mode === 'schedule' ? 'schedule' : 'report',
  };
}

/**
 * Grupuje worki z „odebrane z harmonogramu” → odbiór (adres + data + firma).
 * Tylko w zakresie dat. Bez Bazy cen (same worki / liczba).
 */
function settlementStatsOdebraneRows_(odebrane, dataOd, dataDo, podwykonawca) {
  var headers = (odebrane && odebrane.headers) || [];
  var sourceRows = (odebrane && odebrane.rows) || [];
  var ixKod = settlementHeaderIndex_(headers, 'Kod pocztowy');
  var ixMiasto = settlementHeaderIndex_(headers, 'Miasto');
  var ixUlica = settlementHeaderIndex_(headers, 'Ulica');
  var ixNumer = settlementHeaderIndex_(headers, 'Numer budynku');
  var ixFirma = settlementHeaderIndex_(headers, 'Firma transportowa');
  var ixData = settlementHeaderIndex_(headers, 'Data zamknięcia worka');
  var ixSklep = settlementHeaderIndex_(headers, 'Sklep');
  if (ixKod < 0 || ixMiasto < 0 || ixUlica < 0 || ixNumer < 0 || ixFirma < 0 || ixData < 0) {
    return [];
  }
  var who = podwykonawca ? settlementFoldPl_(podwykonawca) : '';
  var groups = {};
  var order = [];
  var oi;
  for (oi = 0; oi < sourceRows.length; oi++) {
    var orow = sourceRows[oi];
    var firma = settlementText_(orow[ixFirma]);
    if (!firma) {
      continue;
    }
    if (who && settlementFoldPl_(firma) !== who) {
      continue;
    }
    var adres = settlementBuildAddressParts_(orow[ixKod], orow[ixMiasto], orow[ixUlica], orow[ixNumer]);
    if (!adres) {
      continue;
    }
    var closeDate = settlementDateText_(orow[ixData]);
    if (!closeDate || !settlementDateInRange_(closeDate, dataOd, dataDo)) {
      continue;
    }
    var key = settlementFoldPl_(adres) + '\n' + closeDate + '\n' + settlementFoldPl_(firma);
    if (!groups[key]) {
      groups[key] = {
        address: adres,
        shopName: ixSklep >= 0 ? settlementText_(orow[ixSklep]) : '',
        contractor: firma,
        pickupDate: closeDate,
        bagCount: 0,
      };
      order.push(key);
    }
    groups[key].bagCount += 1;
    if (!groups[key].shopName && ixSklep >= 0) {
      groups[key].shopName = settlementText_(orow[ixSklep]);
    }
  }
  var out = [];
  var gi;
  for (gi = 0; gi < order.length; gi++) {
    var g = groups[order[gi]];
    out.push(
      settlementStatsPublicRow_({
        sheetRow: 10000000 + gi,
        transportNumber: '',
        address: g.address,
        shopName: g.shopName,
        pickupDate: g.pickupDate,
        contractor: g.contractor,
        bagCount: g.bagCount,
        routeName: '',
        routeRate: null,
        pickupRate: null,
        bagRate: null,
        settled: false,
        didNotHappen: false,
        receptionCost: null,
        costPerBag: null,
        mode: 'schedule',
      }),
    );
  }
  return out;
}

function buildSettlementRead_(query, register, rates) {
  var error = settlementQueryError_(query);
  if (error) {
    return { ok: false, error: error };
  }
  var q = settlementNormalizeQuery_(query);
  var dataOd = q.dataOd ? settlementDateText_(q.dataOd) : '';
  var dataDo = settlementDateText_(q.dataDo);
  var rows = [];
  var sourceRows = register || [];
  for (var i = 0; i < sourceRows.length; i++) {
    var item = sourceRows[i];
    var mapped = mapSettlementRegisterRow_(item.sheetRow, item.cells, item.sheetName);
    if (!mapped || mapped.contractor !== q.podwykonawca) {
      continue;
    }
    if (mapped.settled || mapped.didNotHappen) {
      continue;
    }
    if (!settlementDateInRange_(mapped.pickupDate, dataOd, dataDo)) {
      continue;
    }
    rows.push(settlementPublicRow_(mapped));
  }
  var rateRows = [];
  var sourceRates = rates || [];
  for (var j = 0; j < sourceRates.length; j++) {
    var rateItem = sourceRates[j];
    var rate = mapSettlementRateRow_(rateItem.sheetRow, rateItem.cells);
    if (!rate || rate.contractor !== q.podwykonawca) {
      continue;
    }
    rateRows.push(rate);
  }
  return { ok: true, rows: rows, rates: rateRows };
}

function settlementStatsNormalizeQuery_(query) {
  var src = query || {};
  return {
    podwykonawca: settlementText_(src.podwykonawca),
    dataOd: settlementText_(src.dataOd),
    dataDo: settlementText_(src.dataDo),
  };
}

function settlementStatsQueryError_(query) {
  var q = settlementStatsNormalizeQuery_(query);
  if (!q.dataDo) {
    return 'dataDo required';
  }
  if (!q.dataOd) {
    return 'dataOd required';
  }
  if (!settlementDateText_(q.dataDo)) {
    return 'dataDo is not dd.mm.yyyy';
  }
  if (!settlementDateText_(q.dataOd)) {
    return 'dataOd is not dd.mm.yyyy';
  }
  if (settlementCompareDate_(settlementDateText_(q.dataOd), settlementDateText_(q.dataDo)) > 0) {
    return 'dataOd after dataDo';
  }
  return '';
}

/** Rozliczone w zakresie; nierozliczone odbyte bez filtra dat (backlog / luki). */
function settlementStatsIncludeRow_(mapped, dataOd, dataDo) {
  if (mapped.didNotHappen) {
    return false;
  }
  if (!mapped.settled) {
    return true;
  }
  return settlementDateInRange_(mapped.pickupDate, dataOd, dataDo);
}

function buildSettlementStats_(query, register, rates, odebrane) {
  var error = settlementStatsQueryError_(query);
  if (error) {
    return { ok: false, error: error };
  }
  var q = settlementStatsNormalizeQuery_(query);
  var dataOd = settlementDateText_(q.dataOd);
  var dataDo = settlementDateText_(q.dataDo);
  var rows = [];
  var sourceRows = register || [];
  for (var i = 0; i < sourceRows.length; i++) {
    var item = sourceRows[i];
    var mapped = mapSettlementRegisterRow_(item.sheetRow, item.cells, item.sheetName);
    if (!mapped) {
      continue;
    }
    if (q.podwykonawca && mapped.contractor !== q.podwykonawca) {
      continue;
    }
    if (!settlementStatsIncludeRow_(mapped, dataOd, dataDo)) {
      continue;
    }
    mapped.mode = 'report';
    rows.push(settlementStatsPublicRow_(mapped));
  }
  var scheduleRows = settlementStatsOdebraneRows_(odebrane, dataOd, dataDo, q.podwykonawca);
  var si;
  for (si = 0; si < scheduleRows.length; si++) {
    rows.push(scheduleRows[si]);
  }
  var rateRows = [];
  var sourceRates = rates || [];
  for (var j = 0; j < sourceRates.length; j++) {
    var rateItem = sourceRates[j];
    var rate = mapSettlementRateRow_(rateItem.sheetRow, rateItem.cells);
    if (!rate) {
      continue;
    }
    if (q.podwykonawca && rate.contractor !== q.podwykonawca) {
      continue;
    }
    rateRows.push(rate);
  }
  return { ok: true, rows: rows, rates: rateRows };
}

/** Fold klucza sync/statystyk: al./pl./Św. jak w stawkach, potem ASCII (ogonki). */
function settlementFoldPl_(text) {
  return normalizeRateShopKey_(text)
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function settlementNormalizeDayToken_(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[^a-z]/g, '');
}

/** Unikalne getDay() JS (0=nd … 6=sb) z tekstu „pn, cz”. */
function settlementParseWeekdays_(raw) {
  var map = {
    nd: 0,
    niedziela: 0,
    niedziele: 0,
    pn: 1,
    poniedzialek: 1,
    poniedzialki: 1,
    wt: 2,
    wtorek: 2,
    wtorki: 2,
    sr: 3,
    sroda: 3,
    srody: 3,
    cz: 4,
    czw: 4,
    czwartek: 4,
    czwartki: 4,
    pt: 5,
    piatek: 5,
    piatki: 5,
    sb: 6,
    so: 6,
    sobota: 6,
    soboty: 6,
  };
  var text = settlementText_(raw);
  if (!text) {
    return [];
  }
  var found = {};
  var parts = text.split(/[/;,]+|\s+/);
  var i;
  for (i = 0; i < parts.length; i++) {
    var norm = settlementNormalizeDayToken_(parts[i]);
    if (!norm) {
      continue;
    }
    if (map[norm] !== undefined) {
      found[map[norm]] = true;
      continue;
    }
    var name;
    for (name in map) {
      if (name.length >= 2 && (norm === name || norm.indexOf(name) !== -1)) {
        found[map[name]] = true;
      }
    }
  }
  var out = [];
  var d;
  for (d = 0; d <= 6; d++) {
    if (found[d]) {
      out.push(d);
    }
  }
  return out;
}

/** Daty dd.mm.yyyy w [dataOd, dataDo] o getDay() z listy weekdays. dataOd puste = 366 dni wstecz od dataDo. */
function settlementDatesMatchingWeekdays_(dataOd, dataDo, weekdays) {
  if (!dataDo || !weekdays || !weekdays.length) {
    return [];
  }
  var end = settlementDateText_(dataDo);
  if (!end) {
    return [];
  }
  var start = dataOd ? settlementDateText_(dataOd) : '';
  if (!start) {
    var endParts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(end);
    var endUtc = Date.UTC(
      parseInt(endParts[3], 10),
      parseInt(endParts[2], 10) - 1,
      parseInt(endParts[1], 10),
    );
    var startUtc = endUtc - 366 * 86400000;
    var s = new Date(startUtc);
    start = settlementFormatDate_(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate());
  }
  if (settlementCompareDate_(start, end) > 0) {
    return [];
  }
  var wanted = {};
  var w;
  for (w = 0; w < weekdays.length; w++) {
    wanted[weekdays[w]] = true;
  }
  var out = [];
  var curParts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(start);
  var y = parseInt(curParts[3], 10);
  var m = parseInt(curParts[2], 10);
  var d = parseInt(curParts[1], 10);
  var guard = 0;
  while (guard < 400) {
    guard += 1;
    var text = settlementFormatDate_(y, m, d);
    if (settlementCompareDate_(text, end) > 0) {
      break;
    }
    var jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wanted[jsDay]) {
      out.push(text);
    }
    d += 1;
    var check = new Date(Date.UTC(y, m - 1, d));
    y = check.getUTCFullYear();
    m = check.getUTCMonth() + 1;
    d = check.getUTCDate();
  }
  return out;
}

function settlementHeaderIndex_(headers, name) {
  var wanted = settlementFoldPl_(name);
  var i;
  for (i = 0; i < headers.length; i++) {
    if (settlementFoldPl_(headers[i]) === wanted) {
      return i;
    }
  }
  return -1;
}

function settlementBuildAddressParts_(kod, miasto, ulica, numer) {
  var items = [settlementText_(kod), settlementText_(miasto)];
  var street = settlementText_(ulica);
  var streetFold = settlementFoldPl_(street);
  if (street && streetFold !== 'brak' && streetFold !== '-') {
    items.push(street);
  }
  items.push(settlementText_(numer));
  var out = [];
  var i;
  for (i = 0; i < items.length; i++) {
    if (items[i]) {
      out.push(items[i]);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Odczyt Harmonogram z rejestru „zestawienie z harmonogramu”.
 * register = cells jak Arkusz1 (do kolumny kosztu / transport się odbył).
 * bazaCen = cells Bazy cen (8 kolumn) — tylko do rates w odpowiedzi.
 */
function buildSettlementHarmonogramRead_(query, register, bazaCen) {
  var error = settlementQueryError_(query);
  if (error) {
    return { ok: false, error: error };
  }
  var q = settlementNormalizeQuery_(query);
  var dataOd = q.dataOd ? settlementDateText_(q.dataOd) : '';
  var dataDo = settlementDateText_(q.dataDo);
  var who = settlementFoldPl_(q.podwykonawca);
  var rows = [];
  var sourceRows = register || [];
  var i;
  for (i = 0; i < sourceRows.length; i++) {
    var item = sourceRows[i];
    var mapped = mapSettlementScheduleRegisterRow_(item.sheetRow, item.cells, item.sheetName);
    if (!mapped || settlementFoldPl_(mapped.contractor) !== who) {
      continue;
    }
    if (mapped.settled || mapped.didNotHappen) {
      continue;
    }
    if (!settlementDateInRange_(mapped.pickupDate, dataOd, dataDo)) {
      continue;
    }
    rows.push(settlementPublicRow_(mapped));
  }
  rows.sort(function (a, b) {
    var byDate = settlementCompareDate_(a.pickupDate, b.pickupDate);
    if (byDate !== 0) {
      return byDate;
    }
    return a.address.localeCompare(b.address, 'pl');
  });

  var publicRates = [];
  var sourceBaza = bazaCen || [];
  var bi;
  for (bi = 0; bi < sourceBaza.length; bi++) {
    var rateItem = sourceBaza[bi];
    var cells = rateItem.cells || [];
    var shop = settlementText_(cells[0]);
    var contractor = settlementText_(cells[1]);
    if (!shop || settlementFoldPl_(contractor) !== who) {
      continue;
    }
    var rawFrom = cells[6];
    var validFrom = '';
    var hasFrom = rawFrom instanceof Date || settlementText_(rawFrom) !== '';
    if (hasFrom) {
      validFrom = settlementDateText_(rawFrom);
      if (!validFrom) {
        continue;
      }
    }
    publicRates.push({
      sheetRow: rateItem.sheetRow,
      shop: shop,
      contractor: contractor,
      pickupAmount: settlementAmountToGrosze_(cells[3]),
      bagAmount: settlementAmountToGrosze_(cells[4]),
      validFrom: validFrom,
    });
  }
  return { ok: true, rows: rows, rates: publicRates };
}

/**
 * Buduje oczekiwane wiersze sync (adres+data+firma).
 * Wiersz dopiero dzień po dacie odbioru (asOf = dataDo): odbiór 01.10 → zestawienie od 02.10.
 * Nazwy punktu/kontrahenta: z worków dnia, a przy 0 workach z dowolnego wiersza odebrane tego adresu.
 * Rodzaj zbiórki: z Tryb zbiórki na workach; przy 0 workach = „brak worków”.
 * bazaCen = { sheetRow, cells }[]; odebrane = { headers, rows }.
 */
function buildScheduleSyncExpected_(dataOd, dataDo, bazaCen, odebrane) {
  var start = settlementDateText_(dataOd);
  var end = settlementDateText_(dataDo);
  if (!start || !end || settlementCompareDate_(start, end) > 0) {
    return [];
  }

  var rateRows = [];
  var shops = {};
  var sourceBaza = bazaCen || [];
  var bi;
  for (bi = 0; bi < sourceBaza.length; bi++) {
    var item = sourceBaza[bi];
    var cells = item.cells || [];
    var shop = settlementText_(cells[0]);
    var contractor = settlementText_(cells[1]);
    if (!shop || !contractor) {
      continue;
    }
    var rawFrom = cells[6];
    var validFrom = '';
    var hasFrom = rawFrom instanceof Date || settlementText_(rawFrom) !== '';
    if (hasFrom) {
      validFrom = settlementDateText_(rawFrom);
      if (!validFrom) {
        continue;
      }
    }
    rateRows.push({
      shop: shop,
      contractor: contractor,
      routeName: settlementText_(cells[2]),
      pickupAmount: cells[3],
      bagAmount: cells[4],
      routeAmount: cells[5],
      validFrom: validFrom,
      days: settlementText_(cells[7]),
    });
    var shopKey = settlementFoldPl_(shop) + '\n' + settlementFoldPl_(contractor);
    if (!shops[shopKey]) {
      shops[shopKey] = { address: shop, contractor: contractor, days: settlementText_(cells[7]) };
    } else if (!shops[shopKey].days && cells[7]) {
      shops[shopKey].days = settlementText_(cells[7]);
    }
  }

  var bagGroups = {};
  var odebraneHeaders = (odebrane && odebrane.headers) || [];
  var odebraneRows = (odebrane && odebrane.rows) || [];
  var ixKod = settlementHeaderIndex_(odebraneHeaders, 'Kod pocztowy');
  var ixMiasto = settlementHeaderIndex_(odebraneHeaders, 'Miasto');
  var ixUlica = settlementHeaderIndex_(odebraneHeaders, 'Ulica');
  var ixNumer = settlementHeaderIndex_(odebraneHeaders, 'Numer budynku');
  var ixFirma = settlementHeaderIndex_(odebraneHeaders, 'Firma transportowa');
  var ixData = settlementHeaderIndex_(odebraneHeaders, 'Data zamknięcia worka');
  var ixSklep = settlementHeaderIndex_(odebraneHeaders, 'Sklep');
  var ixPodmiot = settlementHeaderIndex_(odebraneHeaders, 'Podmiot handlowy');
  var ixPlomba = settlementHeaderIndex_(odebraneHeaders, 'Numer plomby');
  var ixTryb = settlementHeaderIndex_(odebraneHeaders, 'Tryb zbiórki');
  if (ixKod >= 0 && ixMiasto >= 0 && ixUlica >= 0 && ixNumer >= 0 && ixFirma >= 0 && ixData >= 0) {
    var oi;
    for (oi = 0; oi < odebraneRows.length; oi++) {
      var orow = odebraneRows[oi];
      var firma = settlementText_(orow[ixFirma]);
      if (!firma) {
        continue;
      }
      var adres = settlementBuildAddressParts_(orow[ixKod], orow[ixMiasto], orow[ixUlica], orow[ixNumer]);
      if (!adres) {
        continue;
      }
      var closeDate = settlementDateText_(orow[ixData]);
      if (!closeDate || !settlementDateInRange_(closeDate, start, end)) {
        continue;
      }
      var gkey = settlementFoldPl_(adres) + '\n' + closeDate + '\n' + settlementFoldPl_(firma);
      var plomba = ixPlomba >= 0 ? settlementText_(orow[ixPlomba]) : '';
      var zbiorka = ixTryb >= 0 ? settlementText_(orow[ixTryb]) : '';
      if (!bagGroups[gkey]) {
        bagGroups[gkey] = {
          address: adres,
          shopName: ixSklep >= 0 ? settlementText_(orow[ixSklep]) : '',
          podmiot: ixPodmiot >= 0 ? settlementText_(orow[ixPodmiot]) : '',
          contractor: firma,
          pickupDate: closeDate,
          bagCount: 0,
          seals: [],
        };
      }
      bagGroups[gkey].bagCount += 1;
      bagGroups[gkey].seals.push({
        numerPlomby: plomba || String(bagGroups[gkey].bagCount),
        zbiorka: zbiorka,
      });
      if (!bagGroups[gkey].shopName && ixSklep >= 0) {
        bagGroups[gkey].shopName = settlementText_(orow[ixSklep]);
      }
      if (!bagGroups[gkey].podmiot && ixPodmiot >= 0) {
        bagGroups[gkey].podmiot = settlementText_(orow[ixPodmiot]);
      }
    }
  }

  var namesByAddress = {};
  if (ixKod >= 0 && ixMiasto >= 0 && ixUlica >= 0 && ixNumer >= 0) {
    var ni;
    for (ni = 0; ni < odebraneRows.length; ni++) {
      var nrow = odebraneRows[ni];
      var namesAdres = settlementBuildAddressParts_(nrow[ixKod], nrow[ixMiasto], nrow[ixUlica], nrow[ixNumer]);
      if (!namesAdres) {
        continue;
      }
      var namesShop = ixSklep >= 0 ? settlementText_(nrow[ixSklep]) : '';
      var namesPodmiot = ixPodmiot >= 0 ? settlementText_(nrow[ixPodmiot]) : '';
      if (!namesShop && !namesPodmiot) {
        continue;
      }
      var namesKey = settlementFoldPl_(namesAdres);
      if (!namesByAddress[namesKey]) {
        namesByAddress[namesKey] = { shopName: namesShop, podmiot: namesPodmiot };
      } else {
        if (!namesByAddress[namesKey].shopName && namesShop) {
          namesByAddress[namesKey].shopName = namesShop;
        }
        if (!namesByAddress[namesKey].podmiot && namesPodmiot) {
          namesByAddress[namesKey].podmiot = namesPodmiot;
        }
      }
    }
  }

  var expected = {};
  var order = [];

  function ensureExpected(address, contractor, pickupDate, shopName, podmiot, bagCount, rodzajZbiorki) {
    var key = settlementFoldPl_(address) + '\n' + pickupDate + '\n' + settlementFoldPl_(contractor);
    if (!expected[key]) {
      expected[key] = {
        key: key,
        address: address,
        shopName: shopName || '',
        podmiot: podmiot || '',
        contractor: contractor,
        pickupDate: pickupDate,
        bagCount: bagCount || 0,
        rodzajZbiorki: rodzajZbiorki || '',
        routeName: '',
        routeRate: '',
        pickupRate: '',
        bagRate: '',
      };
      order.push(key);
    } else if (bagCount != null) {
      expected[key].bagCount = bagCount;
    }
    if (shopName && !expected[key].shopName) {
      expected[key].shopName = shopName;
    }
    if (podmiot && !expected[key].podmiot) {
      expected[key].podmiot = podmiot;
    }
    if (rodzajZbiorki) {
      expected[key].rodzajZbiorki = rodzajZbiorki;
    }
    return expected[key];
  }

  var sk;
  for (sk in shops) {
    if (!Object.prototype.hasOwnProperty.call(shops, sk)) {
      continue;
    }
    var meta = shops[sk];
    var weekdays = settlementParseWeekdays_(meta.days);
    if (!weekdays.length) {
      continue;
    }
    var dates = settlementDatesMatchingWeekdays_(start, end, weekdays);
    var di;
    for (di = 0; di < dates.length; di++) {
      var day = dates[di];
      if (!settlementPickupReadyForZestawienie_(day, end)) {
        continue;
      }
      var names = namesByAddress[settlementFoldPl_(meta.address)] || {};
      var row = ensureExpected(
        meta.address,
        meta.contractor,
        day,
        names.shopName || '',
        names.podmiot || '',
        0,
        'brak worków',
      );
      var best = null;
      var ri;
      for (ri = 0; ri < rateRows.length; ri++) {
        var rate = rateRows[ri];
        if (
          settlementFoldPl_(rate.shop) !== settlementFoldPl_(meta.address) ||
          settlementFoldPl_(rate.contractor) !== settlementFoldPl_(meta.contractor)
        ) {
          continue;
        }
        if (rate.validFrom && settlementCompareDate_(rate.validFrom, day) > 0) {
          continue;
        }
        if (
          !best ||
          settlementCompareDate_(rate.validFrom || '01.01.1900', best.validFrom || '01.01.1900') > 0
        ) {
          best = rate;
        }
      }
      if (best) {
        row.routeName = best.routeName || '';
        row.routeRate = best.routeAmount != null && best.routeAmount !== '' ? best.routeAmount : '';
        row.pickupRate = best.pickupAmount != null && best.pickupAmount !== '' ? best.pickupAmount : '';
        row.bagRate = best.bagAmount != null && best.bagAmount !== '' ? best.bagAmount : '';
      }
      var bagKey =
        settlementFoldPl_(meta.address) + '\n' + day + '\n' + settlementFoldPl_(meta.contractor);
      if (bagGroups[bagKey]) {
        row.bagCount = bagGroups[bagKey].bagCount;
        row.rodzajZbiorki = scheduleAggregateRodzaj_(bagGroups[bagKey].seals);
        if (bagGroups[bagKey].shopName) {
          row.shopName = bagGroups[bagKey].shopName;
        }
        if (bagGroups[bagKey].podmiot) {
          row.podmiot = bagGroups[bagKey].podmiot;
        }
        delete bagGroups[bagKey];
      }
    }
  }

  var bk;
  for (bk in bagGroups) {
    if (!Object.prototype.hasOwnProperty.call(bagGroups, bk)) {
      continue;
    }
    var g = bagGroups[bk];
    if (!settlementPickupReadyForZestawienie_(g.pickupDate, end)) {
      continue;
    }
    ensureExpected(
      g.address,
      g.contractor,
      g.pickupDate,
      g.shopName,
      g.podmiot,
      g.bagCount,
      scheduleAggregateRodzaj_(g.seals),
    );
  }

  var out = [];
  var oi2;
  for (oi2 = 0; oi2 < order.length; oi2++) {
    out.push(expected[order[oi2]]);
  }
  return out;
}

function scheduleSyncRowKey_(address, pickupDate, contractor) {
  return settlementFoldPl_(address) + '\n' + pickupDate + '\n' + settlementFoldPl_(contractor);
}

/** Rodzaj zbiórki z Tryb zbiórki na workach (jak w protokole). */
function scheduleAggregateRodzaj_(seals) {
  var hasReczna = false;
  var hasMaszyna = false;
  var i;
  for (i = 0; i < (seals || []).length; i++) {
    var s = seals[i];
    if (!s || !settlementText_(s.numerPlomby)) {
      continue;
    }
    var raw = settlementFoldPl_(s.zbiorka);
    if (raw.indexOf('reczn') >= 0 || raw === 'reczna') {
      hasReczna = true;
    }
    if (raw.indexOf('maszyn') >= 0 || raw.indexOf('automat') >= 0) {
      hasMaszyna = true;
    }
  }
  if (hasReczna && hasMaszyna) {
    return 'ręczna i automatyczna';
  }
  if (hasReczna) {
    return 'ręczna';
  }
  if (hasMaszyna) {
    return 'automatyczna';
  }
  return '';
}

function scheduleSyncDefaultWindow_() {
  var now = new Date();
  var y = now.getFullYear();
  var m = now.getMonth() + 1;
  var d = now.getDate();
  return {
    dataOd: settlementFormatDate_(y, m, 1),
    dataDo: settlementFormatDate_(y, m, d),
  };
}
/* settlement-read-pure:end */

/**
 * Sync Harmonogram (miesięczne + legacy) z odebrane + Baza cen.
 * Uzupełnia braki / aktualizuje nierozliczone. NIGDY nie czyści zakładki.
 * Nowe wiersze → zakładka miesięczna z daty odbioru. Update → istniejąca zakładka (po nazwie).
 */
function syncZestawienieHarmonogram_(body) {
  var window = scheduleSyncDefaultWindow_();
  var dataOd = settlementDateText_(body && body.dataOd) || window.dataOd;
  var dataDo = settlementDateText_(body && body.dataDo) || window.dataDo;
  if (settlementCompareDate_(dataOd, dataDo) > 0) {
    return { ok: false, error: 'dataOd after dataDo' };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var baza = ss.getSheetByName(HARMONOGRAM_RATE_SHEET_NAME);
  var odebrane = ss.getSheetByName(ODEBRANE_Z_HARMONOGRAMU_SHEET_NAME);
  var expected = buildScheduleSyncExpected_(
    dataOd,
    dataDo,
    readSettlementCells_(baza, 8),
    readOdebraneSheetRows_(odebrane),
  );
  var existing = scheduleRegisterIndexAll_();
  var created = 0;
  var updated = 0;
  var skippedSettled = 0;
  var ei;
  for (ei = 0; ei < expected.length; ei++) {
    var exp = expected[ei];
    var found = existing.byKey[exp.key];
    if (found) {
      if (found.settled) {
        skippedSettled += 1;
        continue;
      }
      var targetSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(found.sheetName);
      if (!targetSheet) {
        continue;
      }
      var existingBags = found.bagCount != null ? found.bagCount : 0;
      var writeBags = Math.max(existingBags, exp.bagCount || 0);
      targetSheet.getRange(found.row, SCHEDULE_COL.iloscWorkow).setValue(writeBags);
      targetSheet.getRange(found.row, SCHEDULE_COL.rodzajZbiorki).setValue(exp.rodzajZbiorki || '');
      targetSheet.getRange(found.row, SCHEDULE_COL.trasa, 1, 4).setValues([
        [
          exp.routeName || '',
          sheetRateWriteValue_(exp.routeRate),
          sheetRateWriteValue_(exp.pickupRate),
          sheetRateWriteValue_(exp.bagRate),
        ],
      ]);
      if (exp.shopName) {
        targetSheet.getRange(found.row, SCHEDULE_COL.sklep).setValue(exp.shopName);
      }
      if (exp.podmiot) {
        targetSheet.getRange(found.row, SCHEDULE_COL.podmiot).setValue(exp.podmiot);
      }
      updated += 1;
      continue;
    }
    var sheet = getOrCreateMonthRegisterSheet_('schedule', exp.pickupDate);
    var newRow = sheet.getLastRow() + 1;
    if (newRow < 2) {
      newRow = 2;
    }
    var line = [];
    var c;
    for (c = 0; c < SCHEDULE_REGISTER_HEADERS.length; c++) {
      line.push('');
    }
    line[SCHEDULE_COL.adres - 1] = exp.address;
    line[SCHEDULE_COL.podmiot - 1] = exp.podmiot || '';
    line[SCHEDULE_COL.sklep - 1] = exp.shopName || '';
    line[SCHEDULE_COL.dataOdbioru - 1] = exp.pickupDate;
    line[SCHEDULE_COL.ktoOdbiera - 1] = exp.contractor;
    line[SCHEDULE_COL.rodzajZbiorki - 1] = exp.rodzajZbiorki || '';
    line[SCHEDULE_COL.iloscWorkow - 1] = exp.bagCount;
    line[SCHEDULE_COL.trasa - 1] = exp.routeName || '';
    line[SCHEDULE_COL.stawkaTrasy - 1] = sheetRateWriteValue_(exp.routeRate);
    line[SCHEDULE_COL.stawkaPodjazdu - 1] = sheetRateWriteValue_(exp.pickupRate);
    line[SCHEDULE_COL.stawkaWorka - 1] = sheetRateWriteValue_(exp.bagRate);
    sheet.getRange(newRow, 1, 1, line.length).setValues([line]);
    created += 1;
    existing.byKey[exp.key] = {
      sheetName: sheet.getName(),
      row: newRow,
      settled: false,
      bagCount: exp.bagCount || 0,
    };
  }
  return {
    ok: true,
    dataOd: dataOd,
    dataDo: dataDo,
    created: created,
    updated: updated,
    skippedSettled: skippedSettled,
    expected: expected.length,
  };
}

/** Indeks istniejących wierszy Harmonogram (legacy + miesięczne): klucz → lokalizacja. */
function scheduleRegisterIndexAll_() {
  var byKey = {};
  var sheets = listRegisterSheets_('schedule');
  var s;
  for (s = 0; s < sheets.length; s++) {
    var sheet = sheets[s].sheet;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    var width = Math.max(sheet.getLastColumn(), SCHEDULE_COL.kosztPerWorek);
    var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    var i;
    for (i = 0; i < values.length; i++) {
      var mapped = mapSettlementScheduleRegisterRow_(i + 2, values[i], sheets[s].name);
      if (!mapped) {
        continue;
      }
      var key = scheduleSyncRowKey_(mapped.address, mapped.pickupDate, mapped.contractor);
      byKey[key] = {
        sheetName: sheets[s].name,
        row: i + 2,
        settled: mapped.settled,
        bagCount: mapped.bagCount != null ? mapped.bagCount : 0,
      };
    }
  }
  return { byKey: byKey };
}

function isSettlementWriteAction_(action) {
  return (
    action === 'patchBags' ||
    action === 'patchRouteRate' ||
    action === 'detachRoute' ||
    action === 'attachRoute' ||
    action === 'resolveRateTie' ||
    action === 'approve'
  );
}

/**
 * Para klucza: sheetName + sheetRow (+ transportNumber dla Na zgłoszenie).
 * Harmonogram: sheetName + sheetRow (bez nr zlecenia).
 * Rozliczony `tak` też odpada — wiersz nie jest już w zestawieniu.
 * Zwraca { sheet, row } albo { error }.
 */
function registerWriteTarget_(sheet, body) {
  if (!body || body.sheetRow == null) {
    return { error: 'key' };
  }
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var schedule = tryb === 'harmonogram' || tryb === 'schedule';
  var targetSheet = sheet;
  if (body.sheetName != null && settlementText_(body.sheetName) !== '') {
    targetSheet = getRegisterSheetByName_(body.sheetName, schedule ? 'schedule' : 'report');
  }
  if (!targetSheet) {
    return { error: 'key' };
  }
  var row = Number(body.sheetRow);
  if (!isFinite(row) || Math.floor(row) !== row || row < 2 || row > targetSheet.getLastRow()) {
    return { error: 'key' };
  }
  if (!schedule) {
    if (body.transportNumber == null) {
      return { error: 'key' };
    }
    var actual = settlementTransportNumber_(targetSheet.getRange(row, COL.numer).getValue());
    var expected = settlementTransportNumber_(body.transportNumber);
    if (actual !== expected) {
      return { error: 'key' };
    }
    if (settlementFlag_(targetSheet.getRange(row, COL.rozliczony).getValue()) === 'tak') {
      return { error: 'settled' };
    }
  } else {
    if (settlementFlag_(targetSheet.getRange(row, SCHEDULE_COL.rozliczony).getValue()) === 'tak') {
      return { error: 'settled' };
    }
  }
  return { sheet: targetSheet, row: row };
}

/** Puste pole czyści komórkę. Ujemne i nieliczba odpadają. Zero zostaje. */
function parseBagWrite_(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' && settlementText_(value) === '') {
    return { empty: true };
  }
  var count = settlementBagCount_(value);
  if (count == null || count < 0) {
    return null;
  }
  return { empty: false, value: count };
}


/** Sheets: liczba → komórka liczbowa (bez apostrofu tekstowego). Puste → ''. */
function sheetRateWriteValue_(raw) {
  if (raw == null || raw === '') {
    return '';
  }
  if (typeof raw === 'number') {
    return isFinite(raw) ? raw : '';
  }
  var s = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') {
    return '';
  }
  var n = Number(s);
  return isFinite(n) ? n : String(raw).trim();
}

/** Pusta stawka to pusty string, nie null. Zero zostaje zerem. */
function routeRateWriteValue_(parsed) {
  if (parsed.empty) {
    return '';
  }
  return sheetRateWriteValue_(parsed.value);
}

function patchBags_(body) {
  var target = registerWriteTarget_(null, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  var bags = parseBagWrite_(body.iloscWorkow);
  if (!bags) {
    return { ok: false, error: 'bags' };
  }
  var col =
    settlementText_(body && (body.tryb || body.mode)).toLowerCase() === 'harmonogram' ||
    settlementText_(body && (body.tryb || body.mode)).toLowerCase() === 'schedule'
      ? SCHEDULE_COL.iloscWorkow
      : COL.iloscWorkow;
  target.sheet.getRange(target.row, col).setValue(bags.empty ? '' : bags.value);
  return { ok: true };
}

/**
 * Stawka po tekście nazwy, nie po podwykonawcy i nie po dacie.
 * Pusta stawka czyści. Kolumny kosztu nie wchodzą w ten zapis.
 */
function patchRouteRate_(body) {
  var target = registerWriteTarget_(null, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  var name = cellStr_(body.trasa);
  if (!name) {
    return { ok: false, error: 'name' };
  }
  var parsed = parseRateAmount_(body.stawkaTrasy);
  if (!parsed) {
    return { ok: false, error: 'rate' };
  }
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var value = routeRateWriteValue_(parsed);
  if (tryb === 'harmonogram' || tryb === 'schedule') {
    applyRouteRateToScheduleUnsettled_(name, value);
  } else {
    applyRouteRateToUnsettled_(target.sheet, name, value);
  }
  return { ok: true };
}

/** Czyści Trasa i Stawka za trasę jednego wiersza. Reszty trasy nie rusza. */
function detachRoute_(body) {
  var target = registerWriteTarget_(null, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var schedule = tryb === 'harmonogram' || tryb === 'schedule';
  var trasaCol = schedule ? SCHEDULE_COL.trasa : COL.trasa;
  target.sheet.getRange(target.row, trasaCol, 1, 2).setValues([['', '']]);
  return { ok: true };
}

/**
 * Nowa nazwa i stawka na odpiętym wierszu.
 * Pusta stawka nie zapisuje nic, także nazwy. Kwota 0 zapisuje.
 * Potem ta sama reguła co patchRouteRate.
 */
function attachRoute_(body) {
  var target = registerWriteTarget_(null, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  var name = cellStr_(body.trasa);
  if (!name) {
    return { ok: false, error: 'name' };
  }
  var parsed = parseRateAmount_(body.stawkaTrasy);
  if (!parsed || parsed.empty) {
    return { ok: false, error: 'rate' };
  }
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var schedule = tryb === 'harmonogram' || tryb === 'schedule';
  var trasaCol = schedule ? SCHEDULE_COL.trasa : COL.trasa;
  target.sheet.getRange(target.row, trasaCol).setValue(name);
  var value = routeRateWriteValue_(parsed);
  if (schedule) {
    applyRouteRateToScheduleUnsettled_(name, value);
  } else {
    applyRouteRateToUnsettled_(target.sheet, name, value);
  }
  return { ok: true };
}

/**
 * Nie jest zapisem rejestru. Zostawia wskazany wiersz Bazy stawek
 * i usuwa pozostałe z tą samą parą i datą. Zakładki nie zakłada.
 */
function resolveRateTie_(body) {
  var row = Number(body && body.sheetRow);
  if (!isFinite(row) || Math.floor(row) !== row || row < 2) {
    return { ok: false, error: 'key' };
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET_NAME);
  if (!sheet || row > sheet.getLastRow()) {
    return { ok: false, error: 'key' };
  }
  var rows = listRateRows_(sheet);
  var kept = null;
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].row === row) {
      kept = rows[i];
      break;
    }
  }
  if (!kept || kept.validFrom === '\u0000') {
    return { ok: false, error: 'key' };
  }
  var drop = [];
  for (i = 0; i < rows.length; i++) {
    var other = rows[i];
    if (other.row === kept.row) {
      continue;
    }
    if (
      normalizeRateShopKey_(other.shop) === normalizeRateShopKey_(kept.shop) &&
      other.contractor === kept.contractor &&
      other.validFrom === kept.validFrom
    ) {
      drop.push(other.row);
    }
  }
  drop.sort(function (a, b) {
    return b - a;
  });
  for (i = 0; i < drop.length; i++) {
    sheet.deleteRow(drop[i]);
  }
  return { ok: true };
}

function approveSelection_(body) {
  var rows = body && body.wiersze;
  if (!rows || typeof rows === 'string' || typeof rows.length !== 'number' || rows.length < 1) {
    return null;
  }
  return rows;
}

function approveDidNotHappen_(value) {
  if (value === true) {
    return true;
  }
  return settlementFlag_(value) === 'nie';
}

/** Grosze, liczba całkowita >= 0. Złote z ekranu tu nie wchodzą — silnik liczy w groszach. */
function approveCostGrosze_(value) {
  var n = value;
  if (typeof n === 'string') {
    var s = settlementText_(n);
    if (!/^\d+$/.test(s)) {
      return null;
    }
    n = Number(s);
  }
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 0) {
    return null;
  }
  return n;
}

function approveZlotyFromGrosze_(grosze) {
  var whole = Math.floor(grosze / 100);
  var frac = grosze % 100;
  var text = String(whole) + '.' + (frac < 10 ? '0' : '') + String(frac);
  return Number(text);
}

function approveRoundInteger_(numerator, divisor) {
  var quotient = Math.floor(numerator / divisor);
  var remainder = numerator % divisor;
  return remainder * 2 >= divisor ? quotient + 1 : quotient;
}

function approveRoundReal_(value) {
  var floored = Math.floor(value + 1e-10);
  var fraction = value - floored;
  return fraction >= 0.5 - 1e-10 ? floored + 1 : floored;
}

/** Koszt / ilość worków. Pusta ilość albo 0 dzieli przez 1. To nie jest drugie liczenie kosztu. */
function approvePerBagGrosze_(costGrosze, bagCount) {
  var divisor = bagCount != null && bagCount > 0 ? bagCount : 1;
  if (Math.floor(divisor) === divisor) {
    return approveRoundInteger_(costGrosze, divisor);
  }
  return approveRoundReal_(costGrosze / divisor);
}

function approveCompareFrom_(a, b) {
  if (a === b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  return settlementCompareDate_(a, b);
}

function approveRateApplies_(validFrom, pickupDate) {
  if (!validFrom) {
    return true;
  }
  if (validFrom === '\u0000') {
    return false;
  }
  return approveCompareFrom_(validFrom, pickupDate) <= 0;
}

function approveIdentity_(item) {
  var row = item && item.sheetRow != null ? Number(item.sheetRow) : null;
  return {
    sheetName: item && item.sheetName != null ? settlementText_(item.sheetName) : '',
    sheetRow: row,
    transportNumber:
      item && item.transportNumber != null ? settlementTransportNumber_(item.transportNumber) : '',
  };
}

function approveSkip_(item, reason) {
  var id = approveIdentity_(item);
  id.reason = reason;
  return id;
}

function approveSaved_(sheet, row, schedule) {
  var base = {
    sheetName: sheet ? sheet.getName() : '',
    sheetRow: row,
    transportNumber: '',
  };
  if (schedule) {
    return base;
  }
  base.transportNumber = settlementTransportNumber_(sheet.getRange(row, COL.numer).getValue());
  return base;
}

/**
 * Jedyny zapis kolumn rozliczenia. Koszt jest już policzony (`koszt` w groszach).
 * tryb=harmonogram → kolumny SCHEDULE_COL; inaczej Na zgłoszenie COL.
 * Każdy wiersz z body.wiersze[].sheetName — zakładka po nazwie.
 * Bez flagi nieOdbył: transport się odbył = tak + Rozliczony = tak (i koszty).
 * Z flagą nieOdbył: tylko transport się odbył = nie (bez kolumn rozliczenia).
 */
function approve_(body) {
  var invoice = cellStr_(body && body.numerFaktury);
  if (!invoice) {
    return { ok: false, error: 'invoice' };
  }
  var rows = approveSelection_(body);
  if (!rows) {
    return { ok: false, error: 'selection' };
  }
  var tryb = settlementText_(body && (body.tryb || body.mode)).toLowerCase();
  var schedule = tryb === 'harmonogram' || tryb === 'schedule';
  var c = schedule ? SCHEDULE_COL : COL;
  var saved = [];
  var skipped = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var item = rows[i] || {};
    if (schedule) {
      item.tryb = 'harmonogram';
    }
    var target = registerWriteTarget_(null, item);
    if (target.error) {
      skipped.push(approveSkip_(item, target.error));
      continue;
    }
    var sheet = target.sheet;
    var markedNie = approveDidNotHappen_(item && item.nieOdbył);
    var alreadyNie =
      settlementFlag_(sheet.getRange(target.row, c.transportOdbył).getValue()) === 'nie';
    if (alreadyNie && !markedNie) {
      skipped.push(approveSkip_(item, 'nie'));
      continue;
    }
    var pickupDate = settlementDateText_(sheet.getRange(target.row, c.dataOdbioru).getValue());
    if (!pickupDate) {
      skipped.push(approveSkip_(item, 'date'));
      continue;
    }
    if (markedNie) {
      sheet.getRange(target.row, c.transportOdbył).setValue('nie');
      saved.push(approveSaved_(sheet, target.row, schedule));
      continue;
    }
    var cost = approveCostGrosze_(item && item.koszt);
    if (cost == null) {
      skipped.push(approveSkip_(item, 'cost'));
      continue;
    }
    var bags = settlementBagCount_(sheet.getRange(target.row, c.iloscWorkow).getValue());
    var perBag = approvePerBagGrosze_(cost, bags);
    sheet.getRange(target.row, c.transportOdbył).setValue('tak');
    sheet.getRange(target.row, c.rozliczony, 1, 4).setValues([
      ['tak', invoice, approveZlotyFromGrosze_(cost), approveZlotyFromGrosze_(perBag)],
    ]);
    saved.push(approveSaved_(sheet, target.row, schedule));
  }
  return { ok: true, zapisane: saved, pominiete: skipped };
}

function runSettlementWrite_(action, body) {
  if (action === 'patchBags') {
    return patchBags_(body);
  }
  if (action === 'patchRouteRate') {
    return patchRouteRate_(body);
  }
  if (action === 'detachRoute') {
    return detachRoute_(body);
  }
  if (action === 'attachRoute') {
    return attachRoute_(body);
  }
  if (action === 'resolveRateTie') {
    return resolveRateTie_(body);
  }
  if (action === 'approve') {
    return approve_(body);
  }
  return { ok: false, error: 'unknown action' };
}

/**
 * Publiczny entry point do ręcznego uruchomienia z listy Uruchom w edytorze.
 * (Funkcje z `_` na końcu Apps Script ukrywa na liście.)
 */
function migrateRegisterLayoutRates() {
  return migrateRegisterLayoutRates_();
}

function migrateRegisterLayoutTransportOdbył() {
  return migrateRegisterLayoutTransportOdbył_();
}

/** Ręczne: październik 2026 ze starych zakładek → miesięczne (po nazwie). */
function migrateOctober2026ToMonthSheets() {
  return migrateOctober2026ToMonthSheets_();
}

/**
 * Przenosi wiersze z datą odbioru w 10.2026:
 * Arkusz1 → Na zgłoszenie Październik 2026
 * zestawienie z harmonogramu → Harmonogram Październik 2026
 * Starsze miesiące zostają w legacy.
 */
function migrateOctober2026ToMonthSheets_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var report = migrateMonthRowsFromLegacy_(
      'report',
      REGISTER_SHEET_NAME,
      10,
      2026,
      COL.dataOdbioru,
      COL.komentarz2,
    );
    var schedule = migrateMonthRowsFromLegacy_(
      'schedule',
      SCHEDULE_REGISTER_SHEET_NAME,
      10,
      2026,
      SCHEDULE_COL.dataOdbioru,
      SCHEDULE_COL.komentarz2,
    );
    return { ok: true, report: report, schedule: schedule };
  } finally {
    lock.releaseLock();
  }
}

/**
 * @returns {{ moved: number, targetSheet: string, skipped: number }}
 */
function migrateMonthRowsFromLegacy_(kind, legacyName, month, year, dateCol, lastCol) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var legacy = ss.getSheetByName(legacyName);
  var targetName =
    kind === 'schedule'
      ? SCHEDULE_MONTH_SHEET_PREFIX + MONTH_NAMES_PL[month - 1] + ' ' + year
      : REPORT_MONTH_SHEET_PREFIX + MONTH_NAMES_PL[month - 1] + ' ' + year;
  if (!legacy) {
    return { moved: 0, targetSheet: targetName, skipped: 0 };
  }
  var lastRow = legacy.getLastRow();
  if (lastRow < 2) {
    return { moved: 0, targetSheet: targetName, skipped: 0 };
  }
  var width = Math.max(legacy.getLastColumn(), lastCol);
  var values = legacy.getRange(2, 1, lastRow - 1, width).getValues();
  var moveIdx = [];
  var i;
  for (i = 0; i < values.length; i++) {
    var parts = parsePickupDateParts_(values[i][dateCol - 1]);
    if (parts && parts.month === month && parts.year === year) {
      moveIdx.push(i);
    }
  }
  if (moveIdx.length === 0) {
    return { moved: 0, targetSheet: targetName, skipped: 0 };
  }
  var target = getOrCreateMonthRegisterSheet_(
    kind,
    '01.' + (month < 10 ? '0' : '') + month + '.' + year,
  );
  var rowsToAppend = [];
  for (i = 0; i < moveIdx.length; i++) {
    var src = values[moveIdx[i]];
    var line = [];
    var c;
    for (c = 0; c < width; c++) {
      line.push(src[c] != null ? src[c] : '');
    }
    rowsToAppend.push(line);
  }
  var startRow = Math.max(target.getLastRow() + 1, 2);
  target.getRange(startRow, 1, rowsToAppend.length, width).setValues(rowsToAppend);
  for (i = moveIdx.length - 1; i >= 0; i--) {
    legacy.deleteRow(moveIdx[i] + 2);
  }
  return { moved: moveIdx.length, targetSheet: target.getName(), skipped: 0 };
}

/**
 * Jednorazowa migracja układu rejestru V1 → V3.
 * V1: komentarze 10–11, trasa 12–13, rozliczenie 14–18.
 * V3: transport@10, trasa 11–12, podjazd/worek 13–14, rozliczenie 15–18, komentarze 19–20.
 * Przy V2: uruchom migrateRegisterLayoutTransportOdbył.
 * Idempotentna: gdy układ jest już V3, nic nie robi.
 */
function migrateRegisterLayoutRates_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getDataSheet_();
    if (isRegisterLayoutV3_(sheet)) {
      Logger.log(JSON.stringify({ ok: true, skipped: true, reason: 'already-v3' }));
      return { ok: true, skipped: true, reason: 'already-v3' };
    }
    if (isRegisterLayoutV2_(sheet)) {
      var v2msg = {
        ok: false,
        error: 'use-migrateRegisterLayoutTransportOdbył',
        h10: settlementText_(sheet.getRange(1, 10).getValue()),
        h12: settlementText_(sheet.getRange(1, 12).getValue()),
      };
      Logger.log(JSON.stringify(v2msg));
      return v2msg;
    }
    if (!isRegisterLayoutV1_(sheet)) {
      var msg = {
        ok: false,
        error: 'unknown-layout',
        h10: settlementText_(sheet.getRange(1, 10).getValue()),
        h12: settlementText_(sheet.getRange(1, 12).getValue()),
      };
      Logger.log(JSON.stringify(msg));
      return msg;
    }
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), 18);
    var width = Math.max(lastCol, 18);
    var oldHeader = sheet.getRange(1, 1, 1, width).getValues()[0];
    var oldData =
      lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    var rateSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET_NAME);
    var rateList = rateSheet ? listRateAmountRows_(rateSheet) : [];
    var newHeader = [];
    var c;
    for (c = 0; c < 9; c++) {
      newHeader.push(oldHeader.length > c ? oldHeader[c] : '');
    }
    for (c = 0; c < REGISTER_HEADERS_10_20.length; c++) {
      newHeader.push(REGISTER_HEADERS_10_20[c]);
    }
    var newRows = [];
    var i;
    for (i = 0; i < oldData.length; i++) {
      var src = oldData[i];
      var cellAt = function (idx) {
        return src.length > idx && src[idx] != null ? src[idx] : '';
      };
      var adres = cellStr_(cellAt(1));
      var kto = cellStr_(cellAt(5));
      var pickupDate = settlementDateText_(cellAt(4)) || '';
      var snapshot = resolveSnapshotFromRateList_(rateList, adres, kto, pickupDate);
      var next = [];
      for (c = 0; c < 9; c++) {
        next.push(cellAt(c));
      }
      // V1: 10–11 komentarze, 12–13 trasa/stawka, 14–18 rozliczenie (+ transport w 18)
      next.push(cellAt(17));
      next.push(cellAt(11));
      next.push(cellAt(12));
      next.push(snapshot.pickup);
      next.push(snapshot.bag);
      for (c = 13; c <= 16; c++) {
        next.push(cellAt(c));
      }
      next.push(cellAt(9));
      next.push(cellAt(10));
      newRows.push(next);
    }
    var clearWidth = Math.max(width, COL.komentarz2);
    var clearRows = Math.max(lastRow, 1);
    sheet.getRange(1, 1, clearRows, clearWidth).clearContent();
    sheet.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
    if (newRows.length > 0) {
      sheet.getRange(2, 1, newRows.length, COL.komentarz2).setValues(newRows);
    }
    ensureTransportHappenedRules_(sheet);
    var result = {
      ok: true,
      rows: newRows.length,
      ratesLoaded: rateList.length,
      h10: settlementText_(sheet.getRange(1, 10).getValue()),
      h11: settlementText_(sheet.getRange(1, 11).getValue()),
      h13: settlementText_(sheet.getRange(1, 13).getValue()),
      h19: settlementText_(sheet.getRange(1, 19).getValue()),
    };
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * V2 → V3: „transport się odbył” z kolumny 18 → 10 (Arkusz1) oraz 17 → 9 (zestawienie).
 * Idempotentna. Wywołanie: migrateRegisterLayoutTransportOdbył (bez _).
 */
function migrateRegisterLayoutTransportOdbył_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var arkusz = migrateArkusz1TransportOdbyłColumn_();
    var zestawienie = migrateScheduleTransportOdbyłColumn_();
    var result = { ok: true, arkusz1: arkusz, zestawienie: zestawienie };
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function migrateArkusz1TransportOdbyłColumn_() {
  var sheet = getDataSheet_();
  if (isRegisterLayoutV3_(sheet)) {
    return { ok: true, skipped: true, reason: 'already-v3' };
  }
  if (!isRegisterLayoutV2_(sheet)) {
    return {
      ok: false,
      error: isRegisterLayoutV1_(sheet) ? 'use-migrateRegisterLayoutRates' : 'unknown-layout',
      h10: settlementText_(sheet.getRange(1, 10).getValue()),
      h12: settlementText_(sheet.getRange(1, 12).getValue()),
    };
  }
  var lastRow = sheet.getLastRow();
  var width = Math.max(sheet.getLastColumn(), 20);
  var oldHeader = sheet.getRange(1, 1, 1, width).getValues()[0];
  var oldData = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  var newHeader = [];
  var c;
  for (c = 0; c < 9; c++) {
    newHeader.push(oldHeader.length > c ? oldHeader[c] : '');
  }
  for (c = 0; c < REGISTER_HEADERS_10_20.length; c++) {
    newHeader.push(REGISTER_HEADERS_10_20[c]);
  }
  var newRows = [];
  var i;
  for (i = 0; i < oldData.length; i++) {
    var src = oldData[i];
    var cellAt = function (idx) {
      return src.length > idx && src[idx] != null ? src[idx] : '';
    };
    var next = [];
    for (c = 0; c < 9; c++) {
      next.push(cellAt(c));
    }
    // V2: 10–17 trasa…koszt/worek, 18 transport, 19–20 komentarze
    next.push(cellAt(17));
    for (c = 9; c <= 16; c++) {
      next.push(cellAt(c));
    }
    next.push(cellAt(18));
    next.push(cellAt(19));
    newRows.push(next);
  }
  var clearRows = Math.max(lastRow, 1);
  sheet.getRange(1, 1, clearRows, Math.max(width, COL.komentarz2)).clearContent();
  sheet.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, COL.komentarz2).setValues(newRows);
  }
  ensureTransportHappenedRules_(sheet);
  return {
    ok: true,
    rows: newRows.length,
    h10: settlementText_(sheet.getRange(1, 10).getValue()),
    h11: settlementText_(sheet.getRange(1, 11).getValue()),
  };
}

function isScheduleLayoutV3_(sheet) {
  return (
    settlementText_(sheet.getRange(1, SCHEDULE_COL.transportOdbył).getValue()) ===
      'transport się odbył' &&
    settlementText_(sheet.getRange(1, SCHEDULE_COL.trasa).getValue()) === 'Trasa'
  );
}

function isScheduleLayoutV2_(sheet) {
  if (isScheduleLayoutV3_(sheet)) {
    return false;
  }
  return (
    settlementText_(sheet.getRange(1, 9).getValue()) === 'Trasa' &&
    settlementText_(sheet.getRange(1, 11).getValue()) === REGISTER_LAYOUT_V2_MARKER
  );
}

function migrateScheduleTransportOdbyłColumn_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SCHEDULE_REGISTER_SHEET_NAME);
  if (!sheet) {
    return { ok: true, skipped: true, reason: 'no-sheet' };
  }
  if (isScheduleLayoutV3_(sheet)) {
    return { ok: true, skipped: true, reason: 'already-v3' };
  }
  if (!isScheduleLayoutV2_(sheet)) {
    var h9 = settlementText_(sheet.getRange(1, 9).getValue());
    if (!h9) {
      sheet.getRange(1, 1, 1, SCHEDULE_REGISTER_HEADERS.length).setValues([SCHEDULE_REGISTER_HEADERS]);
      ensureScheduleTransportHappenedRules_(sheet);
      return { ok: true, rows: 0, reason: 'headers-written' };
    }
    return {
      ok: false,
      error: 'unknown-layout',
      h9: h9,
      h11: settlementText_(sheet.getRange(1, 11).getValue()),
    };
  }
  var lastRow = sheet.getLastRow();
  var width = Math.max(sheet.getLastColumn(), 19);
  var oldHeader = sheet.getRange(1, 1, 1, width).getValues()[0];
  var oldData = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  var newHeader = [];
  var c;
  for (c = 0; c < 8; c++) {
    newHeader.push(oldHeader.length > c ? oldHeader[c] : '');
  }
  for (c = 8; c < SCHEDULE_REGISTER_HEADERS.length; c++) {
    newHeader.push(SCHEDULE_REGISTER_HEADERS[c]);
  }
  var newRows = [];
  var i;
  for (i = 0; i < oldData.length; i++) {
    var src = oldData[i];
    var cellAt = function (idx) {
      return src.length > idx && src[idx] != null ? src[idx] : '';
    };
    var next = [];
    for (c = 0; c < 8; c++) {
      next.push(cellAt(c));
    }
    // V2 schedule: 9–16 trasa…koszt/worek, 17 transport, 18–19 komentarze
    next.push(cellAt(16));
    for (c = 8; c <= 15; c++) {
      next.push(cellAt(c));
    }
    next.push(cellAt(17));
    next.push(cellAt(18));
    newRows.push(next);
  }
  var clearRows = Math.max(lastRow, 1);
  sheet.getRange(1, 1, clearRows, Math.max(width, SCHEDULE_COL.komentarz2)).clearContent();
  sheet.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, SCHEDULE_COL.komentarz2).setValues(newRows);
  }
  ensureScheduleTransportHappenedRules_(sheet);
  return {
    ok: true,
    rows: newRows.length,
    h9: settlementText_(sheet.getRange(1, 9).getValue()),
    h10: settlementText_(sheet.getRange(1, 10).getValue()),
  };
}

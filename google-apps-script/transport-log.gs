/**
 * Rejestr transportów + słowniki referencyjne — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * GET ?action=modalData&podmiot=…&adres=…  (zalecane — jeden request)
 * GET ?action=bulkLastTransportDates  (ostatnie daty + kto odbiera dla wszystkich sklepów — mapa)
 * GET ?action=previewNumber
 * GET ?action=lastTransportDate&podmiot=…&adres=…  (data + kto odbiera)
 * GET ?action=listReferenceData  → { ok, data: { podwykoLista, poprawAdres } }
 * GET ?action=routeNameProposal  → { ok, names }  (kolumna 10, zajęte nazwy; propozycję liczy strona)
 * GET ?action=routeRateByName&name=…  → { ok, stawka }  (stawka z nierozliczonego wiersza, pusta gdy nazwy nie było)
 * GET ?action=listContractors  → { ok, data: [ { nazwa, dane } ] }  (odczyt, bez zapisu)
 * GET ?action=listStoreAddresses → { ok, data: [ { adres, sklep }, … ] }
 *   Unikalny adres z kolumny 2. Nazwa z kolumny 4 (Sklep), pierwsza niepusta. Zapis stawki i tak idzie adresem. Bez zapisu.
 * GET ?action=settlementSearch&podwykonawca=…&dataDo=dd.mm.yyyy&dataOd=…
 *   dataOd opcjonalna. To samo POST { action: settlementSearch, … }. Nic nie zapisuje.
 * POST { action: patchBags | patchRouteRate | detachRoute | attachRoute | resolveRateTie | approve }
 *   Zapis od razu, pod tym samym lockiem co protokół. saveRate tu nie powstaje drugi raz.
 *   Rejestr: sheetRow + transportNumber. Odpada, gdy w tym wierszu kolumna 1 jest inna.
 *   Kolumn 16 i 17 nie ruszają patchBags, patchRouteRate, detachRoute, attachRoute.
 *   resolveRateTie pisze tylko w Bazie stawek.
 *   approve — jedyny zapis kolumn 14–17. Bez numeru faktury albo bez zaznaczenia odmawia całości.
 *   Zła para i wiersz już `tak` pomija, resztę zaznaczenia zapisuje. Koszt bierze z body, nie z bazy.
 *   Remisu z Bazy stawek nie blokuje (koszt ze snapshotu kolumn 12–13).
 *   Sklep z „nie odbył się” dostaje samo `nie` w kolumnie 18. Wiersza spoza zaznaczenia nie rusza.
 *   Na żywy arkusz approve wchodzi w W1, nie w M6. Nagłówków rejestru nie wpisuje.
 * POST (body JSON, Content-Type: text/plain):
 *   (brak mode) — append wiersza transportu + atomowa numeracja
 *   Opcjonalnie `trasa` i `stawkaTrasy` (kolumny 10–11). Bez klucza `trasa` te kolumny zostają puste.
 *   Pusta `stawkaTrasy` zostaje pusta tylko na nowym wierszu i nie czyści stawki innych wierszy tej nazwy.
 *   Kwota, także 0, idzie od razu na pozostałe nierozliczone wiersze z tym samym tekstem w kolumnie 10.
 *   Kolumny 12–13 (Stawka za podjazd / Stawka za worek) zawsze ze snapshotu Bazy stawek
 *   (adres + kto odbiera + data odbioru). Remis albo brak pary → puste.
 *   Komentarze 1–2 na kolumnach 19–20.
 *   mode=addReferencePodwyko | addPoprawAdres | saveRate
 *   (legacy: addReferencePrzewoznik | addReferenceDostawa → zapis do Lista podwykonawców)
 *   saveRate — Baza stawek. Body: sklep, podwykonawca, kwotaPodjazd, kwotaWorek, odKiedy.
 *   Jeden wiersz klucza nadpisuje kwoty. Dwa i więcej: { ok:false, error:'tie' }. Inna data: nowy wiersz.
 *   Kwota 0 i puste pole są dozwolone. Usuwania nie ma. Rejestru (kolumny 14–17) nie rusza.
 *   Brak zakładki Baza stawek: ten zapis ją zakłada, z nagłówkami w wierszu 1.
 * migrateRegisterLayoutRates_ — jednorazowa migracja układu V2 (wywołanie ręczne z edytora).
 *
 * Zakładki referencyjne (ten sam arkusz, poza pierwszą z transportami):
 *   Lista podwykonawców, Popraw adres, Baza stawek
 *   (legacy odczyt: Przewoźnicy, Miejsca dostawy — scalane przy listReferenceData)
 */

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
  trasa: 10,
  stawkaTrasy: 11,
  stawkaPodjazdu: 12,
  stawkaWorka: 13,
  rozliczony: 14,
  numerFaktury: 15,
  kosztOdbioru: 16,
  kosztPerWorek: 17,
  transportOdbył: 18,
  komentarz1: 19,
  komentarz2: 20,
};

/** Tekst nagłówka, nie pusta komórka. Kolumn 1–9 to nie rusza. Aplikacja rozliczeń tego nie wpisuje. */
var REGISTER_HEADERS_10_20 = [
  'Trasa',
  'Stawka za trasę',
  'Stawka za podjazd',
  'Stawka za worek',
  'Rozliczony',
  'Numer faktury',
  'Koszt odbioru',
  'Koszt odbioru per worek',
  'transport się odbył',
  'Komentarz 1',
  'Komentarz 2',
];

/** Marker migracji V2 — nagłówek kolumny 12 po przełożeniu komentarzy. */
var REGISTER_LAYOUT_V2_MARKER = 'Stawka za podjazd';

/** R to kolumna 18. Reguła arkusza, nie klasa w przeglądarce. */
var TRANSPORT_HAPPENED_STRIKE_FORMULA = '=$R2="nie"';

var TRANSPORT_MAX_NUM_KEY = 'transportMaxNum';
var TRANSPORT_LAST_ROW_KEY = 'transportLastRow';

var REF_PODWYKO_SHEET_NAME = 'Lista podwykonawców';
var REF_PRZ_SHEET_NAME = 'Przewoźnicy';
var REF_DOS_SHEET_NAME = 'Miejsca dostawy';
var REF_POPRAW_SHEET_NAME = 'Popraw adres';
var RATE_SHEET_NAME = 'Baza stawek';

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
    if (action === 'settlementSearch') {
      return jsonResponse(settlementSearch_(e.parameter));
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
    var numer = resolveTransportNumber_(body);
    appendTransportRow_(numer, body);
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

function getDataSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

/** Kolumna 10, bez pustych. Propozycję nazwy liczy strona, nie ten skrypt. */
function listOccupiedRouteNames_() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  var names = [];
  var seen = {};
  if (lastRow < 2) {
    return names;
  }
  var values = sheet.getRange(2, COL.trasa, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0] == null ? '' : values[i][0]).trim();
    if (!name || seen[name]) {
      continue;
    }
    seen[name] = true;
    names.push(name);
  }
  return names;
}

/**
 * Stawka z ostatniego nierozliczonego wiersza o tym tekście w kolumnie 10.
 * Rozliczony `tak` pomija. Brak nazwy albo sama pusta stawka: pusty string. Zero zostaje.
 */
function routeRateByName_(name) {
  var wanted = String(name == null ? '' : name).trim();
  if (!wanted) {
    return '';
  }
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return '';
  }
  var numRows = lastRow - 1;
  var names = sheet.getRange(2, COL.trasa, numRows, 1).getValues();
  var rates = sheet.getRange(2, COL.stawkaTrasy, numRows, 1).getValues();
  var settled = sheet.getRange(2, COL.rozliczony, numRows, 1).getValues();
  var found = null;
  for (var i = 0; i < numRows; i++) {
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

function setStoredLastRow_(row) {
  PropertiesService.getScriptProperties().setProperty(TRANSPORT_LAST_ROW_KEY, String(row));
}

function clearStoredLastRow_() {
  PropertiesService.getScriptProperties().deleteProperty(TRANSPORT_LAST_ROW_KEY);
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

function scanMaxNumberAndRowFromSheet_() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { max: 0, row: 0 };
  }
  var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
  var max = 0;
  var maxRow = 0;
  for (var i = 0; i < values.length; i++) {
    var n = parseNumberFromCell_(values[i][0]);
    if (n != null && n >= max) {
      max = n;
      maxRow = i + 2;
    }
  }
  return { max: max, row: maxRow };
}

function scanMaxNumberFromSheet_() {
  return scanMaxNumberAndRowFromSheet_().max;
}

function isNumberAtRow_(expected, row) {
  var sheet = getDataSheet_();
  if (row > sheet.getLastRow()) {
    return false;
  }
  return parseNumberFromCell_(sheet.getRange(row, COL.numer).getValue()) === expected;
}

/** O(1): cache wiersza ostatniego zapisu; pełny skan tylko gdy brak cache (np. po migracji). */
function isLastAssignedNumberStillInSheet_(stored) {
  if (stored <= 0) {
    return true;
  }
  var row = getStoredLastRow_();
  if (row == null) {
    row = findHighestRowWithNumber_(stored);
    if (row != null) {
      setStoredLastRow_(row);
    }
  }
  if (row == null) {
    return false;
  }
  return isNumberAtRow_(stored, row);
}

function findHighestRowWithNumber_(target) {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
  var foundRow = null;
  for (var i = 0; i < values.length; i++) {
    if (parseNumberFromCell_(values[i][0]) === target) {
      foundRow = i + 2;
    }
  }
  return foundRow;
}

function ensureStoredMaxNumberSeeded_() {
  var stored = getStoredMaxNumber_();
  if (stored != null) {
    return stored;
  }
  var result = scanMaxNumberAndRowFromSheet_();
  setStoredMaxNumber_(result.max);
  if (result.row > 0) {
    setStoredLastRow_(result.row);
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
 * Na starym układzie (komentarze w 10–11) nie dopisuje nagłówków V2 — to psuje arkusz.
 * W tym samym kroku, raz: lista `tak` / `nie` na kolumnie 18 i przekreślenie wiersza z `nie`.
 */
function ensureTransportRegisterColumns_(sheet) {
  if (isRegisterLayoutV1_(sheet)) {
    return;
  }
  var width = REGISTER_HEADERS_10_20.length;
  var range = sheet.getRange(1, COL.trasa, 1, width);
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

/** V2: kolumna 10 = Trasa, kolumna 12 = Stawka za podjazd. */
function isRegisterLayoutV2_(sheet) {
  return (
    settlementText_(sheet.getRange(1, COL.trasa).getValue()) === 'Trasa' &&
    settlementText_(sheet.getRange(1, COL.stawkaPodjazdu).getValue()) === REGISTER_LAYOUT_V2_MARKER
  );
}

/**
 * V1 / stan pośredni: komentarze nadal w 10–11 albo Trasa nadal w 12.
 * Dopisane puste nagłówki komentarzy w 19–20 nie oznaczają V2.
 */
function isRegisterLayoutV1_(sheet) {
  if (isRegisterLayoutV2_(sheet)) {
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
      .setRanges([sheet.getRange(2, 1, gridRows, COL.transportOdbył)])
      .build();
    var rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);
  }
}

/**
 * Ten sam tekst w kolumnie 10, bez filtra podwykonawcy i dat.
 * Rozliczony `tak` pomija. Kolumny 16 i 17 nie są w tym zapisie.
 * Lock trzyma `doPost`, tak jak przy numerze protokołu.
 */
function applyRouteRateToUnsettled_(sheet, name, rate) {
  var wanted = String(name == null ? '' : name).trim();
  if (!wanted) {
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  var numRows = lastRow - 1;
  var names = sheet.getRange(2, COL.trasa, numRows, 1).getValues();
  var settled = sheet.getRange(2, COL.rozliczony, numRows, 1).getValues();
  var next = rate == null ? '' : String(rate).trim();
  for (var i = 0; i < numRows; i++) {
    var rowName = String(names[i][0] == null ? '' : names[i][0]).trim();
    if (rowName !== wanted) {
      continue;
    }
    var flag = String(settled[i][0] == null ? '' : settled[i][0]).trim().toLowerCase();
    if (flag === 'tak') {
      continue;
    }
    sheet.getRange(i + 2, COL.stawkaTrasy).setValue(next);
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
  var matching = [];
  var i;
  for (i = 0; i < rates.length; i++) {
    var rate = rates[i];
    if (rate.shop !== shop || rate.contractor !== contractor) {
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
  var sheet = getDataSheet_();
  if (isRegisterLayoutV1_(sheet)) {
    throw new Error(
      'Rejestr ma stary układ kolumn (komentarze w J/K). Uruchom migrateRegisterLayoutRates_ w Apps Script, potem wdróż Web App.',
    );
  }
  ensureTransportRegisterColumns_(sheet);
  var adres = body.adresSklepu || '';
  var kto = body.ktoOdbiera || '';
  var dataOdbioru = body.dataOdbioru || '';
  var pickupDate = settlementDateText_(dataOdbioru) || '';
  var snapshot = resolveRegisterRateSnapshot_(cellStr_(adres), cellStr_(kto), pickupDate);
  var routeName = '';
  var routeRate = '';
  if (bodyHasRoute_(body)) {
    routeName = body.trasa == null ? '' : String(body.trasa).trim();
    routeRate = body.stawkaTrasy == null ? '' : String(body.stawkaTrasy).trim();
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
    routeName,
    routeRate,
    snapshot.pickup,
    snapshot.bag,
    '',
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
    setStoredLastRow_(sheet.getLastRow());
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
 * Od adresu do kolumny 18. Komórki poza siatką nie ma w wierszu: to samo co pusta.
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
 * Wiersz z kolumną 18 = `nie` nie ustawia daty odcięcia.
 */
function buildBulkLastTransportDatesMap_() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  var result = {};
  if (lastRow < 2) {
    return result;
  }
  var rows = readTransportPickupRows_(sheet, lastRow);
  for (var i = 0; i < rows.length; i++) {
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

/** @returns {{ ms: number, ktoOdbiera: string }|null} Wiersz z kolumną 18 = `nie` nie jest ostatnim odbiorem. */
function findLastTransportInfo_(podmiot, adres) {
  if (!normalizeTransportKeyPart_(adres)) {
    return null;
  }
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var rows = readTransportPickupRows_(sheet, lastRow);
  var best = null;

  for (var i = 0; i < rows.length; i++) {
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
  var s = String(text || '')
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

function decideSaveRate_(rows, shop, contractor, validFrom) {
  var matches = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.shop === shop && row.contractor === contractor && row.validFrom === validFrom) {
      matches.push(row.row);
    }
  }
  if (matches.length > 1) {
    return { action: 'refuse' };
  }
  if (matches.length === 1) {
    return { action: 'overwrite', row: matches[0] };
  }
  return { action: 'append' };
}

function rateCellDateKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return normalizeRateDate_(value.getDate() + '.' + (value.getMonth() + 1) + '.' + value.getFullYear());
  }
  return normalizeRateDate_(value);
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
  if (decision.action === 'refuse') {
    return jsonResponse({ ok: false, error: 'tie' });
  }
  var pickupCell = rateAmountCell_(pickup);
  var bagCell = rateAmountCell_(bag);
  if (decision.action === 'overwrite') {
    sheet.getRange(decision.row, 3, 1, 2).setValues([[pickupCell, bagCell]]);
    return jsonResponse({ ok: true, action: 'overwrite' });
  }
  var next = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(next, 5).setNumberFormat('@');
  sheet.getRange(next, 1, 1, 5).setValues([[shop, contractor, pickupCell, bagCell, validFrom]]);
  sheet.getRange(next, 5).setNumberFormat('@').setValue(String(validFrom));
  return jsonResponse({ ok: true, action: 'append' });
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
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var width = COL.sklep - COL.adres + 1;
  var values = sheet.getRange(2, COL.adres, lastRow - 1, width).getValues();
  return uniqueStoreAddresses_(values);
}

function uniqueStoreAddresses_(rows) {
  var byAddress = {};
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
    if (!byAddress[adres]) {
      byAddress[adres] = { adres: adres, sklep: sklep };
      order.push(adres);
    } else if (!byAddress[adres].sklep && sklep) {
      byAddress[adres].sklep = sklep;
    }
  }
  var out = [];
  for (i = 0; i < order.length; i++) {
    out.push(byAddress[order[i]]);
  }
  out.sort(function (a, b) {
    return a.adres.localeCompare(b.adres, 'pl');
  });
  return out;
}

/**
 * Odczyt zestawienia. Nie bierze locka i nic nie zapisuje.
 * Brak zakładki Baza stawek to pusta lista stawek, nie nowa zakładka.
 */
function settlementSearch_(query) {
  var rateSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET_NAME);
  return buildSettlementRead_(
    query,
    readSettlementCells_(getDataSheet_(), COL.transportOdbył),
    readSettlementCells_(rateSheet, 5),
  );
}

/** Czyta istniejące kolumny i dopina puste. Nie woła setValue. Brak kolumny 18 = transport się odbył. */
function readSettlementCells_(sheet, width) {
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
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var cells = [];
    var row = values[i];
    for (var c = 0; c < width; c++) {
      cells.push(c < row.length && row[c] != null ? row[c] : '');
    }
    out.push({ sheetRow: i + 2, cells: cells });
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

/** Tekst dd.mm.yyyy albo null. Puste i ISO nie przechodzą. Data z arkusza (obiekt) idzie składnikami lokalnymi. */
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
  if (!match) {
    return null;
  }
  var d = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var y = parseInt(match[3], 10);
  if (!settlementCalendarOk_(y, m, d)) {
    return null;
  }
  return settlementFormatDate_(y, m, d);
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

function mapSettlementRegisterRow_(sheetRow, cells) {
  var pickupDate = settlementDateText_(settlementCell_(cells, 4));
  if (!pickupDate) {
    return null;
  }
  return {
    sheetRow: sheetRow,
    transportNumber: settlementTransportNumber_(settlementCell_(cells, 0)),
    address: settlementText_(settlementCell_(cells, 1)),
    shopName: settlementText_(settlementCell_(cells, 3)),
    pickupDate: pickupDate,
    contractor: settlementText_(settlementCell_(cells, 5)),
    bagCount: settlementBagCount_(settlementCell_(cells, 8)),
    routeName: settlementText_(settlementCell_(cells, 9)),
    routeRate: settlementAmountToGrosze_(settlementCell_(cells, 10)),
    pickupRate: settlementAmountToGrosze_(settlementCell_(cells, 11)),
    bagRate: settlementAmountToGrosze_(settlementCell_(cells, 12)),
    settled: settlementFlag_(settlementCell_(cells, 13)) === 'tak',
    didNotHappen: settlementFlag_(settlementCell_(cells, 17)) === 'nie',
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
    var mapped = mapSettlementRegisterRow_(item.sheetRow, item.cells);
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
/* settlement-read-pure:end */

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
 * Para klucza: numer wiersza i numer z kolumny 1.
 * Rozliczony `tak` też odpada — wiersz nie jest już w zestawieniu.
 * Zwraca { row } albo { error }.
 */
function registerWriteTarget_(sheet, body) {
  if (!body || body.sheetRow == null || body.transportNumber == null) {
    return { error: 'key' };
  }
  var row = Number(body.sheetRow);
  if (!isFinite(row) || Math.floor(row) !== row || row < 2 || row > sheet.getLastRow()) {
    return { error: 'key' };
  }
  var actual = settlementTransportNumber_(sheet.getRange(row, COL.numer).getValue());
  var expected = settlementTransportNumber_(body.transportNumber);
  if (actual !== expected) {
    return { error: 'key' };
  }
  if (settlementFlag_(sheet.getRange(row, COL.rozliczony).getValue()) === 'tak') {
    return { error: 'settled' };
  }
  return { row: row };
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

/** Pusta stawka to pusty string, nie null. Zero zostaje zerem. */
function routeRateWriteValue_(parsed) {
  if (parsed.empty) {
    return '';
  }
  return parsed.value;
}

function patchBags_(body) {
  var sheet = getDataSheet_();
  var target = registerWriteTarget_(sheet, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  var bags = parseBagWrite_(body.iloscWorkow);
  if (!bags) {
    return { ok: false, error: 'bags' };
  }
  sheet.getRange(target.row, COL.iloscWorkow).setValue(bags.empty ? '' : bags.value);
  return { ok: true };
}

/**
 * Stawka po tekście nazwy, nie po podwykonawcy i nie po dacie.
 * Pusta stawka czyści. Kolumny 16 i 17 nie wchodzą w ten zapis.
 */
function patchRouteRate_(body) {
  var sheet = getDataSheet_();
  var target = registerWriteTarget_(sheet, body);
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
  applyRouteRateToUnsettled_(sheet, name, routeRateWriteValue_(parsed));
  return { ok: true };
}

/** Czyści Trasa i Stawka za trasę jednego wiersza. Reszty trasy nie rusza. */
function detachRoute_(body) {
  var sheet = getDataSheet_();
  var target = registerWriteTarget_(sheet, body);
  if (target.error) {
    return { ok: false, error: target.error };
  }
  sheet.getRange(target.row, COL.trasa, 1, 2).setValues([['', '']]);
  return { ok: true };
}

/**
 * Nowa nazwa i stawka na odpiętym wierszu.
 * Pusta stawka nie zapisuje nic, także nazwy. Kwota 0 zapisuje.
 * Potem ta sama reguła co patchRouteRate.
 */
function attachRoute_(body) {
  var sheet = getDataSheet_();
  var target = registerWriteTarget_(sheet, body);
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
  sheet.getRange(target.row, COL.trasa).setValue(name);
  applyRouteRateToUnsettled_(sheet, name, routeRateWriteValue_(parsed));
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
      other.shop === kept.shop &&
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

function approveSaved_(sheet, row) {
  return {
    sheetRow: row,
    transportNumber: settlementTransportNumber_(sheet.getRange(row, COL.numer).getValue()),
  };
}

/**
 * Jedyny zapis kolumn 14–17. Koszt jest już policzony (`koszt` w groszach).
 * Opcja samych worków i kwoty podjazdu oraz worka z zestawienia jadą w body,
 * bo arkusz ich nie pamięta na kolumnach rozliczenia. Ten skrypt ich nie czyta
 * i nie liczy kosztu z bazy drugi raz. Remisu z Bazy stawek nie sprawdza —
 * koszt jest ze snapshotu kolumn 12–13 (ew. nadpisany na ekranie).
 * Nagłówków rejestru nie wpisuje. Na żywy arkusz wchodzi w W1, nie w M6.
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
  var sheet = getDataSheet_();
  var saved = [];
  var skipped = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var item = rows[i];
    var target = registerWriteTarget_(sheet, item);
    if (target.error) {
      skipped.push(approveSkip_(item, target.error));
      continue;
    }
    var markedNie = approveDidNotHappen_(item && item.nieOdbył);
    var alreadyNie =
      settlementFlag_(sheet.getRange(target.row, COL.transportOdbył).getValue()) === 'nie';
    if (alreadyNie && !markedNie) {
      skipped.push(approveSkip_(item, 'nie'));
      continue;
    }
    var pickupDate = settlementDateText_(sheet.getRange(target.row, COL.dataOdbioru).getValue());
    if (!pickupDate) {
      skipped.push(approveSkip_(item, 'date'));
      continue;
    }
    if (markedNie) {
      sheet.getRange(target.row, COL.transportOdbył).setValue('nie');
      saved.push(approveSaved_(sheet, target.row));
      continue;
    }
    var cost = approveCostGrosze_(item && item.koszt);
    if (cost == null) {
      skipped.push(approveSkip_(item, 'cost'));
      continue;
    }
    var bags = settlementBagCount_(sheet.getRange(target.row, COL.iloscWorkow).getValue());
    var perBag = approvePerBagGrosze_(cost, bags);
    sheet.getRange(target.row, COL.rozliczony, 1, 4).setValues([
      ['tak', invoice, approveZlotyFromGrosze_(cost), approveZlotyFromGrosze_(perBag)],
    ]);
    saved.push(approveSaved_(sheet, target.row));
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

/**
 * Jednorazowa migracja układu rejestru V2.
 * Stare / stan pośredni: komentarze 10–11, trasa 12–13, rozliczenie 14–18
 *   (ew. puste nagłówki komentarzy już w 19–20 — to NIE jest V2).
 * Nowe: trasa 10–11, podjazd/worek 12–13, rozliczenie 14–18, komentarze 19–20.
 * Backfill 12–13 z Bazy stawek (jedno wczytanie listy stawek).
 * Idempotentna: gdy układ jest już V2, nic nie robi.
 * Wywołanie: z listy Uruchom wybierz migrateRegisterLayoutRates (bez _).
 * Po sukcesie: Wdróż → Nowa wersja Web App.
 */
function migrateRegisterLayoutRates_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getDataSheet_();
    if (isRegisterLayoutV2_(sheet)) {
      Logger.log(JSON.stringify({ ok: true, skipped: true, reason: 'already-v2' }));
      return { ok: true, skipped: true, reason: 'already-v2' };
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
      // V1: 10–11 komentarze, 12–13 trasa/stawka, 14–18 rozliczenie
      next.push(cellAt(11));
      next.push(cellAt(12));
      next.push(snapshot.pickup);
      next.push(snapshot.bag);
      for (c = 13; c <= 17; c++) {
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
      h12: settlementText_(sheet.getRange(1, 12).getValue()),
      h19: settlementText_(sheet.getRange(1, 19).getValue()),
    };
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

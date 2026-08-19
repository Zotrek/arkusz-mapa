/**
 * Rejestr transportów + słowniki referencyjne — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * GET ?action=modalData&podmiot=…&adres=…  (zalecane — jeden request)
 * GET ?action=bulkLastTransportDates  (ostatnie daty odbioru dla wszystkich sklepów — mapa)
 * GET ?action=previewNumber
 * GET ?action=lastTransportDate&podmiot=…&adres=…
 * GET ?action=listReferenceData  → { ok, data: { podwykoLista, poprawAdres } }
 * POST (body JSON, Content-Type: text/plain):
 *   (brak mode) — append wiersza transportu + atomowa numeracja
 *   mode=addReferencePodwyko | addPoprawAdres
 *   (legacy: addReferencePrzewoznik | addReferenceDostawa → zapis do Lista podwykonawców)
 *
 * Zakładki referencyjne (ten sam arkusz, poza pierwszą z transportami):
 *   Lista podwykonawców, Popraw adres
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
  komentarz1: 10,
  komentarz2: 11,
};

var TRANSPORT_MAX_NUM_KEY = 'transportMaxNum';
var TRANSPORT_LAST_ROW_KEY = 'transportLastRow';

var REF_PODWYKO_SHEET_NAME = 'Lista podwykonawców';
var REF_PRZ_SHEET_NAME = 'Przewoźnicy';
var REF_DOS_SHEET_NAME = 'Miejsca dostawy';
var REF_POPRAW_SHEET_NAME = 'Popraw adres';

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
      var ms = findLastTransportDateMs_(podmiotLegacy, adresLegacy);
      return jsonResponse({
        ok: true,
        lastTransportDateMs: ms,
        lastTransportDateYmd: ms != null ? formatYmdFromMs_(ms) : null,
      });
    }
    if (action === 'listReferenceData') {
      return jsonResponse({ ok: true, data: listReferenceData_() });
    }
    return jsonResponse({ ok: false, error: 'unknown action' }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);
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

function buildModalDataResponse_(podmiot, adres) {
  var numer = getPreviewNumber_();
  var ms = findLastTransportDateMs_(podmiot, adres);
  return {
    ok: true,
    numer: String(numer),
    lastTransportDateMs: ms,
    lastTransportDateYmd: ms != null ? formatYmdFromMs_(ms) : null,
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

function appendTransportRow_(numer, body) {
  var sheet = getDataSheet_();
  sheet.appendRow([
    numer,
    body.adresSklepu || '',
    body.podmiotHandlowy || '',
    body.sklep || '',
    body.dataOdbioru || '',
    body.ktoOdbiera || '',
    body.miejsceZrzutu || '',
    body.rodzajZbiorki || '',
    body.iloscWorkow != null ? body.iloscWorkow : '',
    body.komentarz1 || '',
    body.komentarz2 || '',
  ]);
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

/** Jednorazowy skan arkusza: klucz sklepu → max data odbioru (ms). */
function buildBulkLastTransportDatesMap_() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  var result = {};
  if (lastRow < 2) {
    return result;
  }
  var range = sheet.getRange(2, COL.adres, lastRow, COL.dataOdbioru);
  var rows = range.getValues();
  for (var i = 0; i < rows.length; i++) {
    var rowAdres = rows[i][0];
    var rowPodmiot = rows[i][1];
    var rowData = rows[i][3];
    var key = buildTransportShopKey_(rowPodmiot, rowAdres);
    if (!key || key === '\0') {
      continue;
    }
    var ms = parseDateToMs_(rowData);
    if (ms == null) {
      continue;
    }
    if (result[key] == null || ms > result[key]) {
      result[key] = ms;
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
    var ms = raw[key];
    shops.push({
      key: key,
      lastTransportDateMs: ms,
      lastTransportDateYmd: formatYmdFromMs_(ms),
    });
  }
  return { ok: true, shops: shops };
}

function findLastTransportDateMs_(podmiot, adres) {
  if (!normalizeTransportKeyPart_(adres)) {
    return null;
  }
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var range = sheet.getRange(2, COL.adres, lastRow, COL.dataOdbioru);
  var rows = range.getValues();
  var maxMs = null;

  for (var i = 0; i < rows.length; i++) {
    var rowAdres = rows[i][0];
    var rowPodmiot = rows[i][1];
    var rowData = rows[i][3];
    if (!rowMatchesShop_(rowPodmiot, rowAdres, podmiot, adres)) {
      continue;
    }
    var ms = parseDateToMs_(rowData);
    if (ms != null && (maxMs == null || ms > maxMs)) {
      maxMs = ms;
    }
  }
  return maxMs;
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
    var latRaw = r[3];
    var lonRaw = r[4];
    var lat = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : NaN;
    var lon = lonRaw != null && lonRaw !== '' ? parseFloat(lonRaw) : NaN;
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
  var latRaw = body && body.lat;
  var lonRaw = body && (body.lon != null ? body.lon : body.lng);
  var lat = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : NaN;
  var lon = lonRaw != null && lonRaw !== '' ? parseFloat(lonRaw) : NaN;
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
  var coords = parsePoprawCoords_(body);
  if (!adres) {
    throw new Error('adres required');
  }
  var sheet = getOrCreateRefSheet_(REF_POPRAW_SHEET_NAME, REF_POPRAW_HEADER);
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
    },
  });
}

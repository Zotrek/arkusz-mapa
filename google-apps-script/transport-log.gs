/**
 * Rejestr transportów — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * GET ?action=modalData&podmiot=…&adres=…  (zalecane — jeden request)
 * GET ?action=bulkLastTransportDates  (ostatnie daty odbioru dla wszystkich sklepów — mapa)
 * GET ?action=previewNumber
 * GET ?action=lastTransportDate&podmiot=…&adres=…
 * POST (body JSON, Content-Type: text/plain) — append wiersza + atomowa numeracja
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
};

var TRANSPORT_MAX_NUM_KEY = 'transportMaxNum';
var TRANSPORT_LAST_ROW_KEY = 'transportLastRow';

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

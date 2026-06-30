/**
 * Rejestr transportów — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *
 * GET ?action=modalData&podmiot=…&adres=…  (zalecane — jeden request)
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

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'modalData') {
      var podmiot = (e.parameter.podmiot || '').toString();
      var adres = (e.parameter.adres || '').toString();
      return jsonResponse(buildModalDataResponse_(podmiot, adres));
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
  var max = scanMaxNumberFromSheet_();
  setStoredMaxNumber_(max);
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

function maxNumberInValues_(values) {
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var n = parseNumberFromCell_(values[i][0]);
    if (n != null && n > max) {
      max = n;
    }
  }
  return max;
}

function scanMaxNumberFromSheet_() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
  return maxNumberInValues_(values);
}

function ensureStoredMaxNumberSeeded_() {
  var stored = getStoredMaxNumber_();
  if (stored != null) {
    return stored;
  }
  var max = scanMaxNumberFromSheet_();
  setStoredMaxNumber_(max);
  return max;
}

function getPreviewNumber_() {
  return ensureStoredMaxNumberSeeded_() + 1;
}

function allocateNextNumber_() {
  var max = ensureStoredMaxNumberSeeded_();
  var next = max + 1;
  setStoredMaxNumber_(next);
  return next;
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
}

function rowMatchesShop_(rowPodmiot, rowAdres, podmiot, adres, allowAdresFallback) {
  var targetKey = buildTransportShopKey_(podmiot, adres);
  if (!targetKey || targetKey === '\0') {
    return false;
  }
  if (buildTransportShopKey_(rowPodmiot, rowAdres) === targetKey) {
    return true;
  }
  if (!allowAdresFallback) {
    return false;
  }
  var targetAdres = normalizeTransportKeyPart_(adres);
  if (!targetAdres) {
    return false;
  }
  return normalizeTransportKeyPart_(rowAdres) === targetAdres;
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
  var strictHits = 0;

  for (var pass = 0; pass < 2; pass++) {
    var allowAdresFallback = pass === 1;
    for (var i = 0; i < rows.length; i++) {
      var rowAdres = rows[i][0];
      var rowPodmiot = rows[i][1];
      var rowData = rows[i][3];
      if (!rowMatchesShop_(rowPodmiot, rowAdres, podmiot, adres, allowAdresFallback)) {
        continue;
      }
      if (!allowAdresFallback) {
        strictHits += 1;
      } else if (strictHits > 0) {
        continue;
      }
      var ms = parseDateToMs_(rowData);
      if (ms != null && (maxMs == null || ms > maxMs)) {
        maxMs = ms;
      }
    }
    if (strictHits > 0) {
      break;
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

/**
 * Rejestr transportów — Web App dla mapy arkusz-mapa (GitHub Pages).
 * Wdrożenie: Extensions → Apps Script → wklej → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 *
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

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'previewNumber') {
      return jsonResponse({ ok: true, numer: String(computeNextNumber()) });
    }
    if (action === 'lastTransportDate') {
      var podmiot = (e.parameter.podmiot || '').toString();
      var adres = (e.parameter.adres || '').toString();
      var ms = findLastTransportDateMs_(podmiot, adres);
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
    var numer = computeNextNumber();
    appendTransportRow_(numer, body);
    return jsonResponse({ ok: true, numer: String(numer) });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj, statusCode) {
  var out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
  // HtmlService / ContentService nie ustawia CORS — Web App „Anyone” zwykle wystarcza dla GET;
  // POST z mapy: Content-Type text/plain (bez preflight).
  return out;
}

function getDataSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function computeNextNumber() {
  var sheet = getDataSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 1;
  }
  var values = sheet.getRange(2, COL.numer, lastRow, COL.numer).getValues();
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var cell = values[i][0];
    if (cell === '' || cell === null) {
      continue;
    }
    var digits = String(cell).replace(/\D/g, '');
    if (!digits) {
      continue;
    }
    var n = parseInt(digits, 10);
    if (!isNaN(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
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

function findLastTransportDateMs_(podmiot, adres) {
  var targetKey = buildTransportShopKey_(podmiot, adres);
  if (!targetKey || targetKey === '\0') {
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
    var key = buildTransportShopKey_(rowPodmiot, rowAdres);
    if (key !== targetKey) {
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

function parseDateToMs_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var s = String(value || '').trim();
  if (!s) {
    return null;
  }
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return Date.UTC(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  }
  var dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dmy) {
    var y = parseInt(dmy[3], 10);
    if (y < 100) {
      y = y >= 70 ? 1900 + y : 2000 + y;
    }
    return Date.UTC(y, parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
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

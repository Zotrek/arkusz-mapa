/**
 * Reguły `saveRate`. Jedna treść. `transport-log.gs` ma ten sam blok.
 * Test pada, gdy skrypt Apps Script się rozjedzie.
 *
 * Klucz: adres + nazwa krótka + data `dd.mm.yyyy`. Pusta data = od zawsze.
 * Jeden wiersz klucza nadpisuje kwoty. Dwa i więcej odmawia. Inna data dopisuje wiersz.
 */

export const saveRateRulesSource = `function isAllDigits_(text) {
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
`;

export const RATE_SHEET_NAME = 'Baza stawek';

export const RATE_HEADERS = [
  'Sklep',
  'Podwykonawca',
  'Kwota za podjazd',
  'Kwota za worek',
  'Od kiedy obowiązuje',
] as const;

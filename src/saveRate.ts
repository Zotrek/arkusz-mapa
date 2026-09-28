/**
 * Reguły `saveRate`. Jedna treść. `transport-log.gs` ma ten sam blok.
 * Test pada, gdy skrypt Apps Script się rozjedzie.
 *
 * Klucz: adres (po normalizacji al./pl./Św.) + nazwa krótka + data `dd.mm.yyyy`.
 * Pusta data = od zawsze. Trafione wiersze nadpisują kwoty (także gdy kilka wariantów
 * tego samego adresu). Inna data dopisuje wiersz.
 */

/**
 * Klucz porównania adresu sklepu w stawkach (Baza stawek + Baza cen).
 * Zjada prefiksy ul./al./pl. i rozwija św./gen./ks./kard. — jak mapa vs surowy sync.
 */
export function normalizeRateShopKey(text: unknown): string {
  let s = String(text == null ? '' : text)
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) {
    return '';
  }
  s = s.replace(/(^|[\s,])(ul\.?|ulica|al\.?|aleja|alei|pl\.?|plac)\s+/gi, '$1');
  s = s.replace(/(^|[\s,])(gen|ks|kard|sw|św)\.(?=[\p{L}])/giu, (_, lead: string, abbr: string) => {
    const lower = abbr.toLowerCase();
    if (lower.startsWith('gen')) return `${lead}Generała `;
    if (lower.startsWith('ks')) return `${lead}Księdza `;
    if (lower.startsWith('kard')) return `${lead}Kardynała `;
    return `${lead}Świętego `;
  });
  s = s.replace(/(^|[\s,])gen\.\s*/gi, '$1Generała ');
  s = s.replace(/(^|[\s,])ks\.\s*/gi, '$1Księdza ');
  s = s.replace(/(^|[\s,])kard\.\s*/gi, '$1Kardynała ');
  s = s.replace(/(^|[\s,])sw\.\s*/gi, '$1Świętego ');
  s = s.replace(/(^|[\s,])św\.\s*/gi, '$1Świętego ');
  return s.toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
}

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

function normalizeRateShopKey_(text) {
  var s = String(text == null ? '' : text).trim().replace(/\\s+/g, ' ');
  if (!s) {
    return '';
  }
  s = s.replace(/(^|[\\s,])(ul\\.?|ulica|al\\.?|aleja|alei|pl\\.?|plac)\\s+/gi, '$1');
  s = s.replace(/(^|[\\s,])(gen|ks|kard|sw|św)\\.(?=[\\p{L}])/giu, function (_m, lead, abbr) {
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
  s = s.replace(/(^|[\\s,])gen\\.\\s*/gi, '$1Generała ');
  s = s.replace(/(^|[\\s,])ks\\.\\s*/gi, '$1Księdza ');
  s = s.replace(/(^|[\\s,])kard\\.\\s*/gi, '$1Kardynała ');
  s = s.replace(/(^|[\\s,])sw\\.\\s*/gi, '$1Świętego ');
  s = s.replace(/(^|[\\s,])św\\.\\s*/gi, '$1Świętego ');
  return s.toLocaleLowerCase('pl').replace(/\\s+/g, ' ').trim();
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
`;

export const RATE_SHEET_NAME = 'Baza stawek';

export const RATE_HEADERS = [
  'Sklep',
  'Podwykonawca',
  'Kwota za podjazd',
  'Kwota za worek',
  'Od kiedy obowiązuje',
] as const;

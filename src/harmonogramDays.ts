/**
 * „Dni harmonogramu” + kwalifikacja kopii do „odebrane z harmonogramu”.
 * Reguła: data_zamknięcia < D < dziś (D = roboczy dzień z harmonogramu, Europe/Warsaw).
 */

import { classifyMapPointZbiorka, normalizeWgHarmonogramu } from './zbiorkaClassify.js';
import { parseDataZamknieciaWorkaToSortMs } from './wordMapSupport.js';

/** JS getDay(): 0=nd … 6=sb */
const WEEKDAY_BY_NORM: Record<string, number> = {
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

const MS_PER_DAY = 86_400_000;

export function normalizePlDayToken(raw: string): string {
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

/** Unikalne getDay() z „Dni harmonogramu” (pn, cz / pn,śr …). */
export function parseWeekdaysFromDniHarmonogramu(raw: string): number[] {
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }
  const found = new Set<number>();
  const parts = text.split(/[/;,]+|\s+/);
  for (const part of parts) {
    const norm = normalizePlDayToken(part);
    if (!norm) continue;
    const exact = WEEKDAY_BY_NORM[norm];
    if (exact !== undefined) {
      found.add(exact);
      continue;
    }
    for (const [name, day] of Object.entries(WEEKDAY_BY_NORM)) {
      if (name.length >= 2 && (norm === name || norm.includes(name))) {
        found.add(day);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Kolejność pn→nd jak w UI / zapisie „Dni odbiorów”. */
export const HARMONOGRAM_DAY_OPTIONS = [
  { value: 'pn', label: 'poniedziałek (pn)', jsDay: 1 },
  { value: 'wt', label: 'wtorek (wt)', jsDay: 2 },
  { value: 'śr', label: 'środa (śr)', jsDay: 3 },
  { value: 'cz', label: 'czwartek (cz)', jsDay: 4 },
  { value: 'pt', label: 'piątek (pt)', jsDay: 5 },
  { value: 'sb', label: 'sobota (sb)', jsDay: 6 },
  { value: 'nd', label: 'niedziela (nd)', jsDay: 0 },
] as const;

/** Kanoniczne skróty (pn, śr, …) w kolejności tygodnia — z dowolnego tekstu dni. */
export function parseHarmonogramDayTokens(raw: string): string[] {
  const weekdays = new Set(parseWeekdaysFromDniHarmonogramu(raw));
  return HARMONOGRAM_DAY_OPTIONS.filter((d) => weekdays.has(d.jsDay)).map((d) => d.value);
}

export function formatHarmonogramDayTokens(tokens: readonly string[]): string {
  const wanted = new Set(
    tokens.map((t) => normalizePlDayToken(t)).filter(Boolean),
  );
  return HARMONOGRAM_DAY_OPTIONS.filter((d) => wanted.has(normalizePlDayToken(d.value)))
    .map((d) => d.value)
    .join(', ');
}

/** Rozwijana lista z checkboxami dni (ukryte pole = wartość „pn, cz”). */
export function harmonogramDaysPickerHtml(hiddenId: string): string {
  const toggleId = `${hiddenId}-toggle`;
  const listId = `${hiddenId}-list`;
  const options = HARMONOGRAM_DAY_OPTIONS.map(
    (d) =>
      `<li role="option"><label><input type="checkbox" value="${d.value}" data-day-multi-opt /> ${d.label}</label></li>`,
  ).join('');
  return `<div class="day-multi-wrap" data-day-multi="${hiddenId}">
        <input type="hidden" id="${hiddenId}" value="" />
        <button type="button" id="${toggleId}" class="day-multi-toggle" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}">Wybierz dni…</button>
        <ul id="${listId}" class="day-multi-list" role="listbox" hidden>${options}</ul>
      </div>`;
}

export function harmonogramDaysPickerCss(): string {
  return `
    .day-multi-wrap { position: relative; }
    .day-multi-toggle {
      width: 100%; padding: 9px 11px; font-size: 13px; text-align: left; cursor: pointer;
      border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.55); background: rgba(255,255,255,0.92);
      color: var(--map-ink); box-sizing: border-box; outline: none;
    }
    .day-multi-toggle:focus { border-color: var(--map-accent); box-shadow: 0 0 0 3px var(--map-accent-soft); }
    .day-multi-toggle.is-placeholder { color: var(--map-muted); }
    .day-multi-list {
      position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 30;
      margin: 0; padding: 6px 0; list-style: none; max-height: 240px; overflow-y: auto;
      background: #fff; border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 10px;
      box-shadow: var(--map-shadow);
    }
    .day-multi-list[hidden] { display: none !important; }
    .day-multi-list li { margin: 0; padding: 0; }
    .day-multi-list label {
      display: flex !important; align-items: center; gap: 8px; margin: 0 !important;
      padding: 7px 12px; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--map-ink);
    }
    .day-multi-list label:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); }
    .day-multi-list input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); }
`;
}

/** Skrypt przeglądarki: setDayMultiValue / syncDayMultiFromChecks / initDayMultiPickers. */
export function harmonogramDaysPickerBrowserScript(): string {
  const tokenOrder = HARMONOGRAM_DAY_OPTIONS.map((d) => d.value);
  const normMap: Record<string, string> = {};
  for (const d of HARMONOGRAM_DAY_OPTIONS) {
    normMap[normalizePlDayToken(d.value)] = d.value;
  }
  // Alias bez diakrytyków → kanoniczny skrót (śr ← sr)
  for (const [alias, jsDay] of Object.entries(WEEKDAY_BY_NORM)) {
    const opt = HARMONOGRAM_DAY_OPTIONS.find((d) => d.jsDay === jsDay);
    if (opt && !(alias in normMap)) {
      normMap[alias] = opt.value;
    }
  }
  return `
    var DAY_MULTI_TOKEN_ORDER = ${JSON.stringify(tokenOrder)};
    var DAY_MULTI_NORM_TO_TOKEN = ${JSON.stringify(normMap)};
    function normalizeDayMultiToken(raw) {
      return String(raw || '').toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
        .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
        .replace(/[^a-z]/g, '');
    }
    function parseDayMultiTokens(raw) {
      var text = String(raw || '').trim();
      if (!text) return [];
      var found = {};
      var parts = text.split(/[/;,]+|\\s+/);
      var i, j, norm, token, name;
      for (i = 0; i < parts.length; i++) {
        norm = normalizeDayMultiToken(parts[i]);
        if (!norm) continue;
        token = DAY_MULTI_NORM_TO_TOKEN[norm];
        if (token) { found[token] = true; continue; }
        for (name in DAY_MULTI_NORM_TO_TOKEN) {
          if (name.length >= 2 && (norm === name || norm.indexOf(name) !== -1)) {
            found[DAY_MULTI_NORM_TO_TOKEN[name]] = true;
          }
        }
      }
      var out = [];
      for (j = 0; j < DAY_MULTI_TOKEN_ORDER.length; j++) {
        if (found[DAY_MULTI_TOKEN_ORDER[j]]) out.push(DAY_MULTI_TOKEN_ORDER[j]);
      }
      return out;
    }
    function dayMultiWrap(hiddenId) {
      return document.querySelector('[data-day-multi="' + hiddenId + '"]');
    }
    function syncDayMultiUi(hiddenId) {
      var wrap = dayMultiWrap(hiddenId);
      var hidden = document.getElementById(hiddenId);
      if (!wrap || !hidden) return;
      var checks = wrap.querySelectorAll('input[data-day-multi-opt]');
      var selected = [];
      var i;
      for (i = 0; i < checks.length; i++) {
        if (checks[i].checked) selected.push(checks[i].value);
      }
      hidden.value = selected.join(', ');
      var toggle = document.getElementById(hiddenId + '-toggle');
      if (toggle) {
        toggle.textContent = selected.length ? selected.join(', ') : 'Wybierz dni…';
        if (selected.length) toggle.classList.remove('is-placeholder');
        else toggle.classList.add('is-placeholder');
      }
    }
    function setDayMultiValue(hiddenId, raw) {
      var wrap = dayMultiWrap(hiddenId);
      if (!wrap) {
        var hiddenOnly = document.getElementById(hiddenId);
        if (hiddenOnly) hiddenOnly.value = String(raw || '').trim();
        return;
      }
      var tokens = parseDayMultiTokens(raw);
      var wanted = {};
      var i;
      for (i = 0; i < tokens.length; i++) wanted[tokens[i]] = true;
      var checks = wrap.querySelectorAll('input[data-day-multi-opt]');
      for (i = 0; i < checks.length; i++) {
        checks[i].checked = !!wanted[checks[i].value];
      }
      syncDayMultiUi(hiddenId);
    }
    function closeDayMulti(hiddenId) {
      var list = document.getElementById(hiddenId + '-list');
      var toggle = document.getElementById(hiddenId + '-toggle');
      if (list) list.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
    function initDayMultiPicker(hiddenId) {
      var wrap = dayMultiWrap(hiddenId);
      if (!wrap || wrap.getAttribute('data-day-multi-ready') === '1') return;
      wrap.setAttribute('data-day-multi-ready', '1');
      var toggle = document.getElementById(hiddenId + '-toggle');
      var list = document.getElementById(hiddenId + '-list');
      if (!toggle || !list) return;
      toggle.classList.add('is-placeholder');
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var open = list.hidden;
        document.querySelectorAll('.day-multi-list').forEach(function(el) { el.hidden = true; });
        document.querySelectorAll('.day-multi-toggle').forEach(function(el) { el.setAttribute('aria-expanded', 'false'); });
        if (open) {
          list.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
        }
      });
      list.addEventListener('click', function(e) { e.stopPropagation(); });
      var checks = wrap.querySelectorAll('input[data-day-multi-opt]');
      var i;
      for (i = 0; i < checks.length; i++) {
        checks[i].addEventListener('change', function() { syncDayMultiUi(hiddenId); });
      }
      document.addEventListener('click', function() { closeDayMulti(hiddenId); });
      syncDayMultiUi(hiddenId);
    }
    function initDayMultiPickers(ids) {
      var i;
      for (i = 0; i < ids.length; i++) initDayMultiPicker(ids[i]);
    }
`;
}

/** Niedziela Wielkanocna (UTC midnight) — Anonymous Gregorian. */
export function easterSundayUtc(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function ymdUtc(y: number, month1: number, day: number): number {
  return Date.UTC(y, month1 - 1, day);
}

/** Ustawowo wolne od pracy w PL (UTC midnight). */
export function isPolishPublicHolidayUtc(ms: number): boolean {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const fixed = [
    [1, 1],
    [1, 6],
    [5, 1],
    [5, 3],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
    [12, 26],
  ] as const;
  for (const [fm, fd] of fixed) {
    if (m === fm && day === fd) {
      return true;
    }
  }
  const easter = easterSundayUtc(y);
  const movable = [0, 1, 49, 60].map((offset) => easter + offset * MS_PER_DAY);
  return movable.some((h) => h === Date.UTC(y, m - 1, day));
}

/** Kalendarzowy dzień „dziś” w Europe/Warsaw jako UTC midnight. */
export function todayWarsawUtcMidnight(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return ymdUtc(y, month, day);
}

export function utcMidnightFromSortMs(ms: number): number | null {
  if (!Number.isFinite(ms) || ms === Number.NEGATIVE_INFINITY) {
    return null;
  }
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Czy istnieje roboczy D z harmonogramu: closureUtc < D < todayUtc.
 */
export function hasPastScheduleDayAfterClosure(
  weekdays: number[],
  closureUtc: number,
  todayUtc: number,
): boolean {
  if (weekdays.length === 0) {
    return false;
  }
  if (!(closureUtc < todayUtc)) {
    return false;
  }
  const wanted = new Set(weekdays);
  for (let t = closureUtc + MS_PER_DAY; t < todayUtc; t += MS_PER_DAY) {
    const d = new Date(t);
    if (!wanted.has(d.getUTCDay())) {
      continue;
    }
    if (isPolishPublicHolidayUtc(t)) {
      continue;
    }
    return true;
  }
  return false;
}

export interface OdebraneZHarmonogramuInput {
  zbiorka: string;
  wgHarmonogramu: string;
  dniHarmonogramu: string;
  dataZamknieciaWorka: string;
  /** Domyślnie teraz (Warsaw). W testach podawać Date / UTC midnight via todayUtc. */
  today?: Date;
  todayUtc?: number;
}

export function shouldCopyToOdebraneZHarmonogramu(input: OdebraneZHarmonogramuInput): boolean {
  if (classifyMapPointZbiorka(input.zbiorka) !== 'maszyna') {
    return false;
  }
  if (normalizeWgHarmonogramu(input.wgHarmonogramu) !== 'tak') {
    return false;
  }
  const weekdays = parseWeekdaysFromDniHarmonogramu(input.dniHarmonogramu);
  if (weekdays.length === 0) {
    return false;
  }
  const closureUtc = utcMidnightFromSortMs(parseDataZamknieciaWorkaToSortMs(input.dataZamknieciaWorka));
  if (closureUtc === null) {
    return false;
  }
  const todayUtc = input.todayUtc ?? todayWarsawUtcMidnight(input.today ?? new Date());
  return hasPastScheduleDayAfterClosure(weekdays, closureUtc, todayUtc);
}

/** Czy flaga kopiowania jest włączona (env). */
export function isCopyOdebraneZHarmonogramuEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.COPY_ODEBRANE_Z_HARMONOGRAMU ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'tak';
}

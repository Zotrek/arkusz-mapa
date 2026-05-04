/**
 * Dane pod generowanie dokumentu Word z mapy (Faza 6+).
 * Szablon DOCX i lista ODS wczytywane przy buildzie mapy (Node); wypełnianie w przeglądarce.
 */

import { readFile } from 'node:fs/promises';
import PizZip from 'pizzip';
import * as XLSX from 'xlsx';
import type { SheetRow } from './sheets.js';

const HEADER_HINT = /^(przew|miejsce|nazwa|podwykon|lista|lp\.?|nr\.?|#)/iu;

/** Treść szablonu Word (poza listą w {{@lista_plomb_xml}}): pt → połówki w preprocessie OOXML. */
export const DOCX_BODY_FONT_SIZE_PT = 10;
/** Wiersz listy plomb (lp. + tab + data mm-dd + tab + numer) wstawiany przez {{@lista_plomb_xml}} (pt). */
export const DOCX_LISTA_PLOMB_FONT_SIZE_PT = 14;
/** Akapit „Uwagi: … Brak KPO …” w szablonie Word — poniżej rozmiar niż {@link DOCX_BODY_FONT_SIZE_PT}. */
export const DOCX_UWAGI_NOTICE_FONT_SIZE_PT = 9;

/**
 * Miejsce załadunku: podmiot handlowy (kolumna A) + adres w jednej linii (bez sklepu, bez dopisków).
 */
export function buildMiejsceZaladunkuText(rows: SheetRow[]): string {
  if (rows.length === 0) {
    return '';
  }
  const first = rows[0];
  const parts = [first.podmiotHandlowy.trim(), first.address.trim()].filter((s) => s.length > 0);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Data zamknięcia worka (kolumna L) → `mm-dd` dla listy w Wordzie.
 * Obsługa m.in.: `yyyy-mm-dd`, `dd.mm.yyyy`, liczba seryjna arkusza (5–6 cyfr).
 */
export function formatDataZamknieciaWorkaAsMmDd(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) {
    return '';
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\b|T)/);
  if (iso) {
    const month = Number.parseInt(iso[2], 10);
    const day = Number.parseInt(iso[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${pad2(month)}-${pad2(day)}`;
    }
  }

  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/);
  if (dmy) {
    const day = Number.parseInt(dmy[1], 10);
    const month = Number.parseInt(dmy[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${pad2(month)}-${pad2(day)}`;
    }
  }

  if (/^\d{5,6}$/.test(s)) {
    const serial = Number.parseInt(s, 10);
    if (serial >= 20000 && serial <= 80000) {
      const ms = (serial - 25569) * 86400000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      }
    }
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  return '';
}

/** Kolejne wiersze listy plomb (tekst jak w Wordzie / OCR), bez join `\n`. */
export function buildListaPlombLines(rows: SheetRow[]): string[] {
  const lines: string[] = [];
  let i = 0;
  for (const r of rows) {
    const n = r.numerPlomby.trim();
    if (n.length === 0) {
      continue;
    }
    i += 1;
    const mmdd = formatDataZamknieciaWorkaAsMmDd(r.dataZamknieciaWorka);
    lines.push(mmdd.length > 0 ? `${i}.\t${mmdd}\t${n}` : `${i}.\t${n}`);
  }
  return lines;
}

export function buildListaPlombNumbered(rows: SheetRow[]): string {
  return buildListaPlombLines(rows).join('\n');
}

export function escapeXmlForWordText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fragment WordprocessingML: jeden `w:p` na wiersz listy, czcionka {@link DOCX_LISTA_PLOMB_FONT_SIZE_PT} pt.
 * Do znacznika `{{@lista_plomb_xml}}` w osobnym akapicie szablonu (zastępuje cały ten akapit).
 */
export function buildListaPlombOoxml(rows: SheetRow[]): string {
  const lines = buildListaPlombLines(rows);
  const hp = String(DOCX_LISTA_PLOMB_FONT_SIZE_PT * 2);
  const rpr = `<w:rPr><w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr>`;
  if (lines.length === 0) {
    return `<w:p><w:r>${rpr}<w:t></w:t></w:r></w:p>`;
  }
  return lines
    .map(
      (line) =>
        `<w:p><w:r>${rpr}<w:t xml:space="preserve">${escapeXmlForWordText(line)}</w:t></w:r></w:p>`,
    )
    .join('');
}

/**
 * Wartość dla {{rodzaj_zbiorki}} w dokumencie Word — z agregatu kolumny zbiórki (jak na mapie).
 * Ręczna → „ręczna”, Maszyna → „automatyczna”, obie → „ręczna i automatyczna”.
 */
export function formatRodzajZbiorkiForDoc(zbiorka: string | undefined): string {
  const raw = (zbiorka ?? '').trim();
  if (raw.length === 0) {
    return '';
  }
  const lower = raw.toLowerCase();
  const segments = lower
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const toScan = segments.length > 0 ? segments : [lower];

  let hasReczna = false;
  let hasMaszyna = false;
  for (const seg of toScan) {
    if (seg.includes('ręcz') || seg === 'r') {
      hasReczna = true;
    } else if (seg.includes('maszyn') || seg === 'm' || seg.includes('automat')) {
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

export interface MapPointDocPayload {
  miejsce_zaladunku: string;
  lista_plomb: string;
  /**
   * OOXML pod `{{@lista_plomb_xml}}` (osobny akapit tylko ze znacznikiem) — lista 14 pt.
   * Zwykły `{{lista_plomb}}` nadal dostaje ten sam tekst, lecz bez wymuszenia 14 pt.
   */
  lista_plomb_xml: string;
  /** Numery plomb (do ewentualnego debugu / przyszłych pól) */
  plomby: string[];
}

export function buildMapPointDocPayload(rows: SheetRow[]): MapPointDocPayload {
  const plomby = rows
    .map((r) => r.numerPlomby.trim())
    .filter((n) => n.length > 0);
  return {
    miejsce_zaladunku: buildMiejsceZaladunkuText(rows),
    lista_plomb: buildListaPlombNumbered(rows),
    lista_plomb_xml: buildListaPlombOoxml(rows),
    plomby,
  };
}

function rowCell(row: unknown[], index: number): string {
  const v = row[index];
  if (v === null || v === undefined) {
    return '';
  }
  return String(v).trim();
}

/** Pozycja listy podwykonawców: kolumna A (nazwa w UI), kolumna B (treść do dokumentu Word — „dane”). */
export interface PodwykoOption {
  label: string;
  dane: string;
}

/** Wiersz przed nadaniem unikalnej etykiety w select (powtórzenia nazwy → „Nazwa (2)”, …). */
interface PodwykoRawRow {
  baseLabel: string;
  dane: string;
}

const SHORT_LABEL_MAX = 100;

/**
 * Gdy wiersz ma wypełnione tylko „Dane” (B), krótka etykieta do listy rozwijanej.
 */
function shortLabelFromDane(dane: string): string {
  const oneLine = dane.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SHORT_LABEL_MAX) {
    return oneLine;
  }
  return `${oneLine.slice(0, SHORT_LABEL_MAX - 1).trimEnd()}…`;
}

function detectHeaderRowIndex(rows: string[][]): number {
  if (rows.length === 0) {
    return 0;
  }
  const firstCell = rowCell(rows[0] as unknown[], 0);
  if (firstCell && HEADER_HINT.test(firstCell)) {
    return 1;
  }
  return 0;
}

/**
 * Zbiera niepuste wiersze z jednej macierzy arkusza (A/B). Bez numeracji duplikatów nazw —
 * użyj {@link finalizePodwykoOptions}.
 */
export function collectPodwykoRawRowsFromMatrix(rows: string[][]): PodwykoRawRow[] {
  if (rows.length === 0) {
    return [];
  }
  const start = detectHeaderRowIndex(rows);
  const seenExactRow = new Set<string>();
  const raw: PodwykoRawRow[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i] as unknown[];
    const colA = rowCell(row, 0);
    const colB = rowCell(row, 1);
    if (colA.length === 0 && colB.length === 0) {
      continue;
    }
    const rowKey = `${colA}\0${colB}`;
    if (seenExactRow.has(rowKey)) {
      continue;
    }
    seenExactRow.add(rowKey);
    const dane = colB.length > 0 ? colB : colA;
    const baseLabel = colA.length > 0 ? colA : shortLabelFromDane(colB);
    if (baseLabel.length === 0) {
      continue;
    }
    raw.push({ baseLabel, dane });
  }
  return raw;
}

/**
 * Nadaje etykiety w UI: ta sama nazwa w kolumnie A w wielu wierszach → drugi wpis „Nazwa (2)” itd.
 */
export function finalizePodwykoOptions(raw: PodwykoRawRow[]): PodwykoOption[] {
  const occ = new Map<string, number>();
  const out: PodwykoOption[] = [];
  for (const r of raw) {
    const n = (occ.get(r.baseLabel) ?? 0) + 1;
    occ.set(r.baseLabel, n);
    const label = n === 1 ? r.baseLabel : `${r.baseLabel} (${n})`;
    out.push({ label, dane: r.dane });
  }
  return out;
}

/**
 * Każdy arkusz ODS/XLSX: kolumna A = nazwa (lista rozwijana), kolumna B = dane (w pliku .docx).
 * Gdy brak kolumny B, do dokumentu trafia ta sama treść co nazwa.
 * Pusty A + wypełnione B → wybór po skróconej treści B. Powtórzenia tej samej nazwy w A → osobne pozycje w liście.
 */
export function extractPodwykoOptionsFromMatrix(rows: string[][]): PodwykoOption[] {
  return finalizePodwykoOptions(collectPodwykoRawRowsFromMatrix(rows));
}

export async function loadPodwykoOptionsFromSpreadsheet(filePath: string): Promise<PodwykoOption[]> {
  const buf = await readFile(filePath);
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const merged: PodwykoRawRow[] = [];
  const seenAcrossSheets = new Set<string>();
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      continue;
    }
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];
    for (const r of collectPodwykoRawRowsFromMatrix(matrix)) {
      const k = `${r.baseLabel}\0${r.dane}`;
      if (seenAcrossSheets.has(k)) {
        continue;
      }
      seenAcrossSheets.add(k);
      merged.push(r);
    }
  }
  return finalizePodwykoOptions(merged);
}

export async function readFileAsBase64(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return buf.toString('base64');
}

/**
 * Czy scalić dwa sąsiednie runy: TAK tylko gdy sklejamy **rozdarty** znacznik `{{…}}` między runami.
 * NIE scalamy etykiety („Miejsce: ”) z `{{tag}}` — wtedy Word jednym runem pogrubia całą linię.
 */
export function shouldMergeAdjacentWtRuns(textBefore: string, textAfter: string): boolean {
  const kaucjOdpad = 'odpad pochodzący z systemu kaucyjnego';
  if (textBefore.includes(kaucjOdpad) || textAfter.includes(kaucjOdpad)) {
    return false;
  }
  if (textBefore.includes('15 01 06') || textAfter.includes('15 01 06')) {
    return false;
  }
  const openBefore = (textBefore.match(/\{\{/g) ?? []).length;
  const closeBefore = (textBefore.match(/\}\}/g) ?? []).length;
  const openAfter = (textAfter.match(/\{\{/g) ?? []).length;
  const closeAfter = (textAfter.match(/\}\}/g) ?? []).length;
  const incompleteOpenInFirst = openBefore > closeBefore;
  const incompleteOpenInSecond = openAfter > closeAfter;
  if (incompleteOpenInFirst && textAfter.includes('}}')) {
    return true;
  }
  if (incompleteOpenInSecond && textBefore.includes('{{')) {
    return true;
  }
  if (
    textBefore.includes('{{') ||
    textBefore.includes('}}') ||
    textAfter.includes('{{') ||
    textAfter.includes('}}')
  ) {
    return false;
  }
  return true;
}

/**
 * Word dzieli tekst na wiele `<w:t>…</w:t>` — wtedy `{{tag}}` przestaje być widoczny jako jeden znacznik.
 * Scal wyłącznie runy, które razem domykają jeden znacznik (patrz shouldMergeAdjacentWtRuns).
 */
export function mergeAdjacentXmlTextRuns(xml: string): string {
  let iteration = 0;
  let current = xml;
  while (iteration < 800) {
    iteration += 1;
    const next = current.replace(
      /<w:t([^>]*)>([^<]*)<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:t([^>]*)>([^<]*)<\/w:t>/g,
      (full, a1, t1, a2, t2) => {
        if (!shouldMergeAdjacentWtRuns(t1, t2)) {
          return full;
        }
        return `<w:t${a1}>${t1}${t2}</w:t>`;
      },
    );
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

/**
 * Word stosuje pogrubienie z `<w:pPr><w:rPr><w:b/>…</w:rPr></w:pPr>` do całego akapitu — wtedy tekst
 * po znaczniku `{{…}}` na tej samej linii zostaje pogrubiony mimo `w:b w:val="0"` w runie.
 * Usuwa domyślne bold z pPr tylko w akapitach, które zawierają `{{`.
 */
export function stripBoldDefaultFromParagraphsWithPlaceholders(xml: string): string {
  const parts = xml.split(/(?=<w:p\b)/);
  return parts
    .map((part) => {
      if (!part.startsWith('<w:p')) {
        return part;
      }
      if (!part.includes('{{')) {
        return part;
      }
      return part.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (full, inner) => {
        const cleaned = String(inner).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rprBlock) => {
          if (!/<w:b\b/.test(rprBlock) && !/<w:bCs\b/.test(rprBlock)) {
            return rprBlock;
          }
          return '<w:rPr></w:rPr>';
        });
        return `<w:pPr>${cleaned}</w:pPr>`;
      });
    })
    .join('');
}

/** Zwykły tekst treści — jawne wyłączenie bold/italic/caps (nadpisanie stylu akapitu). */
const RPR_BODY_NORMAL =
  '<w:rPr><w:b w:val="0"/><w:bCs w:val="0"/><w:i w:val="0"/><w:iCs w:val="0"/><w:smallCaps w:val="0"/><w:caps w:val="0"/></w:rPr>';

/** Jawne wyłączenie bold/italic/caps dla runów ze znacznikami — nadpisuje dziedziczenie z akapitu. */
export function strengthenPlaceholderRunsRPr(xml: string): string {
  let s = xml.replace(
    /<w:rPr><w:b w:val="0"\/><w:bCs w:val="0"\/><\/w:rPr>(?=<w:t>\{\{)/g,
    RPR_BODY_NORMAL,
  );
  s = s.replace(/<w:rPr><\/w:rPr>(?=<w:t>\{\{)/g, RPR_BODY_NORMAL);
  return s;
}

const ODPAD_KAUCJONOWY_MARKER = 'odpad pochodzący z systemu kaucyjnego o kodzie';

/** Atrybut w:t, żeby widoczna była wiodąca spacja przed „odpad …”. */
function ensureXmlSpacePreserveOnTAttrs(attrFragment: string): string {
  const t = attrFragment.trim();
  if (/xml:space\s*=/.test(t)) {
    return t ? ` ${t}` : '';
  }
  if (t.length === 0) {
    return ' xml:space="preserve"';
  }
  return ` ${t} xml:space="preserve"`;
}

/**
 * Word bywa gubi spację między runami przy „etykieta:” i następnej treści.
 * Zostawiamy dwukropek tuż przed </w:t>; spację dokładamy w treści następnego runu / w danych docxtemplater.
 */
export function stripTrailingSpaceBeforeCloseWtAfterRodzajColonLabels(xml: string): string {
  const parts = xml.split(/(?=<w:p\b)/);
  return parts
    .map((part) => {
      if (!part.startsWith('<w:p')) {
        return part;
      }
      let p = part;
      if (p.includes('rodzaj_zbiorki') && p.includes('Rodzaj zbiórki')) {
        p = p.replace(/Rodzaj zbiórki:\s*<\/w:t>/g, 'Rodzaj zbiórki:</w:t>');
      }
      if (p.includes(ODPAD_KAUCJONOWY_MARKER) && p.includes('Rodzaj transportowanych odpadów')) {
        p = p.replace(/Rodzaj transportowanych odpadów:\s*<\/w:t>/g, 'Rodzaj transportowanych odpadów:</w:t>');
      }
      return p;
    })
    .join('');
}

/**
 * Blok „odpad pochodzący z systemu kaucyjnego o kodzie 15 01 06” — bez pogrubienia i kursywy
 * (akapit miał domyślny italic w w:pPr; runy mogły dziedziczyć pogrubienie).
 */
export function normalizeOdpadKaucjonowyDescriptionRuns(xml: string): string {
  if (!xml.includes(ODPAD_KAUCJONOWY_MARKER)) {
    return xml;
  }
  const parts = xml.split(/(?=<w:p\b)/);
  return parts
    .map((part) => {
      if (!part.startsWith('<w:p') || !part.includes(ODPAD_KAUCJONOWY_MARKER)) {
        return part;
      }
      let p = part.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (full, inner) => {
        const cleaned = String(inner).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rprBlock) => {
          if (!/<w:i\b/.test(rprBlock) && !/<w:iCs\b/.test(rprBlock)) {
            return rprBlock;
          }
          return '<w:rPr></w:rPr>';
        });
        return `<w:pPr>${cleaned}</w:pPr>`;
      });
      p = p.replace(
        /<w:r>\s*<w:rPr>\s*<\/w:rPr>\s*<w:t([^>]*)>\s*odpad pochodzący z systemu kaucyjnego o kodzie\s*<\/w:t>\s*<\/w:r>/,
        (_m, a1: string) =>
          `<w:r>${RPR_BODY_NORMAL}<w:t${ensureXmlSpacePreserveOnTAttrs(a1)}> odpad pochodzący z systemu kaucyjnego o kodzie</w:t></w:r>`,
      );
      p = p.replace(
        /<w:r>\s*<w:rPr>\s*<w:i\/>\s*<w:iCs\/>\s*<\/w:rPr>\s*<w:t([^>]*)>\s*15 01 06\s*<\/w:t>\s*<\/w:r>/,
        `<w:r>${RPR_BODY_NORMAL}<w:t$1> 15 01 06 </w:t></w:r>`,
      );
      p = p.replace(
        /<w:r>\s*<w:rPr>\s*<\/w:rPr>\s*<w:t([^>]*)>\s*odpad pochodzący z systemu kaucyjnego o kodzie\s+15 01 06\s*<\/w:t>\s*<\/w:r>/,
        (_m, a1: string) =>
          `<w:r>${RPR_BODY_NORMAL}<w:t${ensureXmlSpacePreserveOnTAttrs(a1)}> odpad pochodzący z systemu kaucyjnego o kodzie 15 01 06</w:t></w:r>`,
      );
      return p;
    })
    .join('');
}

const UWAGI_BRAK_KPO_SNIPPET = 'Brak KPO';

/**
 * Akapit z „Uwagi:” i tekstem o braku KPO — bez pogrubienia (także domyślnego z `w:pPr`), czcionka 9 pt.
 * Wywoływane po {@link forceFontSizeHalfPointsOnAllWordRuns}, żeby nadpisać 10 pt treści głównej.
 */
export function normalizeUwagiBrakKpoNoticeParagraph(xml: string): string {
  if (!xml.includes(UWAGI_BRAK_KPO_SNIPPET) || !xml.includes('Uwagi:')) {
    return xml;
  }
  const hp = String(DOCX_UWAGI_NOTICE_FONT_SIZE_PT * 2);
  const rprUwagi =
    `<w:rPr><w:b w:val="0"/><w:bCs w:val="0"/><w:i w:val="0"/><w:iCs w:val="0"/><w:smallCaps w:val="0"/><w:caps w:val="0"/><w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr>`;
  const parts = xml.split(/(?=<w:p\b)/);
  return parts
    .map((part) => {
      if (!part.startsWith('<w:p') || !part.includes(UWAGI_BRAK_KPO_SNIPPET) || !part.includes('Uwagi:')) {
        return part;
      }
      let p = part;
      p = p.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (full, inner) => {
        const cleaned = String(inner).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rprBlock) => {
          if (
            !/<w:b\b/.test(rprBlock) &&
            !/<w:bCs\b/.test(rprBlock) &&
            !/<w:i\b/.test(rprBlock) &&
            !/<w:iCs\b/.test(rprBlock)
          ) {
            return rprBlock;
          }
          return '<w:rPr></w:rPr>';
        });
        return `<w:pPr>${cleaned}</w:pPr>`;
      });
      const closePPr = '</w:pPr>';
      const i = p.indexOf(closePPr);
      if (i === -1) {
        return p;
      }
      const head = p.slice(0, i + closePPr.length);
      let tail = p.slice(i + closePPr.length);
      tail = tail.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, rprUwagi);
      tail = tail.replace(
        /<w:r(\s[^>]*)?>(\s*)(?!<w:rPr\b)(?=<w:(?:t|br|drawing|tab|fldChar|instrText|delText|pict|noBreakHyphen)\b)/gi,
        (_m, g1: string | undefined, g2: string) => `<w:r${g1 ?? ''}>${g2}${rprUwagi}`,
      );
      p = head + tail;
      return p;
    })
    .join('');
}

/**
 * Ustawia rozmiar czcionki we wszystkich `w:rPr` oraz dodaje `w:rPr` runom go pozbawionym
 * (document / nagłówki / stopki / style — spójnie z preprocessorem szablonu).
 */
export function forceFontSizeHalfPointsOnAllWordRuns(xml: string, halfPoints: number): string {
  const v = String(halfPoints);
  const pair = `<w:sz w:val="${v}"/><w:szCs w:val="${v}"/>`;
  let out = xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_full, inner: string) => {
    let s = String(inner);
    s = s.replace(/<w:szCs\b[^>]*\/>/gi, '');
    s = s.replace(/<w:sz\b[^>]*\/>/gi, '');
    s = s.replace(/<w:szCs\b[^>]*>[\s\S]*?<\/w:szCs>/gi, '');
    s = s.replace(/<w:sz\b[^>]*>[\s\S]*?<\/w:sz>/gi, '');
    return `<w:rPr>${s.trim()}${pair}</w:rPr>`;
  });
  out = out.replace(
    /<w:r(\s[^>]*)?>(\s*)(?!<w:rPr\b)(?=<w:(?:t|br|drawing|tab|fldChar|instrText|delText|pict|noBreakHyphen)\b)/gi,
    (_m, g1: string | undefined, g2: string) => `<w:r${g1 ?? ''}>${g2}<w:rPr>${pair}</w:rPr>`,
  );
  return out;
}

const DOCX_PARTS_TO_MERGE =
  /^word\/(document\.xml|header\d+\.xml|footer\d+\.xml|footnotes\.xml|endnotes\.xml)$/;

function preprocessDocxPartXml(xml: string): string {
  let text = mergeAdjacentXmlTextRuns(xml);
  text = stripBoldDefaultFromParagraphsWithPlaceholders(text);
  text = strengthenPlaceholderRunsRPr(text);
  text = stripTrailingSpaceBeforeCloseWtAfterRodzajColonLabels(text);
  text = normalizeOdpadKaucjonowyDescriptionRuns(text);
  text = forceFontSizeHalfPointsOnAllWordRuns(text, DOCX_BODY_FONT_SIZE_PT * 2);
  text = normalizeUwagiBrakKpoNoticeParagraph(text);
  return text;
}

export function preprocessDocxMergeAdjacentTextRuns(buf: Buffer): Buffer {
  const zip = new PizZip(buf);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);
    if (!entry || entry.dir) {
      continue;
    }
    if (name === 'word/styles.xml') {
      const merged = forceFontSizeHalfPointsOnAllWordRuns(entry.asText(), DOCX_BODY_FONT_SIZE_PT * 2);
      zip.file(name, merged);
      continue;
    }
    if (!DOCX_PARTS_TO_MERGE.test(name)) {
      continue;
    }
    const merged = preprocessDocxPartXml(entry.asText());
    zip.file(name, merged);
  }
  const generated = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.isBuffer(generated)
    ? generated
    : Buffer.from(new Uint8Array(generated as ArrayBuffer));
}

function wordDocumentXmlContainsDoubleMustache(buf: Buffer): boolean {
  try {
    const zip = new PizZip(buf);
    const xml = zip.file('word/document.xml')?.asText() ?? '';
    return xml.includes('{{');
  } catch {
    return true;
  }
}

export function warnIfWordTemplateMissingPlaceholders(buf: Buffer): void {
  if (!wordDocumentXmlContainsDoubleMustache(buf)) {
    console.warn(
      '[arkusz-mapa] Szablon Word nie zawiera znaczników {{ ... }} w treści — pola się nie wypełnią. ' +
        'Dodaj w pusty.docx m.in. {{miejsce_zaladunku}}, {{przewoznik}}, {{miejsce_dostawy}}, {{data_zaladunku}}, {{@lista_plomb_xml}} (lista 14 pt) lub {{lista_plomb}}, {{rodzaj_zbiorki}} ' +
        '(najlepiej wklej cały znacznik naraz). Szczegóły: arkusz-mapa/docs/SZABLON_WORD_tagi.txt',
    );
  }
}

/** Odczyt szablonu pod mapę: scalenie runów Word + base64 + ostrzeżenie przy braku {{. */
export async function readWordTemplateAsBase64ForMap(filePath: string): Promise<string> {
  const raw = await readFile(filePath);
  const processed = preprocessDocxMergeAdjacentTextRuns(raw);
  warnIfWordTemplateMissingPlaceholders(processed);
  return processed.toString('base64');
}

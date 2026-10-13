/**
 * Ten sam blok, który karta na mapie kopiuje do schowka.
 * Przy `npm run generate` idzie w log, żeby w CI dało się go znaleźć.
 */

export interface ArkuszMapaErrorReport {
  code: string;
  place: string;
  summary: string;
  effect: string;
  technical: string;
}

export interface ArkuszMapaErrorLogger {
  error?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  info?: (message: string, ...args: unknown[]) => void;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatArkuszMapaError(report: ArkuszMapaErrorReport): string {
  return [
    'ARKUSZ-MAPA-ERROR',
    `kod: ${oneLine(report.code) || 'MAP-E-UNKNOWN'}`,
    `miejsce: ${oneLine(report.place) || 'nieznane miejsce'}`,
    `objaw: ${oneLine(report.summary) || 'Coś się nie udało.'}`,
    `skutek: ${oneLine(report.effect) || 'Część danych może być niekompletna.'}`,
    `technicznie: ${oneLine(report.technical) || 'brak szczegółu'}`,
  ].join('\n');
}

export function logArkuszMapaError(
  logger: ArkuszMapaErrorLogger | undefined,
  report: ArkuszMapaErrorReport,
): void {
  const text = formatArkuszMapaError(report);
  const log = logger?.error ?? logger?.warn ?? logger?.info;
  if (log) {
    log(text);
    return;
  }
  console.error(text);
}

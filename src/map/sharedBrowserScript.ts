/** Funkcje TS wstrzykiwane do skryptu mapy. */

import { isBolecinPlace } from '../harmonogramGroup.js';
import { jsonForScript } from '../jsonForScript.js';
import { POLISH_VOIVODESHIPS } from '../polishVoivodeships.js';
import { polishAsciiLower } from '../polishText.js';
import { functionSourceForBrowser } from '../routeName.js';
import { normalizeRateShopKey } from '../saveRate.js';
import {
  LOCALITY_SECOND_WORD,
  addressWithCommaAfterLocality,
  foldLocality,
  insertCommaAfterLocalityHeuristic,
  insertCommaAfterPlace,
  splitLeadingPostcode,
} from '../sheets.js';
import {
  DOC_DEFAULT_SEAL_NUMBER_LENGTH,
  DOC_LISTA_PLOMB_PLACEHOLDER_ROWS,
  DOCX_LISTA_PLOMB_FONT_SIZE_PT,
  buildDocListaPlombFields,
  buildListaPlombLines,
  buildListaPlombOoxmlFromLines,
  buildListaPlombPlaceholderLines,
  defaultDateZaladunkuYmd,
  escapeXmlForWordText,
  filterSealRowsByMinClosureDate,
  formatDataZamknieciaWorkaAsMmDd,
  maxNumerPlombyLength,
  pad2,
  parseDataZamknieciaWorkaToSortMs,
  resolveCollectibleSealCount,
  sortRowsForListaPlomb,
} from '../wordMapSupport.js';
import {
  aggregateRodzajZbiorkiFromSealRows,
  classifyMapPointZbiorka,
  formatRodzajZbiorkiForDoc,
  normalizeWgHarmonogramu,
  parseZbiorkaFlags,
  rodzajZbiorkiLabel,
} from '../zbiorkaClassify.js';
import {
  buildTransportShopKey,
  displayWojewodztwoLabel,
  formatWojewodztwoFilterSummary,
  mapPointMatchesSearch,
  mapPointMatchesWgHarmonogramuFilter,
  mapPointMatchesWojewodztwoFilter,
  mapPointMatchesZbiorkaFilter,
  normalizeForAddressSearch,
  normalizeWojewodztwoLabel,
  podwykoOptionMatchesSearch,
  resolveTransportLastForPoint,
} from './searchFilters.js';

/**
 * Funkcje TS wstrzykiwane do skryptu mapy pod własnymi nazwami (razem z zależnościami).
 * Przeglądarka wykonuje ten sam kod co testy — nie dopisywać ręcznych kopii w szablonie.
 */
export function mapSharedBrowserScript(): string {
  const fns = [
    normalizeRateShopKey,
    polishAsciiLower,
    normalizeForAddressSearch,
    mapPointMatchesSearch,
    podwykoOptionMatchesSearch,
    buildTransportShopKey,
    resolveTransportLastForPoint,
    parseZbiorkaFlags,
    classifyMapPointZbiorka,
    normalizeWgHarmonogramu,
    mapPointMatchesZbiorkaFilter,
    mapPointMatchesWgHarmonogramuFilter,
    displayWojewodztwoLabel,
    normalizeWojewodztwoLabel,
    mapPointMatchesWojewodztwoFilter,
    formatWojewodztwoFilterSummary,
    defaultDateZaladunkuYmd,
    parseDataZamknieciaWorkaToSortMs,
    rodzajZbiorkiLabel,
    formatRodzajZbiorkiForDoc,
    aggregateRodzajZbiorkiFromSealRows,
    pad2,
    formatDataZamknieciaWorkaAsMmDd,
    sortRowsForListaPlomb,
    buildListaPlombLines,
    maxNumerPlombyLength,
    buildListaPlombPlaceholderLines,
    escapeXmlForWordText,
    buildListaPlombOoxmlFromLines,
    buildDocListaPlombFields,
    filterSealRowsByMinClosureDate,
    resolveCollectibleSealCount,
    foldLocality,
    splitLeadingPostcode,
    insertCommaAfterPlace,
    insertCommaAfterLocalityHeuristic,
    addressWithCommaAfterLocality,
    isBolecinPlace,
  ];
  return (
    `\nvar POLISH_VOIVODESHIPS = ${jsonForScript([...POLISH_VOIVODESHIPS])};\n` +
    `var DOCX_LISTA_PLOMB_FONT_SIZE_PT = ${jsonForScript(DOCX_LISTA_PLOMB_FONT_SIZE_PT)};\n` +
    `var DOC_LISTA_PLOMB_PLACEHOLDER_ROWS = ${jsonForScript(DOC_LISTA_PLOMB_PLACEHOLDER_ROWS)};\n` +
    `var DOC_DEFAULT_SEAL_NUMBER_LENGTH = ${jsonForScript(DOC_DEFAULT_SEAL_NUMBER_LENGTH)};\n` +
    `var LOCALITY_SECOND_WORD = new Set(${jsonForScript([...LOCALITY_SECOND_WORD])});\n` +
    fns.map((fn) => functionSourceForBrowser(fn)).join('\n') +
    '\n'
  );
}

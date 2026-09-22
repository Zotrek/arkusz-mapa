import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  functionSourceForBrowser,
  namesBlockingNewRoute,
  proposeRouteName,
  routeNameBrowserScript,
  stripEsbuildKeepNames,
} from './routeName.js';

function proposeRouteNameInBrowser(
  occupiedNames: readonly string[] | null,
  contractorShortName: string,
  pickupDate: string,
): string {
  const context: { result?: unknown } = {};
  runInNewContext(
    `${routeNameBrowserScript()}\nresult = proposeRouteName(${JSON.stringify(occupiedNames)}, ${JSON.stringify(contractorShortName)}, ${JSON.stringify(pickupDate)});`,
    context,
  );
  if (typeof context.result !== 'string') {
    throw new Error('Skrypt przeglądarki nie zwrócił stringa');
  }
  return context.result;
}

/** Pełna ścieżka jak na mapie: zajęte nazwy → propozycja. Bez helpera `__name` z tsx/esbuild. */
function proposeFromSheetInBrowser(
  sheetNames: readonly string[] | null,
  sessionLastName: string,
  contractorShortName: string,
  pickupDate: string,
): string {
  const context: { result?: unknown } = {};
  runInNewContext(
    `${routeNameBrowserScript()}
result = proposeRouteName(
  namesBlockingNewRoute(${JSON.stringify(sheetNames)}, ${JSON.stringify(sessionLastName)}),
  ${JSON.stringify(contractorShortName)},
  ${JSON.stringify(pickupDate)}
);`,
    context,
  );
  if (typeof context.result !== 'string') {
    throw new Error('Skrypt przeglądarki nie zwrócił stringa z pełnej ścieżki nazwy');
  }
  return context.result;
}

function expectSameProposal(
  occupiedNames: readonly string[] | null,
  contractorShortName: string,
  pickupDate: string,
  expected: string,
): void {
  const occupied = occupiedNames ?? [];
  expect(proposeRouteName(occupied, contractorShortName, pickupDate)).toBe(expected);
  expect(proposeRouteNameInBrowser(occupiedNames, contractorShortName, pickupDate)).toBe(expected);
}

describe('proposeRouteName', () => {
  it('test_proposeRouteName_when_no_names_occupied_should_return_01', () => {
    expectSameProposal([], 'gpw', '18.09.2026', 'gpw-18.09.26-01');
  });

  it('test_proposeRouteName_when_date_is_yyyy_mm_dd_should_use_two_digit_year', () => {
    expectSameProposal([], 'gpw', '2026-09-18', 'gpw-18.09.26-01');
  });

  it('test_proposeRouteName_when_date_is_already_dd_mm_rr_should_keep_it', () => {
    expectSameProposal([], 'gpw', '18.09.26', 'gpw-18.09.26-01');
  });

  it('test_proposeRouteName_when_column_date_given_should_not_keep_four_digit_year', () => {
    const proposal = proposeRouteName([], 'gpw', '18.09.2026');
    expect(proposal).toBe('gpw-18.09.26-01');
    expect(proposal).not.toContain('2026');
    expect(proposeRouteNameInBrowser([], 'gpw', '18.09.2026')).toBe(proposal);
  });

  it('test_proposeRouteName_when_01_occupied_should_return_02', () => {
    expectSameProposal(['gpw-18.09.26-01'], 'gpw', '18.09.2026', 'gpw-18.09.26-02');
  });

  it('test_proposeRouteName_when_02_occupied_and_01_free_should_return_01', () => {
    expectSameProposal(['gpw-18.09.26-02'], 'gpw', '18.09.2026', 'gpw-18.09.26-01');
  });

  it('test_proposeRouteName_when_occupied_name_has_spaces_should_treat_it_as_taken', () => {
    expectSameProposal(['  gpw-18.09.26-01  '], 'gpw', '18.09.2026', 'gpw-18.09.26-02');
  });

  it('test_proposeRouteName_when_other_day_or_contractor_occupied_should_return_01', () => {
    expectSameProposal(
      ['gpw-17.09.26-01', 'inna-18.09.26-01'],
      'gpw',
      '18.09.2026',
      'gpw-18.09.26-01',
    );
  });

  it('test_proposeRouteName_when_01_to_99_occupied_should_return_empty', () => {
    const occupied = Array.from({ length: 99 }, (_, index) => {
      const nn = String(index + 1).padStart(2, '0');
      return `gpw-18.09.26-${nn}`;
    });
    expectSameProposal(occupied, 'gpw', '18.09.2026', '');
  });

  it('test_proposeRouteName_when_98_taken_and_99_free_should_return_99', () => {
    const occupied = Array.from({ length: 98 }, (_, index) => {
      const nn = String(index + 1).padStart(2, '0');
      return `gpw-18.09.26-${nn}`;
    });
    expectSameProposal(occupied, 'gpw', '18.09.2026', 'gpw-18.09.26-99');
  });

  it('test_proposeRouteName_when_contractor_empty_should_return_empty', () => {
    expectSameProposal([], '  ', '18.09.2026', '');
  });

  it('test_proposeRouteName_when_date_invalid_should_return_empty', () => {
    expectSameProposal([], 'gpw', '31.02.2026', '');
    expectSameProposal([], 'gpw', '', '');
    expectSameProposal([], 'gpw', '18/09/2026', '');
  });

  it('test_proposeRouteName_when_occupied_list_missing_should_return_empty', () => {
    expect(proposeRouteName(null as unknown as string[], 'gpw', '18.09.2026')).toBe('');
    expect(proposeRouteNameInBrowser(null, 'gpw', '18.09.2026')).toBe('');
  });

  it('test_namesBlockingNewRoute_when_session_name_missing_from_sheet_should_still_block_it', () => {
    expect(namesBlockingNewRoute([], 'Papirus-21.09.26-01')).toEqual(['Papirus-21.09.26-01']);
    expect(namesBlockingNewRoute(['Papirus-21.09.26-01'], ' Papirus-21.09.26-01 ')).toEqual([
      'Papirus-21.09.26-01',
    ]);
    expect(namesBlockingNewRoute(null, '   ')).toEqual([]);
  });

  it('test_proposeRouteName_when_session_holds_01_should_return_02_even_if_sheet_list_is_empty', () => {
    expect(
      proposeRouteName(namesBlockingNewRoute([], 'Papirus-21.09.26-01'), 'Papirus', '21.09.2026'),
    ).toBe('Papirus-21.09.26-02');
  });

  it('test_routeNameBrowserScript_when_built_should_be_proposeRouteName_source', () => {
    const script = routeNameBrowserScript();
    expect(script).toContain('function namesBlockingNewRoute');
    expect(script).toContain('function proposeRouteName');
    expect(script).not.toContain('__name');
    expect(script).not.toContain('function proposeRouteNameJs');
  });

  it('test_routeNameBrowserScript_when_evaled_should_run_namesBlockingNewRoute', () => {
    const context: { result?: unknown } = {};
    runInNewContext(
      `${routeNameBrowserScript()}\nresult = namesBlockingNewRoute(['a-01'], 'b-01');`,
      context,
    );
    expect(context.result).toEqual(['a-01', 'b-01']);
  });

  it('test_stripEsbuildKeepNames_when_keepNames_wrapper_should_strip_name_helper', () => {
    const wrapped =
      'function demo(){const add=__name(raw=>{return raw},"add");return add(1)}';
    const out = stripEsbuildKeepNames(wrapped);
    expect(out).not.toContain('__name');
    expect(out).toContain('const add=raw=>{return raw}');
  });

  it('test_namesBlockingNewRoute_source_when_stringified_should_avoid_tsx_keepNames_pattern', () => {
    // Regresja: zagnieżdżona `const add = (...) =>` → tsx wstawia `__name(...)`,
    // a wstrzyknięcie .toString() do HTML mapy wywala ReferenceError w przeglądarce.
    const src = namesBlockingNewRoute.toString();
    expect(src).not.toMatch(/__name\s*\(/);
    expect(src).not.toMatch(/\bconst\s+add\s*=/);
    expect(functionSourceForBrowser(namesBlockingNewRoute)).not.toMatch(/__name\s*\(/);
  });

  it('test_routeNameBrowserScript_when_evaled_without_name_helper_should_propose_like_live_map', () => {
    // Scenariusz z produkcji: GPW + data ISO z input[type=date] + zajęte nazwy z arkusza.
    const sheetNames = [
      'GPW Iława -22.09.26-01',
      'Papirus-21.09.26-01',
      'Geodis - 23.09.2026',
    ];
    expect(proposeFromSheetInBrowser(sheetNames, '', 'GPW', '2026-09-23')).toBe('GPW-23.09.26-01');
    expect(proposeFromSheetInBrowser(sheetNames, 'GPW-23.09.26-01', 'GPW', '2026-09-23')).toBe(
      'GPW-23.09.26-02',
    );
    expect(proposeFromSheetInBrowser([], '', 'GPW', '23.09.2026')).toBe('GPW-23.09.26-01');
  });

  it('test_routeNameBrowserScript_when_keepNames_leaks_into_source_should_still_run_after_strip', () => {
    const leaked =
      'function namesBlockingNewRoute(sheetNames,sessionLastName){' +
      'const occupied=[];const seen=new Set;' +
      'const add=__name(raw=>{const name=String(raw??"").trim();' +
      'if(name.length===0||seen.has(name)){return}seen.add(name);occupied.push(name)},"add");' +
      'if(Array.isArray(sheetNames)){for(const raw of sheetNames){add(raw)}}' +
      'add(sessionLastName);return occupied}\n' +
      functionSourceForBrowser(proposeRouteName);
    const cleaned = stripEsbuildKeepNames(leaked);
    expect(cleaned).not.toContain('__name');
    const context: { result?: unknown } = {};
    runInNewContext(
      `${cleaned}\nresult = proposeRouteName(namesBlockingNewRoute(['x-01'], 'y-01'), 'GPW', '2026-09-23');`,
      context,
    );
    expect(context.result).toBe('GPW-23.09.26-01');
  });
});

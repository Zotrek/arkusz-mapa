import { describe, it, expect } from 'vitest';
import type { SheetRow } from './sheets.js';
import {
  buildListaPlombNumbered,
  buildListaPlombOoxml,
  buildMapPointDocPayload,
  buildMiejsceZaladunkuText,
  escapeXmlForWordText,
  formatDataZamknieciaWorkaAsMmDd,
  formatRodzajZbiorkiForDoc,
  extractPodwykoOptionsFromMatrix,
  mergeAdjacentXmlTextRuns,
  shouldMergeAdjacentWtRuns,
  stripBoldDefaultFromParagraphsWithPlaceholders,
  strengthenPlaceholderRunsRPr,
  normalizeOdpadKaucjonowyDescriptionRuns,
  stripTrailingSpaceBeforeCloseWtAfterRodzajColonLabels,
  forceFontSizeHalfPointsOnAllWordRuns,
  DOCX_BODY_FONT_SIZE_PT,
  DOCX_LISTA_PLOMB_FONT_SIZE_PT,
} from './wordMapSupport.js';

function makeSheetRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    sourceRowIndex: overrides.sourceRowIndex ?? 2,
    podmiotHandlowy: overrides.podmiotHandlowy ?? 'PH Sp.',
    sklep: overrides.sklep ?? 'Sklep 1',
    kodPocztowy: overrides.kodPocztowy ?? '62-320',
    miasto: overrides.miasto ?? 'Miłosław',
    ulica: overrides.ulica ?? 'Leśna',
    numerBudynku: overrides.numerBudynku ?? '1',
    gmina: overrides.gmina ?? 'Gmina',
    numerPlomby: overrides.numerPlomby ?? 'P1',
    dataZamknieciaWorka: overrides.dataZamknieciaWorka ?? '',
    zbiorka: overrides.zbiorka ?? '',
    raw: overrides.raw ?? [],
    address: overrides.address ?? '62-320 Miłosław Leśna 1',
  };
}

describe('wordMapSupport', () => {
  it('test_buildMiejsceZaladunkuText_when_rows_given_should_be_podmiot_plus_adres_one_line', () => {
    const text = buildMiejsceZaladunkuText([makeSheetRow()]);
    expect(text).toBe('PH Sp. 62-320 Miłosław Leśna 1');
    expect(text).not.toContain('Sklep');
  });

  it('test_buildListaPlombNumbered_when_rows_given_should_number_each_seal', () => {
    const s = buildListaPlombNumbered([
      makeSheetRow({ numerPlomby: 'A' }),
      makeSheetRow({ numerPlomby: 'B' }),
    ]);
    expect(s).toBe('1.\tA\n2.\tB');
  });

  it('test_buildListaPlombNumbered_when_closure_date_in_L_should_put_mm_dd_before_seal', () => {
    const s = buildListaPlombNumbered([
      makeSheetRow({ numerPlomby: '7001', dataZamknieciaWorka: '15.04.2026' }),
      makeSheetRow({ numerPlomby: '7002', dataZamknieciaWorka: '2026-01-07' }),
    ]);
    expect(s).toBe('1.\t04-15\t7001\n2.\t01-07\t7002');
  });

  it('test_formatDataZamknieciaWorkaAsMmDd_when_iso_or_polish_or_serial_should_parse', () => {
    expect(formatDataZamknieciaWorkaAsMmDd('2026-04-15')).toBe('04-15');
    expect(formatDataZamknieciaWorkaAsMmDd('15.04.2026')).toBe('04-15');
    expect(formatDataZamknieciaWorkaAsMmDd('45761')).toBe('04-14');
    expect(formatDataZamknieciaWorkaAsMmDd('')).toBe('');
    expect(formatDataZamknieciaWorkaAsMmDd('   ')).toBe('');
  });

  it('test_buildMapPointDocPayload_should_match_miejsce_and_lista', () => {
    const p = buildMapPointDocPayload([makeSheetRow({ numerPlomby: 'X' })]);
    expect(p.lista_plomb).toBe('1.\tX');
    expect(p.lista_plomb_xml).toContain('<w:p>');
    expect(p.lista_plomb_xml).toContain(`<w:sz w:val="${DOCX_LISTA_PLOMB_FONT_SIZE_PT * 2}"/>`);
    expect(p.lista_plomb_xml).toContain('1.\tX');
    expect(p.miejsce_zaladunku).toBe('PH Sp. 62-320 Miłosław Leśna 1');
    expect(p.plomby).toEqual(['X']);
  });

  it('test_buildListaPlombOoxml_should_escape_xml_and_use_14pt_half_points', () => {
    const xml = buildListaPlombOoxml([
      makeSheetRow({ numerPlomby: 'A&B', dataZamknieciaWorka: '15.04.2026' }),
    ]);
    expect(xml).toContain('1.\t04-15\tA&amp;B');
    expect(xml).toContain(`<w:sz w:val="${DOCX_LISTA_PLOMB_FONT_SIZE_PT * 2}"/>`);
  });

  it('test_escapeXmlForWordText_should_escape_special_chars', () => {
    expect(escapeXmlForWordText('a<b')).toBe('a&lt;b');
    expect(escapeXmlForWordText('x&y')).toBe('x&amp;y');
  });

  it('test_formatRodzajZbiorkiForDoc_when_empty_should_return_empty', () => {
    expect(formatRodzajZbiorkiForDoc(undefined)).toBe('');
    expect(formatRodzajZbiorkiForDoc('')).toBe('');
  });

  it('test_formatRodzajZbiorkiForDoc_when_reczna_maszyna_or_both_should_map', () => {
    expect(formatRodzajZbiorkiForDoc('Ręczna')).toBe('ręczna');
    expect(formatRodzajZbiorkiForDoc('Maszyna')).toBe('automatyczna');
    expect(formatRodzajZbiorkiForDoc('Maszyna / Ręczna')).toBe('ręczna i automatyczna');
    expect(formatRodzajZbiorkiForDoc('Ręczna / Maszyna')).toBe('ręczna i automatyczna');
  });

  it('test_extractPodwykoOptionsFromMatrix_should_skip_header_map_dane_and_number_duplicate_labels', () => {
    const opts = extractPodwykoOptionsFromMatrix([
      ['Nazwa', 'Dane'],
      ['Janex', 'Janex Sp. z o.o., ul. Test 1'],
      ['Trans', 'TRANS-POL NIP 123'],
      ['Trans', 'TRANS inny oddział NIP 999'],
    ]);
    expect(opts).toEqual([
      { label: 'Janex', dane: 'Janex Sp. z o.o., ul. Test 1' },
      { label: 'Trans', dane: 'TRANS-POL NIP 123' },
      { label: 'Trans (2)', dane: 'TRANS inny oddział NIP 999' },
    ]);
  });

  it('test_extractPodwykoOptionsFromMatrix_should_skip_identical_row_twice', () => {
    const opts = extractPodwykoOptionsFromMatrix([
      ['Nazwa', 'Dane'],
      ['X', 'Dane X'],
      ['X', 'Dane X'],
    ]);
    expect(opts).toEqual([{ label: 'X', dane: 'Dane X' }]);
  });

  it('test_extractPodwykoOptionsFromMatrix_when_only_column_B_should_use_shortened_dane_as_label', () => {
    const opts = extractPodwykoOptionsFromMatrix([
      ['Nazwa', 'Dane'],
      ['', 'Firma ABC Sp. z o.o. ul. Test 1'],
    ]);
    expect(opts).toEqual([{ label: 'Firma ABC Sp. z o.o. ul. Test 1', dane: 'Firma ABC Sp. z o.o. ul. Test 1' }]);
  });

  it('test_extractPodwykoOptionsFromMatrix_when_only_B_very_long_should_truncate_label_with_ellipsis', () => {
    const long = `${'x'.repeat(120)}end`;
    const opts = extractPodwykoOptionsFromMatrix([['Nazwa', 'Dane'], ['', long]]);
    expect(opts).toHaveLength(1);
    expect(opts[0].dane).toBe(long);
    expect(opts[0].label.length).toBeLessThanOrEqual(100);
    expect(opts[0].label.endsWith('…')).toBe(true);
  });

  it('test_extractPodwykoOptionsFromMatrix_when_brak_kolumny_B_should_use_label_as_dane', () => {
    const opts = extractPodwykoOptionsFromMatrix([
      ['Nazwa', 'Dane'],
      ['Tylko nazwa'],
    ]);
    expect(opts).toEqual([{ label: 'Tylko nazwa', dane: 'Tylko nazwa' }]);
  });

  it('test_stripBoldDefaultFromParagraphsWithPlaceholders_should_clear_pPr_bold_when_mustache', () => {
    const xml =
      '<w:body><w:p><w:pPr><w:pStyle w:val="Normal"/><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Label: </w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>{{x}}</w:t></w:r></w:p></w:body>';
    const out = stripBoldDefaultFromParagraphsWithPlaceholders(xml);
    expect(out).toContain('<w:pPr><w:pStyle w:val="Normal"/><w:rPr></w:rPr></w:pPr>');
    expect(out).not.toContain('<w:rPr><w:b/><w:bCs/></w:rPr></w:pPr>');
  });

  it('test_normalizeOdpadKaucjonowyDescriptionRuns_should_force_normal_weight_on_description', () => {
    const xml =
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:rPr><w:i/><w:iCs/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Rodzaj:</w:t></w:r><w:r><w:rPr></w:rPr><w:t>odpad pochodzący z systemu kaucyjnego o kodzie</w:t></w:r><w:r><w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve"> 15 01 06 </w:t></w:r></w:p>';
    const out = normalizeOdpadKaucjonowyDescriptionRuns(xml);
    expect(out).toContain('<w:pPr><w:pStyle w:val="Normal"/><w:rPr></w:rPr></w:pPr>');
    expect(out).toContain('> odpad pochodzący z systemu kaucyjnego o kodzie</w:t>');
    expect(out).toMatch(/odpad pochodzący[\s\S]*<w:b w:val="0"\/>/);
    expect(out).toMatch(/<w:i w:val="0"\/>[\s\S]*15 01 06/);
  });

  it('test_stripTrailingSpaceBeforeCloseWtAfterRodzajColonLabels_should_trim_colon_runs', () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">Rodzaj zbiórki: </w:t></w:r><w:r><w:t>{{rodzaj_zbiorki}}</w:t></w:r></w:p>';
    const out = stripTrailingSpaceBeforeCloseWtAfterRodzajColonLabels(xml);
    expect(out).toContain('Rodzaj zbiórki:</w:t>');
    expect(out).not.toMatch(/Rodzaj zbiórki:\s+<\/w:t>/);
  });

  it('test_strengthenPlaceholderRunsRPr_should_expand_rPr_before_mustache', () => {
    const xml =
      '<w:r><w:rPr><w:b w:val="0"/><w:bCs w:val="0"/></w:rPr><w:t>{{a}}</w:t></w:r>';
    const out = strengthenPlaceholderRunsRPr(xml);
    expect(out).toContain('<w:smallCaps w:val="0"/>');
    expect(out).toContain('<w:i w:val="0"/>');
  });

  it('test_shouldMergeAdjacentWtRuns_when_label_before_placeholder_should_not_merge', () => {
    expect(shouldMergeAdjacentWtRuns('Miejsce załadunku: ', '{{miejsce_zaladunku}}')).toBe(false);
  });

  it('test_shouldMergeAdjacentWtRuns_when_split_tag_should_merge', () => {
    expect(shouldMergeAdjacentWtRuns('{{miejsce_za', 'ladunku}}')).toBe(true);
  });

  it('test_shouldMergeAdjacentWtRuns_when_kaucjonowy_odpad_should_not_merge', () => {
    expect(shouldMergeAdjacentWtRuns('Rodzaj: ', 'odpad pochodzący z systemu kaucyjnego o kodzie')).toBe(
      false,
    );
    expect(shouldMergeAdjacentWtRuns('o kodzie', ' 15 01 06 ')).toBe(false);
  });

  it('test_forceFontSizeHalfPointsOnAllWordRuns_should_set_sz_and_add_rPr_on_bare_runs', () => {
    const half = DOCX_BODY_FONT_SIZE_PT * 2;
    const withRpr = forceFontSizeHalfPointsOnAllWordRuns(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Hi</w:t></w:r>',
      half,
    );
    expect(withRpr).toContain(`<w:sz w:val="${half}"/>`);
    expect(withRpr).toContain(`<w:szCs w:val="${half}"/>`);

    const replaced = forceFontSizeHalfPointsOnAllWordRuns(
      '<w:r><w:rPr><w:sz w:val="56"/></w:rPr><w:t>A</w:t></w:r>',
      half,
    );
    expect(replaced).not.toContain('val="56"');
    expect(replaced).toContain(`<w:sz w:val="${half}"/>`);

    const bare = forceFontSizeHalfPointsOnAllWordRuns('<w:r><w:t>X</w:t></w:r>', half);
    expect(bare).toMatch(new RegExp(`<w:r>\\s*<w:rPr><w:sz w:val="${half}"`));
  });

  it('test_mergeAdjacentXmlTextRuns_when_tag_split_across_runs_should_join', () => {
    const xml =
      '<w:p><w:r><w:t>{{miejsce_za</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ladunku}}</w:t></w:r></w:p>';
    const merged = mergeAdjacentXmlTextRuns(xml);
    expect(merged).toContain('{{miejsce_zaladunku}}');
    expect(merged).not.toContain('{{miejsce_za</w:t></w:r><w:r>');
  });
});

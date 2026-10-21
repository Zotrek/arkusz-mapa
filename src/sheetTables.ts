/**
 * Tabela Arkuszów ma własny zakres. values.append / setValues pod nią go nie powiększa.
 * Rozciąga każdą tabelę od A1 do ostatniego wiersza z danymi. Nie skraca.
 */

export interface SheetTableInfo {
  sheetId: number;
  title: string;
  tables: Array<{
    tableId?: string;
    range?: {
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    };
  }>;
}

export type TableExpandClient = {
  spreadsheets: {
    get(args: unknown, ...rest: unknown[]): Promise<{ data: unknown }>;
    batchUpdate(args: unknown, ...rest: unknown[]): Promise<unknown>;
    values: {
      get(args: unknown, ...rest: unknown[]): Promise<{ data: unknown }>;
    };
  };
};

/**
 * Tabela od A1, krótsza niż dane na zakładce → tylko dłuższy endRowIndex.
 * Nie skraca i nie rusza tabel, które nie zaczynają się w A1.
 */
export function tableExpandRequests(
  sheets: SheetTableInfo[],
  rowCountByTitle: ReadonlyMap<string, number>,
): Array<{
  updateTable: {
    table: {
      tableId: string;
      range: {
        sheetId: number;
        startRowIndex: number;
        endRowIndex: number;
        startColumnIndex: number;
        endColumnIndex: number;
      };
    };
    fields: 'range';
  };
}> {
  const requests: Array<{
    updateTable: {
      table: {
        tableId: string;
        range: {
          sheetId: number;
          startRowIndex: number;
          endRowIndex: number;
          startColumnIndex: number;
          endColumnIndex: number;
        };
      };
      fields: 'range';
    };
  }> = [];
  for (const sheet of sheets) {
    const rowCount = rowCountByTitle.get(sheet.title);
    if (rowCount == null || rowCount < 1) continue;
    for (const table of sheet.tables) {
      const range = table.range;
      const tableId = table.tableId;
      if (!range || !tableId) continue;
      const startRow = range.startRowIndex ?? 0;
      const startCol = range.startColumnIndex ?? 0;
      const endRow = range.endRowIndex;
      const endCol = range.endColumnIndex;
      if (endRow == null || endCol == null) continue;
      if (startRow !== 0 || startCol !== 0) continue;
      if (endRow >= rowCount) continue;
      requests.push({
        updateTable: {
          table: {
            tableId,
            range: {
              sheetId: sheet.sheetId,
              startRowIndex: 0,
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: endCol,
            },
          },
          fields: 'range',
        },
      });
    }
  }
  return requests;
}

export interface GridRange {
  sheetId?: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

export interface BasicFilterInfo {
  range?: GridRange;
  criteria?: Record<string, unknown>;
  sortSpecs?: unknown[];
  filterSpecs?: unknown[];
}

export interface FilterViewInfo {
  filterViewId?: number;
  title?: string;
  range?: GridRange;
}

function extendedGridRange(range: GridRange | undefined, sheetId: number, lastRow: number): GridRange | null {
  if (!range || range.endRowIndex == null || range.endColumnIndex == null) return null;
  if (range.endRowIndex >= lastRow) return null;
  return {
    sheetId,
    startRowIndex: range.startRowIndex ?? 0,
    endRowIndex: lastRow,
    startColumnIndex: range.startColumnIndex ?? 0,
    endColumnIndex: range.endColumnIndex,
  };
}

/** Filtr i widoki filtra kończą się przed ostatnim wierszem — wiersze pod spodem filtr omija. */
export function filterExpandRequests(
  sheetId: number,
  lastRow: number,
  basicFilter: BasicFilterInfo | undefined,
  filterViews: FilterViewInfo[] | undefined,
): Array<{ setBasicFilter?: { filter: BasicFilterInfo }; updateFilterView?: { filter: FilterViewInfo; fields: 'range' } }> {
  const requests: Array<{
    setBasicFilter?: { filter: BasicFilterInfo };
    updateFilterView?: { filter: FilterViewInfo; fields: 'range' };
  }> = [];
  const next = extendedGridRange(basicFilter?.range, sheetId, lastRow);
  if (basicFilter && next) {
    const filter: BasicFilterInfo = { range: next };
    if (basicFilter.criteria) filter.criteria = basicFilter.criteria;
    if (basicFilter.sortSpecs) filter.sortSpecs = basicFilter.sortSpecs;
    if (basicFilter.filterSpecs) filter.filterSpecs = basicFilter.filterSpecs;
    requests.push({ setBasicFilter: { filter } });
  }
  for (const view of filterViews ?? []) {
    const viewRange = extendedGridRange(view.range, sheetId, lastRow);
    if (!viewRange || view.filterViewId == null) continue;
    requests.push({
      updateFilterView: {
        filter: { filterViewId: view.filterViewId, range: viewRange },
        fields: 'range',
      },
    });
  }
  return requests;
}

function quoteSheet(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

/** Każda zakładka pliku, która ma tabelę od A1 krótszą niż dane. */
export async function expandAllTables(
  api: TableExpandClient,
  spreadsheetId: string,
): Promise<number> {
  const metaResponse = await api.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title),basicFilter,filterViews,tables(tableId,range))',
  });
  const rawSheets =
    (
      metaResponse.data as {
        sheets?: Array<{
          properties?: { sheetId?: number; title?: string };
          tables?: SheetTableInfo['tables'];
          basicFilter?: BasicFilterInfo;
          filterViews?: FilterViewInfo[];
        }>;
      }
    ).sheets ?? [];
  const candidates: Array<{
    sheetId: number;
    title: string;
    tables: SheetTableInfo['tables'];
    basicFilter?: BasicFilterInfo;
    filterViews?: FilterViewInfo[];
  }> = [];
  for (const raw of rawSheets) {
    const title = String(raw.properties?.title ?? '').trim();
    const sheetId = raw.properties?.sheetId;
    const tables = raw.tables ?? [];
    const hasFilter = raw.basicFilter != null || (raw.filterViews?.length ?? 0) > 0;
    if (!title || sheetId == null || (tables.length === 0 && !hasFilter)) continue;
    candidates.push({
      sheetId,
      title,
      tables,
      basicFilter: raw.basicFilter,
      filterViews: raw.filterViews,
    });
  }
  if (candidates.length === 0) return 0;
  const rowCountByTitle = new Map<string, number>();
  for (const sheet of candidates) {
    const response = await api.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheet(sheet.title)}!A:ZZ`,
    });
    const values = ((response.data as { values?: unknown[][] }).values ?? []) as unknown[][];
    rowCountByTitle.set(sheet.title, values.length);
  }
  const requests = [
    ...tableExpandRequests(
      candidates.filter((sheet) => sheet.tables.length > 0),
      rowCountByTitle,
    ),
    ...candidates.flatMap((sheet) =>
      filterExpandRequests(
        sheet.sheetId,
        rowCountByTitle.get(sheet.title) ?? 0,
        sheet.basicFilter,
        sheet.filterViews,
      ),
    ),
  ];
  if (requests.length === 0) return 0;
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return requests.length;
}

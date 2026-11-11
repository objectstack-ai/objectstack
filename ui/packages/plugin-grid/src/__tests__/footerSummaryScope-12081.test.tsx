/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 3 — the footer's figures describe the rows the count
 * describes, or say they describe only the page.
 *
 * Measured on objectstack-ai/hotclm#87 (17.7.0): "Planned Amount: Sum:
 * 3,685,900.00 · 300 records", where the 300-row sum is 40,607,000. The grid
 * pages on the server, so the rows it holds are ONE page, and the footer
 * summed them and drew the figure beside the server's count of the whole set.
 *
 * ## What the double serves
 *
 * One store of 300 rows and ONE matcher, applied by both reads: `find` (the
 * `$filter` AST lowered through the spec's own `parseFilterAST`, then
 * `$search` over `$searchFields`) and `queryGroupHeaders` (the compiled
 * `where`, then `search` over `searchFields`). So a whole-set figure that
 * reads a different row set than the count is a different number here, not a
 * coincidence the double happens to agree with.
 *
 * ## The cases
 *
 *   - (a) more rows than a page: the footer reads the WHOLE set, on both data
 *     paths (the grid's own fetch, and a host — `ListView` in the console —
 *     handing it one page with `manualPagination` + `rowCount` + `findParams`);
 *     and a page turn does not ask again.
 *   - (b) no whole-set answer — no door, a refusal, a filter that cannot be
 *     asked, a host that names no query: the figure is the page's, and its
 *     label says so.
 *   - (c) a filter and a search narrow the count and the footer alike.
 *   - every footer aggregate the spec declares takes the same route.
 *   - CONTROL: rows handed in whole, and a grid whose one page is the whole
 *     set, keep the footer they had and ask the server nothing.
 *   - ADR-0144 D6: a money aggregate over a `record`-mode amount is left out
 *     of the whole-set query (the double refuses it as the engine does), so
 *     the other columns keep their whole-set figures.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { parseFilterAST } from '@objectstack/spec/data';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

import { ObjectGrid } from '../ObjectGrid';
import { wholeSetSummaryNodes } from '../useWholeSetSummary';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, I18nProvider, notifyDataChanged } from '@object-ui/react';
import { en } from '@object-ui/i18n/locales';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'plan_line';
const PAGE = 25;

type Row = { id: string; name: string; stage: string; amount: number; note: string | null; closed_at: string; qty: number; currency_code: string } & Record<string, unknown>;
/**
 * 300 rows; every fifth `note` is empty, every third row is `won`, and
 * `closed_at` is one day later per row, so the last row is the latest.
 * `currency_code` alternates USD / EUR, for the `record`-mode amount cases
 * (ADR-0144 D6); `qty` is a plain number beside it.
 */
const ROWS: Row[] = Array.from({ length: 300 }, (_, i) => ({
  id: `r${i}`,
  name: `Line ${i}`,
  stage: i % 3 === 0 ? 'won' : 'open',
  amount: (i + 1) * 100,
  note: i % 5 === 0 ? null : `n${i}`,
  closed_at: new Date(Date.UTC(2025, 0, 1, 9, 30) + i * 86_400_000).toISOString(),
  qty: (i % 7) + 1,
  currency_code: i % 2 === 0 ? 'USD' : 'EUR',
}));

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  stage: { type: 'text', label: 'Stage' },
  amount: { type: 'number', label: 'Amount' },
  note: { type: 'text', label: 'Note' },
  closed_at: { type: 'datetime', label: 'Closed At' },
};

/** The `FilterCondition` subset the lowered filters here use. */
function matchesWhere(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matchesWhere(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$gt' in op) return Number(row[key]) > Number(op.$gt);
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/** ADR-0061 as the double serves it: a substring over the searched fields. */
function matchesSearch(row: Record<string, unknown>, term: unknown, fields: unknown): boolean {
  if (term === undefined) return true;
  const over = Array.isArray(fields) ? (fields as string[]) : ['name', 'note'];
  return over.some((f) => String(row[f] ?? '').toLowerCase().includes(String(term).toLowerCase()));
}

type Agg = { function: string; field?: string; alias: string };
type AggregateQuery = { where?: unknown; groupBy?: string[]; aggregations?: Agg[]; search?: unknown; searchFields?: unknown };

/**
 * One aggregation node over a row set, as `engine.aggregate` answers it. A
 * `min` / `max` over stored instants is the stored TEXT (ISO text orders as
 * time), as a SQL driver answers it.
 */
function aggregateOf(rows: Row[], node: Agg): number | string | null {
  const values: unknown[] = node.field === undefined ? [] : rows.map((r) => r[node.field!]).filter((v) => v !== null && v !== undefined);
  const total = (): number => values.reduce((a: number, b) => a + Number(b), 0);
  if ((node.function === 'min' || node.function === 'max') && typeof values[0] === 'string') {
    const sorted = [...(values as string[])].sort();
    return node.function === 'min' ? sorted[0] : sorted[sorted.length - 1];
  }
  switch (node.function) {
    case 'count': return node.field === undefined ? rows.length : values.length;
    case 'count_distinct': return new Set(values).size;
    case 'sum': return total();
    case 'avg': return values.length === 0 ? null : total() / values.length;
    case 'min': return values.length === 0 ? null : Math.min(...values.map(Number));
    case 'max': return values.length === 0 ? null : Math.max(...values.map(Number));
    default: throw new Error(`double: unsupported aggregation ${node.function}`);
  }
}

type FilterInput = Parameters<typeof parseFilterAST>[0];

const matching = (where: unknown, search: unknown, searchFields: unknown) =>
  ROWS.filter((r) => matchesWhere(r, where) && matchesSearch(r, search, searchFields));

/** A field def's `record`-mode code pointer, as the engine's D6 door reads it. */
const recordPointerOf = (def: unknown): string | undefined => {
  const config = (def as { currencyConfig?: { currencyMode?: unknown; currencyField?: unknown } } | undefined)?.currencyConfig;
  return config?.currencyMode === 'record' && typeof config.currencyField === 'string' ? config.currencyField : undefined;
};

function makeDataSource(opts: {
  door?: 'answers' | 'absent' | 'refuses' | 'no-row' | 'strings';
  /** The object definition's fields `getObjectSchema` answers (default `OBJECT_FIELDS`). */
  fields?: Record<string, unknown>;
  /** Held until this settles, so a test can read the grid before its definition lands. */
  schemaRead?: Promise<unknown>;
} = {}) {
  const door = opts.door ?? 'answers';
  const fields: Record<string, unknown> = opts.fields ?? OBJECT_FIELDS;
  /** Every aggregate the door refused as the engine's ADR-0144 D6 door does: `fn(field)`. */
  const refusals: string[] = [];
  const ds: Record<string, ReturnType<typeof vi.fn>> = {
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const where = params.$filter === undefined ? undefined : parseFilterAST(params.$filter as FilterInput);
      const rows = matching(where, params.$search, params.$searchFields);
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? rows.length;
      return { data: rows.slice(skip, skip + top).map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      await opts.schemaRead;
      return { name: OBJECT, fields };
    }),
  };
  if (door !== 'absent') {
    ds.queryGroupHeaders = vi.fn(async (_object: string, query: AggregateQuery) => {
      if (door === 'refuses') throw Object.assign(new Error('refused'), { code: 'UNSUPPORTED_QUERY_PARAM' });
      const groupBy = query.groupBy ?? [];
      if (groupBy.length > 0) throw new Error('double: this suite asks no grouped query');
      // [ADR-0144 D6] The engine refuses a raw sum / avg / min / max over a
      // `record`-mode amount in an ungrouped query, and runs none of it.
      const raw = (query.aggregations ?? []).filter((node) => ['sum', 'avg', 'min', 'max'].includes(node.function)
        && node.field !== undefined && recordPointerOf(fields[node.field]) !== undefined);
      if (raw.length > 0) {
        refusals.push(...raw.map((node) => `${node.function}(${node.field})`));
        throw Object.assign(new Error('refused: a raw aggregate across currencies'), { code: 'INVALID_FIELD', status: 400 });
      }
      if (door === 'no-row') return [];
      const rows = matching(query.where, query.search, query.searchFields);
      // `strings`: a driver answering decimals and 64-bit counts as their string
      // spelling (node-postgres does, for `numeric` and `bigint`).
      return [Object.fromEntries((query.aggregations ?? []).map((node) => {
        const value = aggregateOf(rows, node);
        return [node.alias, door === 'strings' && value !== null ? String(value) : value];
      }))];
    });
  }
  return Object.assign(ds, { refusals });
}

type TestDataSource = ReturnType<typeof makeDataSource>;

const sumOf = (rows: Row[]) => rows.reduce((a, r) => a + r.amount, 0);
const fmt = (n: number) => n.toLocaleString('en');

const AMOUNT_SUM = [
  { field: 'name', label: 'Name' },
  { field: 'amount', label: 'Amount', type: 'number', summary: 'sum' },
];

const ownFetchGrid = (ds: TestDataSource, columns: unknown[] = AMOUNT_SUM, extra: Record<string, unknown> = {}) => (
  <ActionProvider>
    <ObjectGrid
      schema={{ type: 'object-grid', objectName: OBJECT, columns, pagination: { pageSize: PAGE }, ...extra } as unknown as ObjectGridSchema}
      dataSource={ds as unknown as DataSource}
    />
  </ActionProvider>
);

/** The host's page, as `ListView` hands one down (objectui#4501's literal, key for key). */
function hostGrid(ds: TestDataSource, opts: {
  rows: Row[];
  page?: number;
  findParams?: Record<string, unknown> | null;
  columns?: unknown[];
  /** The count the host shows, when it is not the rows' own length. */
  rowCount?: number;
}) {
  const page = opts.page ?? 1;
  const findParams = opts.findParams === undefined
    ? { $orderby: [{ field: 'name', order: 'asc' }], $top: PAGE, ...(page > 1 ? { $skip: (page - 1) * PAGE } : {}), $select: ['id', 'name', 'amount'] }
    : opts.findParams;
  return (
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns: opts.columns ?? AMOUNT_SUM, pagination: { pageSize: PAGE } } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
        data={opts.rows.slice((page - 1) * PAGE, page * PAGE)}
        manualPagination
        rowCount={opts.rowCount ?? opts.rows.length}
        page={page}
        pageSize={PAGE}
        onPageChange={() => {}}
        {...(findParams ? { findParams } : {})}
      />
    </ActionProvider>
  );
}

const footerText = (field: string) => screen.queryByTestId(`summary-${field}`)?.textContent ?? null;

describe('the footer reads the whole matched set when the grid shows one page of more (objectui#12081 item 3)', () => {
  it('(a) own fetch: 300 rows over pages of 25 — the footer sums all 300, not page 1', async () => {
    const ds = makeDataSource();
    render(ownFetchGrid(ds));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());

    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
    expect(footerText('amount')).not.toContain(fmt(sumOf(ROWS.slice(0, PAGE))));
  });

  it('(a) host-driven page: the footer sums the host query\'s whole set', async () => {
    const ds = makeDataSource();
    render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());

    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
  });

  it('(a) a page turn does not ask again — the question is the query, not the window', async () => {
    const ds = makeDataSource();
    const view = render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
    const asked = ds.queryGroupHeaders.mock.calls.length;
    expect(asked).toBe(1);

    view.rerender(hostGrid(ds, { rows: ROWS, page: 2 }));
    await waitFor(() => expect(screen.getByText('Line 25')).toBeInTheDocument());
    expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`);
    expect(ds.queryGroupHeaders.mock.calls.length).toBe(asked);
  });

  it('(a) own fetch: turning the page re-fetches the rows and keeps the whole-set answer', async () => {
    const ds = makeDataSource();
    render(ownFetchGrid(ds));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
    const asked = ds.queryGroupHeaders.mock.calls.length;

    // The pager's next-page button, by its accessible name (objectui#12124).
    fireEvent.click(screen.getByRole('button', { name: en.table.nextPage }));
    await waitFor(() => expect(screen.getByText('Line 25')).toBeInTheDocument());
    expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`);
    expect(ds.queryGroupHeaders.mock.calls.length).toBe(asked);
  });

  it('(c) a filter and a search narrow the count and the footer alike', async () => {
    const ds = makeDataSource();
    const filter = ['stage', '=', 'won'];
    const narrowed = matching(parseFilterAST(filter as FilterInput), 'Line 1', ['name']);
    // Not a coincidence the assertions could pass by: a strict subset, larger than a page.
    expect(narrowed.length).toBeGreaterThan(PAGE);
    expect(narrowed.length).toBeLessThan(ROWS.length);

    render(hostGrid(ds, {
      rows: narrowed,
      columns: [
        { field: 'name', label: 'Name', summary: 'count' },
        { field: 'amount', label: 'Amount', type: 'number', summary: 'sum' },
      ],
      findParams: { $filter: filter, $orderby: [{ field: 'name', order: 'asc' }], $top: PAGE, $search: 'Line 1', $searchFields: ['name'] },
    }));

    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(narrowed))}`));
    // The footer's count is the count's own number: the same rows.
    expect(footerText('name')).toBe(`Name: Count: ${fmt(narrowed.length)}`);
    // …asked as ONE query carrying the view's filter and the search pair, and nothing about the window.
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    const [object, query] = ds.queryGroupHeaders.mock.calls[0];
    expect(object).toBe(OBJECT);
    expect(query).toEqual({
      where: parseFilterAST(filter as FilterInput),
      search: 'Line 1',
      searchFields: ['name'],
      aggregations: [
        { function: 'count', alias: 'count' },
        { function: 'sum', field: 'amount', alias: 'sum_amount' },
      ],
    });
  });

  it('every footer aggregate reads the whole set (count, filled, empty, unique, percent, avg, min, max)', async () => {
    const ds = makeDataSource();
    const notes = ROWS.filter((r) => r.note !== null);
    render(hostGrid(ds, {
      rows: ROWS,
      columns: [
        { field: 'name', label: 'Name', summary: 'count' },
        { field: 'note', label: 'Note', summary: 'count_filled' },
        { field: 'stage', label: 'Stage', summary: 'count_unique' },
        { field: 'id', label: 'Id', summary: { type: 'percent_empty', field: 'note' } },
        { field: 'amount', label: 'Amount', type: 'number', summary: 'avg' },
      ],
    }));
    await waitFor(() => expect(footerText('name')).toBe(`Name: Count: ${fmt(ROWS.length)}`));
    expect(footerText('note')).toBe(`Note: Filled: ${fmt(notes.length)}`);
    expect(footerText('stage')).toBe('Stage: Unique: 2');
    expect(footerText('id')).toBe(`Id: Empty: ${((ROWS.length - notes.length) / ROWS.length * 100).toLocaleString('en', { maximumFractionDigits: 1 })}%`);
    expect(footerText('amount')).toBe(`Amount: Avg: ${fmt(sumOf(ROWS) / ROWS.length)}`);

    cleanup();
    render(hostGrid(makeDataSource(), {
      rows: ROWS,
      columns: [
        { field: 'name', label: 'Name', summary: { type: 'min', field: 'amount' } },
        { field: 'amount', label: 'Amount', type: 'number', summary: 'max' },
        { field: 'note', label: 'Note', summary: 'count_empty' },
      ],
    }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Max: ${fmt(ROWS.length * 100)}`));
    expect(footerText('name')).toBe('Name: Min: 100');
    expect(footerText('note')).toBe(`Note: Empty: ${fmt(ROWS.length - notes.length)}`);
  });

  it('a currency column — the issue\'s own shape — formats the whole-set figure as its cells', async () => {
    const ds = makeDataSource();
    render(hostGrid(ds, {
      rows: ROWS,
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Planned Amount', type: 'currency', summary: 'sum' },
      ],
    }));
    // No code resolved: a plain number at two decimals, as the cell renders it.
    await waitFor(() => expect(footerText('amount')).toBe(`Planned Amount: Sum: ${sumOf(ROWS).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`));
  });

  it('a driver answering its figures as strings is read as numbers', async () => {
    const ds = makeDataSource({ door: 'strings' });
    render(hostGrid(ds, {
      rows: ROWS,
      columns: [
        { field: 'name', label: 'Name', summary: 'count' },
        { field: 'amount', label: 'Amount', type: 'number', summary: 'sum' },
        { field: 'note', label: 'Note', summary: 'percent_filled' },
      ],
    }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
    expect(footerText('name')).toBe(`Name: Count: ${fmt(ROWS.length)}`);
    expect(footerText('note')).toBe('Note: Filled: 80%');
  });

  it('a write to the object asks again, so the footer follows the data', async () => {
    const ds = makeDataSource();
    render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(ROWS))}`));
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);

    notifyDataChanged({ objectName: OBJECT });
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(2));
  });
});

describe('no whole-set answer: the figure is the page\'s, and the label says so (objectui#12081 item 3)', () => {
  const pageLabel = `Amount: Sum (this page): ${fmt(sumOf(ROWS.slice(0, PAGE)))}`;

  it('(b) the data source declares no aggregate door', async () => {
    const ds = makeDataSource({ door: 'absent' });
    render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
    await waitFor(() => expect(footerText('amount')).toBe(pageLabel));
  });

  it('(b) the door refuses the query', async () => {
    const ds = makeDataSource({ door: 'refuses' });
    render(ownFetchGrid(ds));
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await waitFor(() => expect(footerText('amount')).toBe(pageLabel));
  });

  it('(b) the answer is not one row', async () => {
    const ds = makeDataSource({ door: 'no-row' });
    render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await waitFor(() => expect(footerText('amount')).toBe(pageLabel));
  });

  it('(b) the answer counts other rows than the count shown — the platform\'s paged count under a search is an estimate', async () => {
    // Measured on the 17.7.0 data door: under `$search` a paged find answers
    // `total` as offset + page + 1 (26 for a page of 25 over 138 matches),
    // because `engine.count` takes no search. The whole-set figures describe the
    // 138; drawn beside "26" they would describe other rows than the count's.
    const ds = makeDataSource();
    const searched = matching(undefined, 'Line 1', ['name']);
    expect(searched.length).toBeGreaterThan(PAGE + 1);
    render(hostGrid(ds, {
      rows: searched,
      rowCount: PAGE + 1,
      findParams: { $orderby: [{ field: 'name', order: 'asc' }], $top: PAGE, $search: 'Line 1', $searchFields: ['name'] },
    }));
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum (this page): ${fmt(sumOf(searched.slice(0, PAGE)))}`));
  });

  it('(b) a host that hands a page but names no query', async () => {
    const ds = makeDataSource();
    render(hostGrid(ds, { rows: ROWS, findParams: null }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
    await waitFor(() => expect(footerText('amount')).toBe(pageLabel));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('(b) a query carrying a key the whole-set read cannot repeat is not asked a narrower or wider question', async () => {
    const ds = makeDataSource();
    render(hostGrid(ds, { rows: ROWS, findParams: { $top: PAGE, $unknownNarrowing: 'x' } }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
    await waitFor(() => expect(footerText('amount')).toBe(pageLabel));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });
});

describe('CONTROL: rows that ARE the whole set keep their footer and ask nothing (objectui#12081 item 3)', () => {
  it('rows handed in whole (no host paging declared)', async () => {
    const ds = makeDataSource();
    const rows = ROWS.slice(0, 40);
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, columns: AMOUNT_SUM, data: { provider: 'value', items: rows } } as unknown as ObjectGridSchema}
          dataSource={ds as unknown as DataSource}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(rows))}`));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('a grid whose one page is the whole matched set', async () => {
    const ds = makeDataSource();
    const filter = ['amount', '>', 29000];
    const few = matching(parseFilterAST(filter as FilterInput), undefined, undefined);
    expect(few.length).toBeLessThan(PAGE);
    render(ownFetchGrid(ds, AMOUNT_SUM, { filter }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Sum: ${fmt(sumOf(few))}`));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });
});

describe('a grid with no footer figure asks nothing (objectui#12081 item 3, rework round 1)', () => {
  /** Long enough for an effect's request to have gone out; the last leg below proves it is. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it('a host-driven paged grid whose columns declare no summary, only `none`, or only unknown members keeps queryGroupHeaders uncalled', async () => {
    // Every console list view is this grid: object-form columns, one page of
    // more, handed down with manualPagination + rowCount + findParams.
    const cases: Array<[string, unknown[]]> = [
      ['no summary', [{ field: 'name', label: 'Name' }, { field: 'amount', label: 'Amount', type: 'number' }]],
      ['only none', [{ field: 'name', label: 'Name', summary: 'none' }, { field: 'amount', label: 'Amount', summary: { type: 'none' } }]],
      ['only unknown members', [{ field: 'name', label: 'Name', summary: 'median' }, { field: 'amount', label: 'Amount', summary: { type: 'total' } }]],
    ];
    for (const [label, columns] of cases) {
      const ds = makeDataSource();
      render(hostGrid(ds, { rows: ROWS, columns }));
      await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
      await settle();
      expect({ label, asked: ds.queryGroupHeaders.mock.calls.length }).toEqual({ label, asked: 0 });
      expect(screen.queryByTestId('column-summary-footer')).toBeNull();
      cleanup();
    }

    // Control leg: the same harness and the same wait DO see a request once a
    // column declares a summary, so the zeros above are readings.
    const ds = makeDataSource();
    render(hostGrid(ds, { rows: ROWS }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
    await settle();
    expect(ds.queryGroupHeaders.mock.calls.length).toBe(1);
  });
});

describe('the page label is the pack\'s, not an English suffix (objectui#12081 item 3)', () => {
  it('zh: the pack places the scope', async () => {
    const ds = makeDataSource({ door: 'absent' });
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        {hostGrid(ds, { rows: ROWS })}
      </I18nProvider>,
    );
    await waitFor(() => expect(footerText('amount')).toContain('（本页）'));
    expect(footerText('amount')).toContain('合计');
    expect(footerText('amount')).not.toMatch(/this page|Sum/);
  });
});

describe('a date-family `min` / `max` in the footer reads as its cell, never as a number (objectstack#32119)', () => {
  const CLOSED_MAX = [
    { field: 'name', label: 'Name' },
    { field: 'closed_at', label: 'Closed At', summary: 'max' },
  ];

  /** The Closed At cell of the row named `name`, in the grid on screen. */
  function closedAtCell(name: string): string | null {
    const headers = [...document.querySelectorAll('thead tr th')].map((th) => th.textContent ?? '');
    const index = headers.findIndex((text) => text.includes('Closed At'));
    for (const tr of document.querySelectorAll('tbody tr')) {
      const tds = tr.querySelectorAll('td');
      if ([...tds].some((td) => td.textContent === name) && tds.length > index) return tds[index].textContent;
    }
    return null;
  }

  /** The cell a one-row grid of `row` draws for Closed At — the cell's own face. */
  async function cellOf(row: Row): Promise<string> {
    cleanup();
    const ds = makeDataSource({ door: 'absent' });
    render(hostGrid(ds, { rows: [row], columns: CLOSED_MAX }));
    await waitFor(() => expect(closedAtCell(row.name)).toBeTruthy());
    return closedAtCell(row.name)!;
  }

  it('rows handed in whole: the `max` is the latest row\'s cell, not its year', async () => {
    const ds = makeDataSource({ door: 'absent' });
    const rows = ROWS.slice(0, 10);
    render(hostGrid(ds, { rows, columns: CLOSED_MAX }));
    await waitFor(() => expect(footerText('closed_at')).toBeTruthy());
    await waitFor(() => expect(closedAtCell('Line 9')).toBeTruthy());
    expect(footerText('closed_at')).toBe(`Closed At: Max: ${closedAtCell('Line 9')}`);
    expect(footerText('closed_at')).not.toMatch(/2,025|NaN/);
  });

  it('own fetch, one page of 300: the whole set\'s `max` (the server\'s stored text) reads as the last row\'s cell', async () => {
    const ds = makeDataSource();
    render(ownFetchGrid(ds, CLOSED_MAX));
    await waitFor(() => expect(footerText('closed_at')).toMatch(/^Closed At: Max: /));
    const footer = footerText('closed_at');
    expect(footer).not.toMatch(/2,025|NaN|this page/);
    expect(footer).toBe(`Closed At: Max: ${await cellOf(ROWS[299])}`);
  });

  it('a `sum` / `avg` over a datetime column draws no figure; CONTROL — a `max` over a number column still reads as a number', async () => {
    const ds = makeDataSource({ door: 'absent' });
    render(hostGrid(ds, {
      rows: ROWS.slice(0, 10),
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'closed_at', label: 'Closed At', summary: 'sum' },
        { field: 'amount', label: 'Amount', type: 'number', summary: 'max' },
      ],
    }));
    await waitFor(() => expect(footerText('amount')).toBe(`Amount: Max: ${fmt(1000)}`));
    expect(footerText('closed_at')).toBeNull();
  });
});

describe('a money aggregate over a `record`-mode amount is left out of the whole-set query (ADR-0144 D6)', () => {
  const recordAmount = (currencyField: string) => ({
    type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField },
  });
  /** `amount` in each row's own currency, the code in the sibling `currency_code`. */
  const SIBLING = {
    ...OBJECT_FIELDS,
    amount: recordAmount('currency_code'),
    currency_code: { type: 'text', label: 'Currency' },
    qty: { type: 'number', label: 'Qty' },
  };
  /** `amount` in its parent invoice's currency, through the `master_detail` (ADR-0144 D2, amended). */
  const PARENT_PATH = {
    ...OBJECT_FIELDS,
    amount: recordAmount('invoice.currency_code'),
    invoice: { type: 'master_detail', reference: 'invoice', label: 'Invoice' },
    qty: { type: 'number', label: 'Qty' },
  };
  const COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'amount', label: 'Amount', type: 'currency', summary: 'sum' },
    { field: 'qty', label: 'Qty', type: 'number', summary: 'sum' },
  ];
  const qtyWhole = `Qty: Sum: ${fmt(ROWS.reduce((a, r) => a + r.qty, 0))}`;
  /** The money nodes on `amount` among every query the door was asked. */
  const amountMoneyNodes = (ds: TestDataSource) => ds.queryGroupHeaders.mock.calls
    .flatMap(([, query]) => (query as AggregateQuery).aggregations ?? [])
    .filter((node) => node.field === 'amount' && node.function !== 'count');

  it.each([
    ['a sibling code field', SIBLING],
    ['a parent path', PARENT_PATH],
  ])('%s: the plain-number sum keeps its whole-set figure, and no refused request is sent', async (_pointer, fields) => {
    const ds = makeDataSource({ fields });
    render(hostGrid(ds, { rows: ROWS, columns: COLUMNS }));

    await waitFor(() => expect(footerText('qty')).toBe(qtyWhole));
    // The record-mode column draws nothing (the footer's own D6 skip, kept).
    expect(footerText('amount')).toBeNull();
    expect(ds.refusals).toEqual([]);
    expect(amountMoneyNodes(ds)).toEqual([]);
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect((ds.queryGroupHeaders.mock.calls[0][1] as AggregateQuery).aggregations).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'sum', field: 'qty', alias: 'sum_qty' },
    ]);
  });

  it('the money aggregate is not asked while the field catalogue is still on its way, and is asked once it lands', async () => {
    let land!: () => void;
    const schemaRead = new Promise<void>((resolve) => { land = resolve; });
    const ds = makeDataSource({ fields: SIBLING, schemaRead });
    render(hostGrid(ds, { rows: ROWS, columns: COLUMNS }));
    await waitFor(() => expect(screen.getByText('Line 0')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Unknown currency mode: no guess is sent, and the footer is the page's.
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
    expect(footerText('qty')).toMatch(/^Qty: Sum \(this page\): /);

    land();
    await waitFor(() => expect(footerText('qty')).toBe(qtyWhole));
    expect(ds.refusals).toEqual([]);
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
  });

  it('a summary list whose only figure is a record-mode money aggregate asks nothing; the counts over the amount stand', () => {
    expect(wholeSetSummaryNodes([{ field: 'amount', summary: 'sum' }] as never, SIBLING)).toBeNull();
    expect(wholeSetSummaryNodes([
      { field: 'amount', summary: 'max' },
      { field: 'id', summary: { type: 'min', field: 'amount' } },
      { field: 'name', summary: { type: 'avg', field: 'amount' } },
      { field: 'note', summary: { type: 'count_filled', field: 'amount' } },
      { field: 'stage', summary: { type: 'count_unique', field: 'amount' } },
      { field: 'qty', summary: 'avg' },
    ] as never, PARENT_PATH)).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'count', field: 'amount', alias: 'count_amount' },
      { function: 'count_distinct', field: 'amount', alias: 'count_distinct_amount' },
      { function: 'avg', field: 'qty', alias: 'avg_qty' },
    ]);
    // CONTROL: the same columns over a catalogue that does not say `record` keep every node.
    expect(wholeSetSummaryNodes([{ field: 'amount', summary: 'sum' }] as never, OBJECT_FIELDS)).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'sum', field: 'amount', alias: 'sum_amount' },
    ]);
  });
});

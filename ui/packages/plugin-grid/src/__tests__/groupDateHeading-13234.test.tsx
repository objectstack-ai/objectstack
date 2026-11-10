/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13234 — a grid grouped by a `date` or `datetime` field heads each
 * group with its key drawn the way the grid's CELL draws that field, not with
 * the stored string.
 *
 * Measured on a CRM's forecast list grouped by the `date` field
 * `period_start`: the headings read `2026-10-01`, `2026-09-01`, `2026-08-01`,
 * while the Period Start cell of a row under them read "Oct 1". Select and
 * boolean headings already read their labels; every other type fell back to
 * the stored key.
 *
 * The pins compare each heading with the cell under it, in the same grid,
 * rather than with a literal. The heading must read what the cell reads for
 * every face the field can declare (`format`), so a change to either side
 * turns these red instead of letting the two drift apart.
 *
 * Both group sources are pinned: SERVER-grouped (the grid owns its fetch) and
 * CLIENT-grouped (a host hands the rows in).
 *
 * CONTROLS, which hold before and after the change: the groups keep the order
 * and counts of their stored keys (the headings are drawn, not sorted), the
 * empty group keeps its "(empty)" heading, and a text key reads as itself.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { renderHook } from '@testing-library/react';
import { ObjectGrid } from '../ObjectGrid';
import { useGroupedData } from '../useGroupedData';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

afterEach(() => cleanup());

const OBJECT = 'crm_forecast';

/** A calendar day `offset` days from today, as a `date` field stores it. */
function storedDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An instant `offset` days from now, as a `datetime` field stores it. */
function storedInstant(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString();
}

// One key inside the cells' relative window (three days back) and three
// outside it, so both the relative and the absolute branches of a face are
// read. Two rows share each of the October keys, so a group holds more than
// one row, and one row has no value at all.
const RECENT_DAY = storedDay(-3);
const RECENT_INSTANT = storedInstant(-2);
const ROWS: Array<Record<string, unknown>> = [
  { id: 'f1', name: 'Q4 opening', period_start: '2026-10-01', closed_at: '2026-10-01T09:30:00.000Z', region: 'emea', amount: 900 },
  { id: 'f2', name: 'September', period_start: '2026-09-01', closed_at: '2026-09-01T16:45:00.000Z', region: 'amer', amount: 120.25 },
  { id: 'f3', name: 'August', period_start: '2026-08-01', closed_at: '2026-08-01T07:05:00.000Z', region: 'apac', amount: 40 },
  { id: 'f4', name: 'Q4 second', period_start: '2026-10-01', closed_at: '2026-10-01T09:30:00.000Z', region: 'emea', amount: 300 },
  { id: 'f5', name: 'This week', period_start: RECENT_DAY, closed_at: RECENT_INSTANT, region: 'amer', amount: 80.5 },
  { id: 'f6', name: 'Undated', period_start: null, closed_at: null, region: 'apac', amount: null },
];

type Face = string | undefined;

function objectFields(dateFormat: Face, datetimeFormat: Face) {
  return {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    period_start: { type: 'date', label: 'Period Start', ...(dateFormat !== undefined ? { format: dateFormat } : {}) },
    closed_at: { type: 'datetime', label: 'Closed At', ...(datetimeFormat !== undefined ? { format: datetimeFormat } : {}) },
    region: { type: 'text', label: 'Region' },
    amount: { type: 'number', label: 'Amount' },
  };
}

/** The `FilterCondition` subset the compiled group queries use. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

type Agg = { function: string; field?: string; alias: string };

/**
 * One aggregation node over a group's rows, as a SQL driver answers it: a
 * `min` / `max` over a stored date or instant is that stored TEXT (ISO text
 * orders as time), a `sum` / `avg` over numbers is a number.
 */
function aggregateOf(rows: Array<Record<string, unknown>>, node: Agg): unknown {
  const values = rows.map((r) => r[node.field ?? '']).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return null;
  switch (node.function) {
    case 'min': return typeof values[0] === 'number'
      ? Math.min(...(values as number[]))
      : [...values].sort((a, b) => (String(a) < String(b) ? -1 : 1))[0];
    case 'max': return typeof values[0] === 'number'
      ? Math.max(...(values as number[]))
      : [...values].sort((a, b) => (String(a) < String(b) ? -1 : 1))[values.length - 1];
    case 'sum': return (values as number[]).reduce((a, b) => a + Number(b), 0);
    case 'avg': return (values as number[]).reduce((a, b) => a + Number(b), 0) / values.length;
    default: throw new Error(`double: unsupported aggregation ${node.function}`);
  }
}

/**
 * A data source that answers the group header query with the stored keys,
 * sorted as a `GROUP BY` answers them, and each aggregation node under its
 * alias; and pages each group's rows.
 */
function serverSource(fields: ReturnType<typeof objectFields>) {
  return {
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[]; aggregations?: Agg[] }) => {
      const groupBy = query.groupBy ?? [];
      const buckets = new Map<string, Array<Record<string, unknown>>>();
      for (const row of ROWS.filter((r) => matches(r, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      return [...buckets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, rows]) => {
          const values = JSON.parse(key) as unknown[];
          const aggregates = (query.aggregations ?? [])
            .filter((node) => !(node.function === 'count' && node.field === undefined))
            .map((node) => [node.alias, aggregateOf(rows, node)]);
          return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), ...Object.fromEntries(aggregates), count: rows.length };
        });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const matching = ROWS.filter((r) => matches(r, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      return { data: matching.slice(skip, skip + top), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields })),
  };
}

/** The client path: the rows are handed in; the source answers the definition only. */
function schemaOnlySource(fields: ReturnType<typeof objectFields>) {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields })),
  };
}

type GroupingEntry = { field: string; order?: 'asc' | 'desc' };
type Source = 'server' | 'client';

type GroupAggregation = { field: string; type: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct' };

function renderGrouped(
  source: Source,
  grouping: GroupingEntry[],
  faces: { date?: Face; datetime?: Face } = {},
  aggregations?: GroupAggregation[],
) {
  const fields = objectFields(faces.date, faces.datetime);
  const ds = source === 'server' ? serverSource(fields) : schemaOnlySource(fields);
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['name', 'period_start', 'closed_at', 'region'],
          ...(source === 'client' ? { data: { provider: 'value', items: ROWS } } : {}),
          grouping: { fields: grouping },
          ...(aggregations ? { aggregations } : {}),
        } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );
  return ds;
}

const BAND = 'data-table-group-band';

/** The column's index among the header cells, by its label. */
function columnIndex(label: string): number {
  const headers = [...document.querySelectorAll('thead tr th')].map((th) => th.textContent ?? '');
  const index = headers.findIndex((text) => text.includes(label));
  if (index < 0) throw new Error(`no column headed ${label}; headers: ${JSON.stringify(headers)}`);
  return index;
}

interface Band {
  /** The group's key, as the band's test id carries it. */
  key: string;
  heading: string;
  count: string;
  /** The text of the column's cell in the first data row under the band. */
  cell: string | undefined;
}

/** The depth-0 bands top to bottom, each with the cell under it. */
function topBands(columnLabel: string): Band[] {
  const index = columnIndex(columnLabel);
  return [...document.querySelectorAll(`tr[data-testid="${BAND}"]`)]
    .map((tr) => ({ tr, row: tr.querySelector('[data-testid^="group-row-"]') }))
    .filter(({ row }) => row !== null && !row.getAttribute('data-testid')!.includes('__'))
    .map(({ tr, row }) => {
      let cell: string | undefined;
      for (let next = tr.nextElementSibling; next; next = next.nextElementSibling) {
        if (next.getAttribute('data-testid') === BAND) continue;
        const tds = next.querySelectorAll('td');
        if (tds.length > index) cell = tds[index].textContent ?? undefined;
        break;
      }
      return {
        key: row!.getAttribute('data-testid')!.replace(/^group-row-/, ''),
        heading: row!.querySelector('.group-label')?.textContent ?? '',
        count: row!.querySelector('.group-count')?.textContent ?? '',
        cell,
      };
    });
}

/** Wait until the definition landed and every non-empty band has its cell. */
async function settledBands(ds: { getObjectSchema: ReturnType<typeof vi.fn> }, columnLabel: string, n: number) {
  await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await vi.waitFor(() => {
    const bands = topBands(columnLabel);
    expect(bands).toHaveLength(n);
    for (const band of bands) expect(band.cell).toBeDefined();
  });
  return topBands(columnLabel);
}

const DAY_KEYS_DESC = [RECENT_DAY, '2026-10-01', '2026-09-01', '2026-08-01'];

describe.each<Source>(['server', 'client'])('a %s-grouped grid heads a date group as its cell reads (objectui#13234)', (source) => {
  describe.each<Face>([undefined, 'relative', 'short', 'YYYY-MM-DD'])('`date` field, format %s', (format) => {
    it('each heading reads the Period Start cell under it, never the stored key', async () => {
      const ds = renderGrouped(source, [{ field: 'period_start', order: 'desc' }], { date: format });
      const bands = await settledBands(ds, 'Period Start', 5);
      for (const band of bands.filter((b) => b.heading !== '(empty)')) {
        expect(band.heading).toBe(band.cell);
        expect(DAY_KEYS_DESC).not.toContain(band.heading);
      }
    });
  });

  describe.each<Face>([undefined, 'relative', 'short', 'compact', 'YYYY-MM-DD'])('`datetime` field, format %s', (format) => {
    it('each heading reads the Closed At cell under it, never the stored instant', async () => {
      const ds = renderGrouped(source, [{ field: 'closed_at', order: 'desc' }], { datetime: format });
      const bands = await settledBands(ds, 'Closed At', 5);
      for (const band of bands.filter((b) => b.heading !== '(empty)')) {
        expect(band.heading).toBe(band.cell);
        expect(band.heading).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  it('CONTROL — the groups keep the order and counts of their stored keys, and the empty group its heading', async () => {
    const ds = renderGrouped(source, [{ field: 'period_start', order: 'desc' }]);
    const bands = await settledBands(ds, 'Period Start', 5);
    expect(bands.map((b) => [b.key, b.count])).toEqual([
      [`0:${RECENT_DAY}`, '1'],
      ['0:2026-10-01', '2'],
      ['0:2026-09-01', '1'],
      ['0:2026-08-01', '1'],
      ['0:', '1'],
    ]);
    expect(bands[4].heading).toBe('(empty)');
  });

  it('CONTROL — ascending order is the stored keys\' order too', async () => {
    const ds = renderGrouped(source, [{ field: 'period_start', order: 'asc' }]);
    const bands = await settledBands(ds, 'Period Start', 5);
    expect(bands.map((b) => b.key)).toEqual([
      '0:',
      '0:2026-08-01',
      '0:2026-09-01',
      '0:2026-10-01',
      `0:${RECENT_DAY}`,
    ]);
  });

  it('CONTROL — a text key still reads as itself', async () => {
    const ds = renderGrouped(source, [{ field: 'region' }]);
    const bands = await settledBands(ds, 'Region', 3);
    expect(bands.map((b) => b.heading)).toEqual(['amer', 'apac', 'emea']);
    for (const band of bands) expect(band.heading).toBe(band.cell);
  });
});

describe('two-level grouping, date first (objectui#13234)', () => {
  it('the first-level headings read the cell, under a second level', async () => {
    const ds = renderGrouped('server', [
      { field: 'period_start', order: 'desc' },
      { field: 'region', order: 'desc' },
    ]);
    const bands = await settledBands(ds, 'Period Start', 5);
    expect(bands.map((b) => b.key)).toEqual([
      `0:${RECENT_DAY}`,
      '0:2026-10-01',
      '0:2026-09-01',
      '0:2026-08-01',
      '0:',
    ]);
    for (const band of bands.filter((b) => b.heading !== '(empty)')) {
      expect(band.heading).toBe(band.cell);
      expect(DAY_KEYS_DESC).not.toContain(band.heading);
    }
  });
});

/** The cell text of `columnLabel` in the data row whose Name cell reads `name`. */
function cellOfRow(name: string, columnLabel: string): string {
  const index = columnIndex(columnLabel);
  for (const tr of document.querySelectorAll('tbody tr')) {
    const tds = tr.querySelectorAll('td');
    if ([...tds].some((td) => td.textContent === name) && tds.length > index) return tds[index].textContent ?? '';
  }
  throw new Error(`no row named ${name}`);
}

/** The aggregation chip text of the depth-0 band keyed `0:KEY`. */
function chipOf(key: string): string {
  return document.querySelector(`[data-testid="group-row-0:${key}"] .group-aggregations`)?.textContent ?? '';
}

/** Wait until every region band drew its chip and every named row its cell. */
async function settledChips(ds: { getObjectSchema: ReturnType<typeof vi.fn> }, rowNames: string[]) {
  await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await vi.waitFor(() => {
    for (const key of ['amer', 'apac', 'emea']) expect(chipOf(key)).not.toBe('');
    for (const name of rowNames) expect(() => cellOfRow(name, 'Name')).not.toThrow();
  });
}

describe.each<Source>(['server', 'client'])('a %s-grouped grid draws a date-family min / max as its cell reads (objectstack#32119)', (source) => {
  describe.each<Face>([undefined, 'relative', 'short', 'YYYY-MM-DD'])('`datetime` field, format %s', (format) => {
    it('a `max` reads the Closed At cell of the group\'s latest row, never NaN', async () => {
      const ds = renderGrouped(source, [{ field: 'region' }], { datetime: format }, [{ field: 'closed_at', type: 'max' }]);
      await settledChips(ds, ['This week', 'August', 'Q4 opening']);
      // amer's latest is "This week", apac's only dated row is "August", and
      // emea's two rows share one instant.
      expect(chipOf('amer')).toBe(`max: ${cellOfRow('This week', 'Closed At')}`);
      expect(chipOf('apac')).toBe(`max: ${cellOfRow('August', 'Closed At')}`);
      expect(chipOf('emea')).toBe(`max: ${cellOfRow('Q4 opening', 'Closed At')}`);
      for (const key of ['amer', 'apac', 'emea']) {
        expect(chipOf(key)).not.toMatch(/NaN|\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  describe.each<Face>([undefined, 'relative', 'YYYY-MM-DD'])('`date` field, format %s', (format) => {
    it('a `min` reads the Period Start cell of the group\'s earliest row', async () => {
      const ds = renderGrouped(source, [{ field: 'region' }], { date: format }, [{ field: 'period_start', type: 'min' }]);
      await settledChips(ds, ['September', 'August', 'Q4 opening']);
      expect(chipOf('amer')).toBe(`min: ${cellOfRow('September', 'Period Start')}`);
      expect(chipOf('apac')).toBe(`min: ${cellOfRow('August', 'Period Start')}`);
      expect(chipOf('emea')).toBe(`min: ${cellOfRow('Q4 opening', 'Period Start')}`);
    });
  });

  it('a `sum` / `avg` over a datetime field is left out, never NaN, and the numeric `max` beside it stands', async () => {
    const ds = renderGrouped(source, [{ field: 'region' }], {}, [
      { field: 'closed_at', type: 'sum' },
      { field: 'closed_at', type: 'avg' },
      { field: 'amount', type: 'max' },
    ]);
    await settledChips(ds, []);
    expect(chipOf('amer')).toBe('max: 120.25');
    expect(chipOf('apac')).toBe('max: 40');
    expect(chipOf('emea')).toBe('max: 900');
    if (source === 'server') {
      // Dropped before the header query is compiled: the server is not asked
      // to add up times.
      const asked = (ds as ReturnType<typeof serverSource>).queryGroupHeaders.mock.calls
        .flatMap(([, query]) => (query as { aggregations?: Agg[] }).aggregations ?? []);
      expect(asked.some((node) => node.field === 'closed_at')).toBe(false);
      expect(asked).toContainEqual({ function: 'max', field: 'amount', alias: 'max_amount' });
    }
  });

  it('CONTROL — a numeric `min` / `max` / `avg` still prints the number as before', async () => {
    const ds = renderGrouped(source, [{ field: 'region' }], {}, [
      { field: 'amount', type: 'min' },
      { field: 'amount', type: 'avg' },
    ]);
    await settledChips(ds, []);
    expect(chipOf('amer')).toBe('min: 80.50avg: 100.38');
    expect(chipOf('emea')).toBe('min: 300avg: 600');
  });
});

describe('the published `useGroupedData`, which knows no cell face (objectstack#32119)', () => {
  it('a server `max` answered as stored text is left out, never NaN; a numeric one stands', () => {
    const { result } = renderHook(() => useGroupedData(
      { fields: [{ field: 'region' }] },
      [],
      [{ field: 'closed_at', type: 'max' }, { field: 'amount', type: 'max' }],
      undefined,
      { headers: [[{ region: 'emea', count: 2, max_closed_at: '2026-10-01T09:30:00.000Z', max_amount: '900' }]] },
    ));
    expect(result.current.groups[0].aggregations).toEqual([{ field: 'amount', type: 'max', value: 900 }]);
  });

  it('a client `sum` over a field holding no number is left out, not drawn as 0; an empty group keeps its 0', () => {
    const { result } = renderHook(() => useGroupedData(
      { fields: [{ field: 'region' }] },
      [
        { region: 'emea', closed_at: '2026-10-01T09:30:00.000Z' },
        { region: 'apac', closed_at: null },
      ],
      [{ field: 'closed_at', type: 'sum' }],
    ));
    const byKey = Object.fromEntries(result.current.groups.map((g) => [g.label, g.aggregations]));
    expect(byKey.emea).toEqual([]);
    expect(byKey.apac).toEqual([{ field: 'closed_at', type: 'sum', value: 0 }]);
  });
});

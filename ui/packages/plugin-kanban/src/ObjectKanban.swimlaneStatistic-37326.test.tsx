/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37326 — a board drawn in swimlanes draws the view's lane
 * statistic (`kanban.summary`), which the view settings offer on every board.
 *
 * Rows:
 *   (a) a board that queries its own cards draws each column's whole-lane
 *       figure once, in a foot row under every swimlane, from the one grouped
 *       read the flat board asks (grouped by the column field alone);
 *   (b) a `count` reads each column's count there;
 *   (c) on a board its host hands one page with its query (the #36871 rig), a
 *       column's count is the whole lane's from that read, and a swimlane
 *       row's count (no read groups by it) is marked `+`;
 *   (d) CONTROL: the same board handed every record writes every count bare;
 *   (e) a refused read marks the column counts `+` too;
 *   (f) CONTROL: a board with no statistic draws no foot row;
 *   (g) avg, min and max read the same grouped read as sum (objectstack#37718);
 *   (h) a swimlane board handed one page draws no column that only has
 *       records past the page, while the flat board CONTROL draws it
 *       (the `!flatLanes` gate on `extraLaneIds`, objectstack#37718).
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource, extractRecords } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from './ObjectKanban';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010).
import './KanbanImpl';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const stub = {
    isLoaded: false,
    checkField: () => true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  return { ...actual, usePermissions: () => stub as any };
});

type Row = Record<string, unknown>;

const OBJECT = 'deal';
const DEF = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
      ],
    },
  },
};

/** `n` deals in `stage` whose amounts are 0 … n-1, alternating north / south. */
const deals = (stage: string, n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${stage}-${String(i).padStart(3, '0')}`,
    name: `${stage} ${String(i).padStart(3, '0')}`,
    stage,
    amount: i,
    region: i % 2 === 0 ? 'north' : 'south',
  }));
// 20 open deals (amounts 0 … 19, sum 190), 4 won (sum 6).
const ROWS = [...deals('open', 20), ...deals('won', 4)];

/**
 * A grouped aggregate over `rows` as the platform's door answers it: one group
 * per distinct value of every `groupBy` key (objectstack#37844 asks two).
 * `cut` answers the first two groups and `hasMore`, as the door cuts a grouped
 * read to its default page size.
 */
function groupHeadersOver(rows: Row[], cut = false) {
  const store = new ValueDataSource<Row>({ items: rows });
  return vi.fn(async (_object: string, query: any) => {
    const kept = extractRecords(
      await store.find(OBJECT, { ...(query.where ? { $filter: query.where } : {}), $top: 100000 } as any),
    ) as Row[];
    const keys: string[] = query.groupBy;
    const groups = new Map<string, { values: unknown[]; members: Row[] }>();
    for (const row of kept) {
      const values = keys.map((key) => row[key] ?? null);
      const id = JSON.stringify(values);
      const group = groups.get(id) ?? { values, members: [] };
      group.members.push(row);
      groups.set(id, group);
    }
    const answer: Row[] & { hasMore?: boolean } = [...groups.values()].map(({ values: k, members }) => {
      const out: Row = Object.fromEntries(keys.map((key, i) => [key, k[i]]));
      for (const agg of query.aggregations) {
        const values = members.map((m) => m[agg.field]) as number[];
        out[agg.alias] = agg.function === 'count'
          ? members.length
          : agg.function === 'min'
            ? Math.min(...values)
            : agg.function === 'max'
              ? Math.max(...values)
              : agg.function === 'avg'
                ? values.reduce((a, b) => a + b, 0) / values.length
                : values.reduce((a, b) => a + b, 0);
      }
      return out;
    });
    if (!cut) return answer;
    const partial: Row[] & { hasMore?: boolean } = answer.slice(0, 2);
    partial.hasMore = true;
    return partial;
  });
}

function adapter(rows: Row[], door: 'answers' | 'refuses' | 'cuts' | 'none' = 'answers') {
  const store = new ValueDataSource<Row>({ items: rows });
  return {
    find: vi.fn(async (object: string, params: any) => store.find(object, params)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEF),
    ...(door === 'none'
      ? {}
      : {
          queryGroupHeaders: door === 'refuses'
            ? vi.fn(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); })
            : groupHeadersOver(rows, door === 'cuts'),
        }),
  } as any;
}

const SWIMLANES = { swimlaneField: 'region' };

function mount(source: any, summary: unknown, handed?: { rows: Row[] }, extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={source}>
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary, ...SWIMLANES, ...extra } as any}
        dataSource={source}
        {...(handed ? { data: handed.rows, laneStatisticQuery: { search: '', reloadKey: '0' } } : {})}
      />
    </SchemaRendererProvider>,
  );
}

const footRow = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-kanban-swimlane-foot]');
/** The foot figure of each column, in column order: 「Sum · Amount」 → `190`. */
const footFigures = (container: HTMLElement) =>
  Array.from(footRow(container)?.children ?? []).map((cell) =>
    cell.querySelector('[data-kanban-lane-statistic]')?.lastElementChild?.textContent ?? null);
/** The column-title row's counts, in column order: `(20)`. */
const columnCounts = (container: HTMLElement) => {
  const titleRow = container.querySelector<HTMLElement>('[data-swimlane-scroll-row]')!;
  return Array.from(titleRow.children).map((cell) => /\((\d+\+?)\)/.exec(cell.textContent ?? '')?.[1] ?? null);
};
/** Each swimlane row's own count, in row order: `north (12)` → `12`. */
const swimlaneCounts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
    .map((button) => /\((\d+\+?)\)/.exec(button.textContent ?? '')?.[1] ?? null);

afterEach(() => cleanup());

describe('a swimlane board draws the view\'s lane statistic (objectstack#37326)', () => {
  it('(a) draws each column\'s whole sum once, under every swimlane, from the one grouped read', async () => {
    const source = adapter(ROWS);
    const { container } = mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(footFigures(container)).toEqual(['190', '6']));
    expect(footRow(container)!.textContent).toContain('Sum · Amount');
    // Two swimlanes, one foot row: no cell draws a figure of its own.
    expect(swimlaneCounts(container)).toEqual(['12', '12']);
    expect(container.querySelectorAll('[data-kanban-lane-statistic]')).toHaveLength(2);
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders.mock.calls[0][1]).toEqual({
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'sum_amount' }],
    });
  });

  it('(b) counts each column at the foot', async () => {
    const { container } = mount(adapter(ROWS), { type: 'count' });
    await waitFor(() => expect(footFigures(container)).toEqual(['20', '4']));
    expect(footRow(container)!.textContent).toContain('Count');
  });

  it('(c) on a page handed in with its query, a column counts the whole lane and a swimlane row its whole swimlane (objectstack#37844)', async () => {
    const source = adapter(ROWS);
    // The page: 3 open deals, 1 won; the query holds 20 and 4, 12 north and 12 south.
    const { container } = mount(source, { type: 'sum', field: 'amount' }, { rows: [...deals('open', 3), ...deals('won', 1)] });
    await waitFor(() => expect(columnCounts(container)).toEqual(['20', '4']));
    expect(footFigures(container)).toEqual(['190', '6']);
    // The page holds 3 north and 1 south; the swimlane read counts 12 and 12.
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['12', '12']));
    // The lane read, then ONE read on both keys, counting each group.
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(2);
    expect(source.queryGroupHeaders.mock.calls[1][1]).toEqual({
      groupBy: ['stage', 'region'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
    expect(source.find).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: handed every record of its query, every count is bare, and no swimlane read is asked', async () => {
    const source = adapter(ROWS);
    const { container } = mount(source, undefined, { rows: ROWS });
    await waitFor(() => expect(columnCounts(container)).toEqual(['20', '4']));
    expect(swimlaneCounts(container)).toEqual(['12', '12']);
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders.mock.calls[0][1].groupBy).toEqual(['stage']);
  });

  it('(e) a refused read marks the page\'s column counts `+`, and draws no figure', async () => {
    const source = adapter(ROWS, 'refuses');
    const { container } = mount(source, { type: 'sum', field: 'amount' }, { rows: [...deals('open', 3), ...deals('won', 1)] });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(columnCounts(container)).toEqual(['3+', '1+']));
    expect(swimlaneCounts(container)).toEqual(['3+', '1+']);
    expect(footFigures(container)).toEqual([null, null]);
  });

  it('(f) CONTROL: with no statistic the board draws no foot row, and a board holding every record asks no read', async () => {
    const source = adapter(ROWS);
    const { container } = mount(source, undefined);
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['12', '12']));
    expect(footRow(container)).toBeNull();
    expect(columnCounts(container)).toEqual(['20', '4']);
    expect(source.queryGroupHeaders).not.toHaveBeenCalled();
  });

  // 20 open deals (amounts 0 … 19), 4 won (0 … 3).
  it.each([
    ['avg', 'Avg', ['9.5', '1.5']],
    ['min', 'Min', ['0', '0']],
    ['max', 'Max', ['19', '3']],
  ])('(g) draws each column\'s whole %s at the foot, from the one grouped read', async (type, word, figures) => {
    const source = adapter(ROWS);
    const { container } = mount(source, { type, field: 'amount' });
    await waitFor(() => expect(footFigures(container)).toEqual(figures));
    expect(footRow(container)!.textContent).toContain(`${word} · Amount`);
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders.mock.calls[0][1].groupBy).toEqual(['stage']);
  });
});

/**
 * objectstack#37844 — a board drawn in swimlanes that queries its own cards
 * through a window (`limit` 10 over the query's 24 records: 10 open, all
 * north and south alternating, 5 + 5) reads every swimlane row's count and
 * every column's count whole from ONE grouped read on both keys.
 */
describe('a windowed swimlane board counts each whole swimlane and column from one two-key read (objectstack#37844)', () => {
  const WINDOW = { limit: 10 };

  it('a board that queries itself through a full window counts 12 and 12 swimlanes, 20 and 4 columns', async () => {
    const source = adapter(ROWS);
    const { container } = mount(source, undefined, undefined, WINDOW);
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['12', '12']));
    expect(columnCounts(container)).toEqual(['20', '4']);
    // The window: 10 cards, all open.
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(10);
    expect(source.find).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders.mock.calls[0][1]).toEqual({
      groupBy: ['stage', 'region'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
  });

  it('reads under the board\'s own filter', async () => {
    const source = adapter(ROWS);
    // amount >= 2: open 2 … 19 (18: 9 north, 9 south), won 2, 3 (north, south).
    const { container } = mount(source, undefined, undefined, { ...WINDOW, filter: [['amount', '>=', 2]] });
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['10', '10']));
    expect(columnCounts(container)).toEqual(['18', '2']);
    expect(source.queryGroupHeaders.mock.calls[0][1].where).toBeDefined();
  });

  it.each([
    ['has no grouped door', 'none'],
    ['refuses the read', 'refuses'],
    ['cuts the read (hasMore)', 'cuts'],
  ] as const)('CONTROL: when the source %s, the window\'s counts stay marked `+`', async (_, door) => {
    const source = adapter(ROWS, door);
    const { container } = mount(source, undefined, undefined, WINDOW);
    if (door !== 'none') await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['5+', '5+']));
    expect(columnCounts(container)).toEqual(['10+', '0+']);
  });

  it('CONTROL: a window the query does not fill asks no read and writes bare counts', async () => {
    const source = adapter(ROWS);
    const { container } = mount(source, undefined, undefined, { limit: 50 });
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['12', '12']));
    expect(columnCounts(container)).toEqual(['20', '4']);
    expect(source.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('CONTROL: a page handed in whose lane read is cut asks no swimlane read; its rows stay marked `+`', async () => {
    const source = adapter(ROWS, 'cuts');
    const { container } = mount(source, undefined, { rows: [...deals('open', 3), ...deals('won', 1)] });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(swimlaneCounts(container)).toEqual(['3+', '1+']));
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
  });
});

describe('a swimlane board handed one page draws no column past the page (objectstack#37718)', () => {
  const ACCOUNT_DEF = {
    ...DEF,
    fields: { ...DEF.fields, account: { type: 'lookup', reference: 'account', label: 'Account' } },
  };
  const ACCOUNTS = [
    { id: 'a1', name: 'Acme' },
    { id: 'a2', name: 'Globex' },
    { id: 'a3', name: 'Initech' },
  ];
  // The query: two deals at each account. The page: Acme's and Globex's only,
  // so Initech's lane exists past the page alone.
  const QUERY = ACCOUNTS.flatMap((account) => [0, 1].map((i) => ({
    id: `${account.id}-${i}`,
    name: `${account.name} ${i}`,
    stage: 'open',
    amount: i,
    region: i === 0 ? 'north' : 'south',
    account: account.id,
  })));
  const PAGE = QUERY.filter((row) => row.account !== 'a3');

  function accountSource() {
    const groupHeaders = groupHeadersOver(QUERY);
    return {
      find: vi.fn(async (object: string, params: any) =>
        new ValueDataSource<Row>({ items: object === 'account' ? ACCOUNTS : QUERY }).find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ACCOUNT_DEF),
      queryGroupHeaders: groupHeaders,
    } as any;
  }

  function mountPage(source: any, layout: Record<string, unknown>) {
    return render(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'account', cardFields: ['amount'], ...layout } as any}
          dataSource={source}
          data={PAGE}
          laneStatisticQuery={{ search: '', reloadKey: '0' }}
        />
      </SchemaRendererProvider>,
    );
  }

  it('in swimlanes: the columns are the page\'s two, and no title read is asked for a later lane', async () => {
    const source = accountSource();
    const { container } = mountPage(source, SWIMLANES);
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(columnCounts(container)).toEqual(['2', '2']));
    const titleRow = container.querySelector<HTMLElement>('[data-swimlane-scroll-row]')!;
    expect(titleRow.textContent).not.toContain('Initech');
    expect(titleRow.textContent).not.toContain('a3');
    expect(source.find).not.toHaveBeenCalledWith('account', expect.anything());
  });

  it('CONTROL: the flat board draws the lane past the page, titled by its account', async () => {
    const source = accountSource();
    const { container } = mountPage(source, {});
    await waitFor(() => expect(container.textContent).toContain('Initech'));
    expect(source.find).toHaveBeenCalledWith('account', expect.objectContaining({ $filter: { id: { $in: ['a3'] } } }));
  });
});

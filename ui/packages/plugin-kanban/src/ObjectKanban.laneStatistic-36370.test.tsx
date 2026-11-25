/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — the view's `kanban.summary` (a lane statistic at each
 * lane's foot) and the two card toggles, `showFieldLabels` and
 * `hideEmptyFields`, as `ListView` relays them onto the board node.
 *
 * Rows:
 *   (a) `{ type: 'count' }` draws each lane's count at its foot;
 *   (b) `{ type: 'sum', field }` draws the server lane read's total at the
 *       foot, in place of the header's `summarizeField` total; a type outside
 *       the spec's set draws no foot and keeps the `summarizeField` total;
 *   (c) `{ type: 'none' }` draws neither the foot nor the header total;
 *   (d) without the keys a card names its fields and leaves out an empty one;
 *       `showFieldLabels: false` draws the values alone; `hideEmptyFields:
 *       false` keeps the empty field's line.
 *
 * objectstack#36520 — the `sum`, `avg`, `min` and `max` figures are one
 * grouped aggregate over every record of each lane (`queryGroupHeaders`), never
 * a reduction of the loaded cards: see the second `describe`.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource, extractRecords } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from './ObjectKanban';
import { KANBAN_LANE_PAGE_SIZE } from './KanbanLanePaging';
import { readLaneFigures } from './KanbanLaneStatistic';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010).
import './KanbanImpl';

/** Stable stub identity — `ObjectKanban` carries `perms` in an effect dep list. */
const { permsStub, permsState } = vi.hoisted(() => {
  const permsState: { isLoaded: boolean; unreadable: string[] } = { isLoaded: false, unreadable: [] };
  return {
    permsState,
    permsStub: {
      get isLoaded() { return permsState.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? !permsState.unreadable.includes(field) : true,
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
    },
  };
});
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

const OBJECT_SCHEMA = {
  name: 'stat_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
    stage: {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
    },
  },
};

const ROWS = [
  { id: 'd1', name: 'Alpha', stage: 'open', amount: 10, region: 'North' },
  { id: 'd2', name: 'Beta', stage: 'open', amount: 30, region: null },
  { id: 'd3', name: 'Gamma', stage: 'won', amount: 5, region: 'South' },
];

type Row = Record<string, unknown>;

/**
 * A grouped aggregate over `rows` as the platform's door answers it: one row
 * per group key (`null` for no value), each aggregation under its alias, over
 * the rows `where` keeps (evaluated by `ValueDataSource`, as a backend would).
 */
function groupHeadersOver(rows: Row[], object: string) {
  const store = new ValueDataSource<Row>({ items: rows });
  return vi.fn(async (_object: string, query: any) => {
    const kept = extractRecords(
      await store.find(object, { ...(query.where ? { $filter: query.where } : {}), $top: 100000 } as any),
    ) as Row[];
    const key = query.groupBy[0];
    const groups = new Map<unknown, Row[]>();
    for (const row of kept) {
      const k = row[key] ?? null;
      groups.set(k, [...(groups.get(k) ?? []), row]);
    }
    return [...groups].map(([k, members]) => {
      const out: Row = { [key]: k };
      for (const agg of query.aggregations) {
        const values = members.map((m) => m[agg.field]).filter((v) => v !== null && v !== undefined && v !== '') as number[];
        out[agg.alias] =
          agg.function === 'count' ? values.length
          : values.length === 0 ? null
          : agg.function === 'sum' ? values.reduce((a, b) => a + b, 0)
          : agg.function === 'avg' ? values.reduce((a, b) => a + b, 0) / values.length
          : agg.function === 'min' ? Math.min(...values)
          : Math.max(...values);
      }
      return out;
    });
  });
}

async function renderBoard(extra: Record<string, unknown>) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    queryGroupHeaders: groupHeadersOver(ROWS, 'stat_deal'),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
  const result = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: 'stat_deal', groupBy: 'stage', cardFields: ['amount', 'region'], ...extra } as any}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Gamma'));
  return result;
}

const laneNamed = (container: HTMLElement, name: string): HTMLElement => {
  const lane = Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'))
    .find((l) => l.getAttribute('aria-label') === name);
  if (!lane) throw new Error(`no lane named ${name}`);
  return lane;
};
const footOf = (lane: HTMLElement) => lane.querySelector<HTMLElement>('[data-kanban-lane-statistic]');

afterEach(() => {
  cleanup();
  permsState.isLoaded = false;
  permsState.unreadable = [];
});

describe('the lane statistic and card toggles (objectstack#36370)', () => {
  it('(a) counts each lane at its foot', async () => {
    const { container } = await renderBoard({ summary: { type: 'count' } });
    await waitFor(() => expect(footOf(laneNamed(container, 'Open'))).not.toBeNull());
    expect(footOf(laneNamed(container, 'Open'))!.textContent).toBe('Count2');
    expect(footOf(laneNamed(container, 'Won'))!.textContent).toBe('Count1');
  });

  it('(b) draws the lane read\'s total at the foot, in place of the summarizeField header total; a type outside the set keeps the total', async () => {
    const { container } = await renderBoard({ summary: { type: 'sum', field: 'amount' }, summarizeField: 'amount' });
    await waitFor(() => expect(footOf(laneNamed(container, 'Open'))).not.toBeNull());
    expect(footOf(laneNamed(container, 'Open'))!.textContent).toBe('Sum · Amount40');
    expect(footOf(laneNamed(container, 'Won'))!.textContent).toBe('Sum · Amount5');
    expect(container.querySelector('[data-kanban-lane-total]')).toBeNull();
    cleanup();

    const median = await renderBoard({ summary: { type: 'median', field: 'amount' }, summarizeField: 'amount' });
    await waitFor(() => expect(median.container.querySelector('[data-kanban-lane-total]')).not.toBeNull());
    expect(median.container.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('(c) draws no statistic for none, also over a summarizeField', async () => {
    const { container } = await renderBoard({ summary: { type: 'none' }, summarizeField: 'amount' });
    expect(container.querySelector('[data-kanban-lane-statistic]')).toBeNull();
    expect(container.querySelector('[data-kanban-lane-total]')).toBeNull();
  });

  it('(d) names the card fields and leaves out an empty one by default; the toggles turn each off', async () => {
    const plain = await renderBoard({});
    expect(laneNamed(plain.container, 'Open').querySelectorAll('dt').length).toBeGreaterThan(0);
    expect(laneNamed(plain.container, 'Open').querySelector('[data-kanban-card-field-empty]')).toBeNull();
    cleanup();

    const noLabels = await renderBoard({ showFieldLabels: false });
    expect(noLabels.container.querySelectorAll('dt')).toHaveLength(0);
    expect(laneNamed(noLabels.container, 'Open').textContent).toContain('North');
    cleanup();

    const keepEmpty = await renderBoard({ hideEmptyFields: false });
    expect(laneNamed(keepEmpty.container, 'Open').querySelectorAll('[data-kanban-card-field-empty]')).toHaveLength(1);
  });
});

/**
 * objectstack#36520 — a lane's `sum`, `avg`, `min` and `max` are one grouped
 * aggregate over every record of the lane (`queryGroupHeaders`), with the
 * board's filter and search, never a reduction of the cards the lane loaded.
 *
 * The lanes page themselves (`lanePaging`, 50 records a lane), over a
 * `ValueDataSource` that evaluates `$filter`, `$top` and `$skip` the way a
 * backend does; the lane read is answered by `groupHeadersOver`, which groups
 * every row its `where` keeps.
 */
describe('a lane statistic covers every record of the lane (objectstack#36520)', () => {
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
          { value: 'lost', label: 'Lost' },
        ],
      },
    },
  };
  /** `n` deals in `stage` whose amounts are 0 … n-1. */
  const deals = (stage: string | null, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${stage ?? 'none'}-${String(i).padStart(3, '0')}`,
      name: `${stage ?? 'none'} ${String(i).padStart(3, '0')}`,
      stage,
      amount: i,
      region: i % 2 === 0 ? 'north' : 'south',
    }));
  // 70 open deals (more than a page), 5 won, none lost; 2 with no stage and 3
  // in a stage that is no lane, which the trailing lane holds.
  const ROWS_70 = [...deals('open', 70), ...deals('won', 5), ...deals(null, 2), ...deals('archived', 3)];

  function adapter(rows: Row[], withDoor = true) {
    const store = new ValueDataSource<Row>({ items: rows });
    return {
      find: vi.fn(async (object: string, params: any) => store.find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => DEF),
      ...(withDoor ? { queryGroupHeaders: groupHeadersOver(rows, OBJECT) } : {}),
    } as any;
  }

  function mount(source: any, summary: unknown, schema: Record<string, unknown> = {}, lanePaging: Record<string, unknown> | undefined = {}) {
    return render(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary, ...schema } as any}
          dataSource={source}
          {...(lanePaging ? { lanePaging } : {})}
        />
      </SchemaRendererProvider>,
    );
  }

  const lane = (title: string) => screen.getByRole('group', { name: title });
  const foot = (title: string) => lane(title).querySelector<HTMLElement>('[data-kanban-lane-statistic]');
  /** The figure a person reads at a lane's foot, thousands separators dropped. */
  const figure = (title: string) => (foot(title)?.lastElementChild?.textContent ?? '').replace(/,/g, '');

  it('draws the whole lane\'s sum on a lane longer than its page, from one grouped aggregate', async () => {
    const source = adapter(ROWS_70);
    mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    // 0 + 1 + … + 69, not the 0 + … + 49 the lane loaded.
    expect(figure('Open')).toBe('2415');
    expect(figure('Won')).toBe('10');
    // A lane with no record totals 0; the trailing lane folds the empty group
    // and the group that is no lane: (0 + 1) + (0 + 1 + 2).
    expect(figure('Lost')).toBe('0');
    expect(figure('Uncategorized')).toBe('4');
    expect(foot('Open')!.textContent).toContain('Sum · Amount');
    expect(foot('Open')!.textContent).not.toContain('loaded cards');
    // ONE read for every lane, grouped by the lane field.
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(source.queryGroupHeaders.mock.calls[0][0]).toBe(OBJECT);
    expect(source.queryGroupHeaders.mock.calls[0][1]).toEqual({
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'sum_amount' }],
    });
  });

  it.each([
    // avg: 34.5 over 0 … 69; the trailing lane weighs its two groups by their
    // filled counts, (0 + 1 + 0 + 1 + 2) / 5. An empty lane has no average.
    ['avg', 'Avg', '34.5', '2', '0.8', null],
    ['min', 'Min', '0', '0', '0', null],
    ['max', 'Max', '69', '4', '2', null],
  ])('draws the whole lane\'s %s from the same read', async (type, word, open, won, uncategorized, lost) => {
    const source = adapter(ROWS_70);
    mount(source, { type, field: 'amount' });
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    expect(foot('Open')!.textContent).toContain(`${word} · Amount`);
    expect(figure('Open')).toBe(open);
    expect(figure('Won')).toBe(won);
    expect(figure('Uncategorized')).toBe(uncategorized);
    if (lost === null) expect(foot('Lost')).toBeNull();
    const query = source.queryGroupHeaders.mock.calls[0][1];
    expect(query.groupBy).toEqual(['stage']);
    expect(query.aggregations[0]).toEqual({ function: type, field: 'amount', alias: `${type}_amount` });
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
  });

  it('asks the read under the board\'s filter and its host\'s search', async () => {
    const source = adapter(ROWS_70);
    mount(source, { type: 'sum', field: 'amount' }, { filter: [['region', '=', 'north']] }, { search: 'open', searchFields: ['name'] });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalled());
    const query = source.queryGroupHeaders.mock.calls[0][1];
    expect(query.where).toEqual({ region: 'north' });
    expect(query.search).toBe('open');
    expect(query.searchFields).toEqual(['name']);
  });

  it('draws the read\'s figure on a board of one query, past its row cap', async () => {
    const source = adapter(ROWS_70);
    mount(source, { type: 'sum', field: 'amount' }, { limit: 10 }, undefined);
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    expect(figure('Open')).toBe('2415');
    expect(foot('Open')!.textContent).not.toContain('loaded cards');
  });

  it('draws no figure for a field the reader may not read, and asks nothing', async () => {
    permsState.isLoaded = true;
    permsState.unreadable = ['amount'];
    const source = adapter(ROWS_70);
    mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    expect(document.querySelector('[data-kanban-lane-statistic]')).toBeNull();
    expect(source.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('draws no figure when the server refuses the read (a field it will not aggregate for this reader)', async () => {
    const source = adapter(ROWS_70);
    source.queryGroupHeaders.mockRejectedValue(Object.assign(new Error('Field read denied'), { status: 403, code: 'PERMISSION_DENIED' }));
    mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalled());
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    expect(document.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('draws no figure on a lane that holds records when the read answered no group for it (a cut answer), and 0 on an empty lane', async () => {
    const source = adapter(ROWS_70);
    // The door sliced the group rows under a default page size: the won group
    // was dropped, and `hasMore` does not reach the board.
    const whole = source.queryGroupHeaders;
    source.queryGroupHeaders = vi.fn(async (object: string, query: any) =>
      ((await whole(object, query)) as Row[]).filter((row) => row.stage !== 'won'));
    mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    await waitFor(() => expect(within(lane('Won')).queryAllByRole('listitem')).toHaveLength(5));
    expect(figure('Open')).toBe('2415');
    // Won holds five records: no "Sum 0" in place of the dropped group.
    expect(foot('Won')).toBeNull();
    // Lost holds none: its sum is 0.
    expect(figure('Lost')).toBe('0');
  });

  it('adds up no loaded cards over a source with no lane read', async () => {
    const source = adapter(ROWS_70, false);
    mount(source, { type: 'sum', field: 'amount' });
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    expect(document.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('adds the cards a host hands in for a sum, and draws no average over them', async () => {
    const source = adapter(ROWS_70);
    const handed = deals('open', 3);
    const { rerender } = render(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary: { type: 'sum', field: 'amount' } } as any}
          dataSource={source}
          data={handed}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    expect(figure('Open')).toBe('3');
    rerender(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary: { type: 'avg', field: 'amount' } } as any}
          dataSource={source}
          data={handed}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(foot('Open')).toBeNull());
    expect(source.queryGroupHeaders).not.toHaveBeenCalled();
  });

  /**
   * objectstack#36871 — a host that hands the board one page of cards AND the
   * query they came from (`laneStatisticQuery`; `ListView` for lanes it does
   * not know before the query) gets the whole lane's figures, never the
   * page's. The CONTROL is the test above: cards handed without their query.
   */
  function mountHanded(source: any, summary: unknown, handed: Row[], request: Record<string, unknown>, schema: Record<string, unknown> = {}) {
    const node = (req: Record<string, unknown>) => (
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary, ...schema } as any}
          dataSource={source}
          data={handed}
          laneStatisticQuery={req}
        />
      </SchemaRendererProvider>
    );
    const result = render(node(request));
    return { ...result, rerenderWith: (req: Record<string, unknown>) => result.rerender(node(req)) };
  }

  it.each([
    // The page handed in is 3 open deals (0 + 1 + 2); the lane holds 70.
    ['sum', 'Sum', '2415'],
    ['avg', 'Avg', '34.5'],
    ['min', 'Min', '0'],
    ['max', 'Max', '69'],
  ])('draws the whole lane\'s %s over a page handed in with its query (objectstack#36871)', async (type, word, open) => {
    const source = adapter(ROWS_70);
    mountHanded(source, { type, field: 'amount' }, deals('open', 3), { search: '', reloadKey: '0' });
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(3);
    expect(foot('Open')!.textContent).toContain(`${word} · Amount`);
    expect(figure('Open')).toBe(open);
    expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1);
    // The board reads nothing for its cards: the host handed them.
    expect(source.find).not.toHaveBeenCalled();
  });

  it('asks that read under the node\'s filter and the host\'s search, and again when the host refetches (objectstack#36871)', async () => {
    const source = adapter(ROWS_70);
    const { rerenderWith } = mountHanded(
      source,
      { type: 'sum', field: 'amount' },
      deals('open', 3),
      { search: 'open', searchFields: ['name'], reloadKey: '0' },
      { filter: [['region', '=', 'north']] },
    );
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    const query = source.queryGroupHeaders.mock.calls[0][1];
    expect(query.where).toEqual({ region: 'north' });
    expect(query.search).toBe('open');
    expect(query.searchFields).toEqual(['name']);
    rerenderWith({ search: 'open', searchFields: ['name'], reloadKey: '1' });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(2));
  });
});

/**
 * objectstack#36870 — a lane read the door CUT draws no figure for any lane.
 *
 * Under a deployment's default page size the door slices the grouped answer
 * and says so (`hasMore`), which `queryGroupHeaders` hands on as the answer's
 * `hasMore`. `cappedAt` answers the lane read the way that door does: every
 * group `groupHeadersOver` finds, cut to `pageSize` rows. The groups of
 * `ROWS_70` are open, won, the empty group and `archived`, in that order.
 */
describe('a cut lane read draws no lane figure (objectstack#36870)', () => {
  const OBJECT = 'deal';
  const DEF = {
    name: OBJECT,
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'number', label: 'Amount' },
      stage: {
        type: 'select',
        label: 'Stage',
        options: [
          { value: 'open', label: 'Open' },
          { value: 'won', label: 'Won' },
          { value: 'lost', label: 'Lost' },
        ],
      },
    },
  };
  const deals = (stage: string | null, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${stage ?? 'none'}-${String(i).padStart(3, '0')}`,
      name: `${stage ?? 'none'} ${String(i).padStart(3, '0')}`,
      stage,
      amount: i,
    }));
  const ROWS_70 = [...deals('open', 70), ...deals('won', 5), ...deals(null, 2), ...deals('archived', 3)];

  function cappedAt(rows: Row[], pageSize: number) {
    const whole = groupHeadersOver(rows, OBJECT);
    return vi.fn(async (object: string, query: any) => {
      const groups = (await whole(object, query)) as Row[];
      const answer = groups.slice(0, pageSize) as Row[] & { hasMore?: boolean };
      if (answer.length < groups.length) answer.hasMore = true;
      return answer;
    });
  }

  function mount(pageSize: number, lanePaging: Record<string, unknown> | undefined, schema: Record<string, unknown> = {}) {
    const store = new ValueDataSource<Row>({ items: ROWS_70 });
    const source = {
      find: vi.fn(async (object: string, params: any) => store.find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => DEF),
      queryGroupHeaders: cappedAt(ROWS_70, pageSize),
    } as any;
    render(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'stage', cardFields: ['amount'], summary: { type: 'sum', field: 'amount' }, ...schema } as any}
          dataSource={source}
          {...(lanePaging ? { lanePaging } : {})}
        />
      </SchemaRendererProvider>,
    );
    return source;
  }

  const lane = (title: string) => screen.getByRole('group', { name: title });
  const foot = (title: string) => lane(title).querySelector<HTMLElement>('[data-kanban-lane-statistic]');
  const figure = (title: string) => (foot(title)?.lastElementChild?.textContent ?? '').replace(/,/g, '');

  it('draws no figure on any lane when the read is cut, the folded lane included', async () => {
    // Three of four groups: open, won and the empty group. The trailing lane
    // would total the empty group alone (1) in place of 4.
    const source = mount(3, {});
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    await waitFor(() => expect(within(lane('Uncategorized')).queryAllByRole('listitem')).toHaveLength(5));
    expect((await source.queryGroupHeaders.mock.results[0].value).hasMore).toBe(true);
    expect(document.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('draws no "Sum 0" on a board of one query whose lane group the read cut', async () => {
    // One group: open. The board loads 10 open cards, so Won counts none of
    // its five records and would read the dropped group as an empty lane.
    const source = mount(1, undefined, { limit: 10 });
    await waitFor(() => expect(source.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(lane('Open')).queryAllByRole('listitem')).toHaveLength(10));
    expect((await source.queryGroupHeaders.mock.results[0].value).hasMore).toBe(true);
    expect(document.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('CONTROL: a whole answer under the same door draws every lane\'s figure', async () => {
    const source = mount(4, {});
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    expect((await source.queryGroupHeaders.mock.results[0].value).hasMore).toBeUndefined();
    expect(figure('Open')).toBe('2415');
    expect(figure('Won')).toBe('10');
    expect(figure('Lost')).toBe('0');
    expect(figure('Uncategorized')).toBe('4');
  });
});

describe('readLaneFigures (objectstack#36520)', () => {
  const base = { laneField: 'stage', field: 'amount', uncolumnedId: '__uncolumned__' } as const;
  it('keys a reference lane by its foreign key and folds what is no lane into the trailing lane', () => {
    const figures = readLaneFigures(
      [
        { stage: 'u1', sum_amount: 5 },
        { stage: 'u2', sum_amount: '7.5' },
        { stage: null, sum_amount: 1 },
        { stage: 'gone', sum_amount: 2 },
      ],
      { ...base, type: 'sum', laneIds: ['u1', 'u2'], foldCase: false },
    );
    expect({ ...figures }).toEqual({ u1: 5, u2: 7.5, __uncolumned__: 3 });
  });
  it('matches without case on a board of one query, and every key is a lane when the lanes come from the data', () => {
    expect({ ...readLaneFigures([{ stage: 'OPEN', max_amount: 3 }], { ...base, type: 'max', laneIds: ['open'], foldCase: true }) })
      .toEqual({ open: 3 });
    expect({ ...readLaneFigures([{ stage: 'x', min_amount: 1 }, { stage: '', min_amount: 4 }], { ...base, type: 'min', laneIds: null, foldCase: false }) })
      .toEqual({ x: 1, __uncolumned__: 4 });
  });
  it('answers no figure for a value that is not a number', () => {
    expect(readLaneFigures([{ stage: 'a', sum_amount: 'x' }], { ...base, type: 'sum', laneIds: ['a'], foldCase: false }).a).toBeNull();
  });
});

/**
 * objectstack#36880 — a `min` / `max` over a date is the latest (earliest)
 * stored day the lane read answers, drawn at the foot through the date
 * field's own cell renderer: the face its `format` declares, exactly as a
 * card draws the same day, never the raw stored text.
 */
describe('a date lane statistic draws in the field\'s date format (objectstack#36880)', () => {
  const OBJECT = 'dated_deal';
  const DEF = {
    name: OBJECT,
    fields: {
      name: { type: 'text', label: 'Name' },
      close_date: { type: 'date', label: 'Close date', format: 'short' },
      stage: {
        type: 'select',
        label: 'Stage',
        options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
      },
    },
  };
  const DATED_ROWS: Row[] = [
    { id: 'a', name: 'Alpha', stage: 'open', close_date: '2025-01-10' },
    { id: 'b', name: 'Beta', stage: 'open', close_date: '2025-03-15' },
    { id: 'c', name: 'Gamma', stage: 'won', close_date: '2024-12-01' },
  ];

  it('draws a lane\'s latest close date as its card draws that day', async () => {
    const store = new ValueDataSource<Row>({ items: DATED_ROWS });
    // The door answers a date's `max` as the stored day (ISO order), as the
    // platform's aggregate does.
    const queryGroupHeaders = vi.fn(async (_object: string, _query: unknown) => [
      { stage: 'open', max_close_date: '2025-03-15' },
      { stage: 'won', max_close_date: '2024-12-01' },
    ]);
    const source = {
      find: vi.fn(async (object: string, params: any) => store.find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => DEF),
      queryGroupHeaders,
    } as any;
    render(
      <SchemaRendererProvider dataSource={source}>
        <ObjectKanban
          schema={{
            type: 'object-kanban',
            objectName: OBJECT,
            groupBy: 'stage',
            cardFields: ['close_date'],
            summary: { type: 'max', field: 'close_date' },
          } as any}
          dataSource={source}
          lanePaging={{}}
        />
      </SchemaRendererProvider>,
    );
    const lane = (title: string) => screen.getByRole('group', { name: title });
    const foot = (title: string) => lane(title).querySelector<HTMLElement>('[data-kanban-lane-statistic]');
    await waitFor(() => expect(foot('Open')).not.toBeNull());
    await waitFor(() => expect(within(lane('Open')).getByText('Beta')).toBeTruthy());

    expect(queryGroupHeaders.mock.calls[0][1]).toMatchObject({
      groupBy: ['stage'],
      aggregations: [{ function: 'max', field: 'close_date', alias: 'max_close_date' }],
    });
    const figure = foot('Open')!.lastElementChild!.textContent;
    expect(foot('Open')!.textContent).toContain('Max · Close date');
    // The declared `short` face, the year written as `'25` — not the stored text.
    expect(figure).toContain('\'25');
    expect(figure).not.toContain('2025-03-15');
    // The same day on Beta's card, through the same renderer.
    const betaCard = within(lane('Open')).getAllByRole('listitem').find((card) => card.textContent?.includes('Beta'))!;
    expect(betaCard.textContent).toContain(figure!);
    expect(foot('Won')!.lastElementChild!.textContent).toContain('\'24');
  });
});

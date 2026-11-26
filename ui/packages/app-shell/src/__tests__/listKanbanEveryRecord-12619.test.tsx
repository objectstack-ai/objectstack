/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12619 — a kanban under a list view puts every record of the view
 * in its column, not the grid's first page, and its cards carry the view's
 * first columns.
 *
 * Walked on HotCRM's 45 opportunities: the board drew 25 cards (the grid's
 * "Rows per page" 25), the closed columns read 0, the footer read "Showing
 * first 25 records. More data may be available.", and each card showed only
 * the record's name although the view's columns are Opportunity Name, Account,
 * Stage, Amount, Probability, Expected Revenue, Close Date.
 *
 * ## Why this file lives in `app-shell`
 *
 * The two halves sit in two packages — `ListView` in `plugin-list`, which now
 * hands the board the view's query instead of its page, and `ObjectKanban` in
 * `plugin-kanban`, which pages each column itself — and neither depends on the
 * other. `app-shell` depends on both, so the REAL board is mounted under the
 * REAL list here with no new dependency edge (the reason
 * `listCalendarDateWindow-12081.test.tsx` lives here too). Each half's own pin
 * sits in its package: `ListView.kanbanOwnsLanes-12619.test.tsx` and
 * `ObjectKanban.lanePaging-12619.test.tsx`.
 *
 * The records live in a `ValueDataSource`, which evaluates `$filter`, `$skip`,
 * `$top` and `$orderby` the way a backend does and answers `total`. The 25 open
 * opportunities are listed ahead of the 20 closed ones, which is what a first
 * page of the object reaches first.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource } from '@object-ui/core';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
// Registers the real `object-kanban` renderer, the one `ListView` mounts, and
// loads the board's lazy chunk at module scope (AGENTS.md, test discipline).
import '@object-ui/plugin-kanban';
import '../../../plugin-kanban/src/KanbanImpl';

type Row = Record<string, unknown>;

const OBJECT = 'crm_opportunity';

const STAGES = [
  ['prospecting', 'Prospecting', 3],
  ['qualification', 'Qualification', 5],
  ['needs_analysis', 'Needs Analysis', 7],
  ['proposal', 'Proposal', 7],
  ['negotiation', 'Negotiation', 6],
  ['closed_won', 'Closed Won', 10],
  ['closed_lost', 'Closed Lost', 7],
] as const;

const OBJECT_DEF = {
  name: OBJECT,
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Opportunity Name' },
    account: { type: 'text', label: 'Account' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: STAGES.map(([value, label]) => ({ value, label })),
    },
    amount: { type: 'number', label: 'Amount' },
    probability: { type: 'number', label: 'Probability' },
    close_date: { type: 'date', label: 'Close Date' },
  },
};

/** 45 opportunities, every open stage listed ahead of the closed ones. */
const ROWS: Row[] = STAGES.flatMap(([stage, , count]) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${stage}-${i}`,
    name: `${stage} deal ${i}`,
    account: `Account ${stage} ${i}`,
    stage,
    amount: 1000 + i,
    probability: 40,
    close_date: '2026-11-01',
  })),
);

function makeDataSource() {
  const store = new ValueDataSource<Row>({ items: ROWS });
  return {
    find: vi.fn(async (object: string, params: any) => store.find(object, params)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  } as any;
}

/** The view the walk opened: the grid's columns and page size, laid out as a board. */
const VIEW = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'kanban',
  columns: [
    { field: 'name' },
    { field: 'account' },
    { field: 'stage' },
    { field: 'amount' },
    { field: 'probability' },
    { field: 'close_date' },
  ],
  pagination: { pageSize: 25 },
  // What the console's object page hands the list for a view with no kanban
  // block of its own (`kanbanViewOptions` in `ObjectView.tsx`), at the top
  // level since objectstack#25923 retired the `options` bag.
  kanban: { groupByField: 'stage', titleField: 'name' },
};

function mountBoard(ds: any, view: Record<string, unknown> = VIEW) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ActionProvider>
        <ListView schema={view as any} dataSource={ds} />
      </ActionProvider>
    </SchemaRendererProvider>,
  );
}

/** Every card the board drew, across all lanes. */
const cards = () => screen.queryAllByRole('listitem');

/** The lane group named `title`. */
const lane = (title: string) => screen.getByRole('group', { name: title });

afterEach(cleanup);

describe('a kanban under a list view draws every record of the view in its column (objectui#12619)', () => {
  it('45 records with a page size of 25 draw 45 cards, each lane counting its own records', async () => {
    mountBoard(makeDataSource());

    await waitFor(() => expect(cards()).toHaveLength(45));
    for (const [, title, count] of STAGES) {
      expect(within(lane(title)).getAllByRole('listitem')).toHaveLength(count);
    }
    // The closed columns are not empty: the first page never reached them.
    expect(within(lane('Closed Won')).getByText('closed_won deal 0')).toBeInTheDocument();
    // The board is not a window, so the list does not say it is one.
    expect(screen.queryByTestId('data-limit-warning')).not.toBeInTheDocument();
  });

  it('a card carries the view\'s next two non-stage columns as label and value, and no more', async () => {
    mountBoard(makeDataSource());

    await waitFor(() => expect(cards()).toHaveLength(45));
    const card = screen.getByRole('listitem', { name: 'proposal deal 2' });
    expect(within(card).getByText('Account')).toBeInTheDocument();
    expect(within(card).getByText('Account proposal 2')).toBeInTheDocument();
    expect(within(card).getByText('Amount')).toBeInTheDocument();
    // The third non-stage column is not a card line.
    expect(within(card).queryByText('Probability')).not.toBeInTheDocument();
    expect(within(card).queryByText('Close Date')).not.toBeInTheDocument();
  });
});

/**
 * objectstack#30431 — under a list view the footer and the lanes answer from
 * different queries: the list asks its own window and count, the board asks one
 * query per lane. Walked on cloud's two-plane stack with the card's 客服工单
 * package (12 tickets, 2 / 4 / 2 / 3 / 1), a board opened right after publish
 * read footer 「12 条记录」 over lanes 0 / 0 / 0 / 0 while its lane queries were
 * in flight. Here the lane queries are held open and the list's are not, which
 * is that ordering.
 */
describe('the board under a list view claims no lane count before its lanes answer (objectstack#30431)', () => {
  const TICKET = 'helpdesk_ticket';
  const STATUSES = [
    ['new', '待处理', 2],
    ['in_progress', '处理中', 4],
    ['waiting_customer', '等待客户', 2],
    ['resolved', '已解决', 3],
    ['closed', '已关闭', 1],
  ] as const;
  const TICKETS: Row[] = STATUSES.flatMap(([status, , count]) =>
    Array.from({ length: count }, (_, i) => ({ id: `${status}-${i}`, subject: `${status} ticket ${i}`, status })),
  );
  const TICKET_DEF = {
    name: TICKET,
    label: '工单',
    fields: {
      subject: { type: 'text', label: '标题' },
      status: { type: 'select', label: '状态', options: STATUSES.map(([value, label]) => ({ value, label })) },
    },
  };
  const BOARD_VIEW = {
    type: 'list-view',
    objectName: TICKET,
    viewType: 'kanban',
    columns: [{ field: 'subject' }, { field: 'status' }],
    kanban: { groupByField: 'status', titleField: 'subject' },
  };

  /** A lane query is the one that filters on the lane field; the list's never does. */
  const isLaneQuery = (params: any) => JSON.stringify(params?.$filter ?? null).includes('"status"');

  function heldLanes() {
    const store = new ValueDataSource<Row>({ items: TICKETS });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ds = {
      find: vi.fn(async (object: string, params: any) => {
        if (isLaneQuery(params)) await gate;
        return store.find(object, params);
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => TICKET_DEF),
    } as any;
    return { ds, release: () => act(async () => release()) };
  }

  /** The count badge beside a lane title. */
  const laneBadge = (title: string) => within(lane(title)).getByRole('heading').parentElement!.querySelector('span')!;

  it('the footer may read 12 while the lanes wait, but no lane reads 0 until it has answered', async () => {
    const { ds, release } = heldLanes();
    mountBoard(ds, BOARD_VIEW);

    // RIG SELF-CHECK — the state the card reported: the list's count is on
    // screen and every lane query has left without an answer.
    await waitFor(() => expect(screen.getByTestId('record-count-bar')).toHaveTextContent('12 records'));
    await waitFor(() => expect(ds.find.mock.calls.filter((call: any[]) => isLaneQuery(call[1]))).toHaveLength(STATUSES.length + 1));
    expect(cards()).toHaveLength(0);

    for (const [, title] of STATUSES) {
      // RED before the fix: '0' on every lane, under a footer reading 12.
      expect(laneBadge(title).textContent?.trim()).toBe('');
      expect(lane(title)).toHaveAttribute('aria-busy', 'true');
    }

    await release();

    await waitFor(() => expect(cards()).toHaveLength(12));
    for (const [, title, count] of STATUSES) {
      expect(laneBadge(title).textContent?.trim()).toBe(String(count));
      expect(lane(title)).not.toHaveAttribute('aria-busy');
    }
    expect(screen.getByTestId('record-count-bar')).toHaveTextContent('12 records');
  });
});

/**
 * objectstack#36871 — a board whose lanes this view does not know before the
 * query (a lookup lane field: no options) is handed this view's window, one
 * page of rows, and draws a lane per value in it. Its lane statistic
 * (`kanban.summary`) used to add up that page under the name of the lane's
 * total — 「Sum · Amount 156」 for a lane whose 30 records total 870 — and drew
 * no `avg`, `min` or `max` at all although the view-settings picker offers
 * them. The view now hands the board the query of its window beside the rows
 * (`laneStatisticQuery`, and the effective filter on the node), and the board
 * asks ONE grouped aggregate over every record of each lane, as a board that
 * pages its own lanes does.
 *
 * 60 deals over two accounts, alternating, so the view's first page of 25
 * holds 13 of `acc-a` (amounts 0, 2, … 24) and 12 of `acc-b` (1, 3, … 23).
 */
describe('a lookup-laned board under a list view draws each lane\'s whole statistic, not its page\'s (objectstack#36871)', () => {
  const DEAL = 'crm_deal';
  const ACCOUNT = 'crm_account';
  const DEALS: Row[] = Array.from({ length: 60 }, (_, i) => ({
    id: `deal-${String(i).padStart(2, '0')}`,
    name: `Deal ${String(i).padStart(2, '0')}`,
    account: i % 2 === 0 ? 'acc-a' : 'acc-b',
    amount: i,
  }));
  const DEFS: Record<string, unknown> = {
    [DEAL]: {
      name: DEAL,
      label: 'Deal',
      fields: {
        name: { type: 'text', label: 'Deal Name' },
        account: { type: 'lookup', label: 'Account', reference: ACCOUNT },
        amount: { type: 'number', label: 'Amount' },
      },
    },
    [ACCOUNT]: { name: ACCOUNT, label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
  };
  const BOARD_VIEW = {
    type: 'list-view',
    objectName: DEAL,
    viewType: 'kanban',
    columns: [{ field: 'name' }, { field: 'account' }, { field: 'amount' }],
    pagination: { pageSize: 25 },
    kanban: { groupByField: 'account', titleField: 'name' },
  };

  /** The platform's grouped-aggregate door over `DEALS`, `where` evaluated as a backend would. */
  function dealSource(withDoor = true) {
    const store = new ValueDataSource<Row>({ items: DEALS });
    const queryGroupHeaders = vi.fn(async (object: string, query: any) => {
      const kept = (await store.find(object, { ...(query.where ? { $filter: query.where } : {}), $top: 100000 } as any)) as any;
      const rows: Row[] = Array.isArray(kept) ? kept : kept.data ?? kept.records ?? [];
      const key = query.groupBy[0];
      const groups = new Map<unknown, Row[]>();
      for (const row of rows) groups.set(row[key] ?? null, [...(groups.get(row[key] ?? null) ?? []), row]);
      return [...groups].map(([k, members]) => {
        const out: Row = { [key]: k };
        for (const agg of query.aggregations) {
          const values = members.map((m) => m[agg.field]).filter((v) => typeof v === 'number') as number[];
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
    return {
      find: vi.fn(async (object: string, params: any) => store.find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async (object: string) => DEFS[object]),
      ...(withDoor ? { queryGroupHeaders } : {}),
    } as any;
  }

  const foot = (title: string) => lane(title).querySelector<HTMLElement>('[data-kanban-lane-statistic]');
  /** The figure a person reads at a lane's foot, thousands separators dropped. */
  const figure = (title: string) => (foot(title)?.lastElementChild?.textContent ?? '').replace(/,/g, '');

  it.each([
    // sum: 0 + 2 + … + 58 = 870 and 1 + 3 + … + 59 = 900, never the page's 156 / 144.
    ['sum', 'Sum', '870', '900'],
    ['avg', 'Avg', '29', '30'],
    ['min', 'Min', '0', '1'],
    // max: 58 / 59, never the page's 24 / 23.
    ['max', 'Max', '58', '59'],
  ])('%s covers every record of each lane over a window of one page', async (type, word, a, b) => {
    const ds = dealSource();
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summary: { type, field: 'amount' } } });

    // RIG SELF-CHECK — the board drew the view's window, one page of 25 cards
    // over two lanes from the data, not every record.
    await waitFor(() => expect(cards()).toHaveLength(25));
    expect(within(lane('acc-a')).getAllByRole('listitem')).toHaveLength(13);
    expect(within(lane('acc-b')).getAllByRole('listitem')).toHaveLength(12);

    await waitFor(() => expect(foot('acc-a')).not.toBeNull());
    expect(foot('acc-a')!.textContent).toContain(`${word} · Amount`);
    expect(figure('acc-a')).toBe(a);
    expect(figure('acc-b')).toBe(b);
    // ONE grouped read, by the lane field.
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(ds.queryGroupHeaders.mock.calls[0][1].groupBy).toEqual(['account']);
  });

  it('asks the read under the view\'s filter, the one its own window was fetched with', async () => {
    const ds = dealSource();
    mountBoard(ds, {
      ...BOARD_VIEW,
      filter: [{ field: 'amount', operator: 'greater_than', value: 9 }],
      kanban: { ...BOARD_VIEW.kanban, summary: { type: 'sum', field: 'amount' } },
    });

    await waitFor(() => expect(foot('acc-a')).not.toBeNull());
    // 10 + 12 + … + 58 = 850 and 11 + 13 + … + 59 = 875.
    expect(figure('acc-a')).toBe('850');
    expect(figure('acc-b')).toBe('875');
  });

  it('CONTROL: over a source with no grouped door it draws no figure, never the page\'s sum', async () => {
    const ds = dealSource(false);
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summary: { type: 'sum', field: 'amount' } } });

    await waitFor(() => expect(cards()).toHaveLength(25));
    expect(foot('acc-a')).toBeNull();
    expect(foot('acc-b')).toBeNull();
  });
});

/**
 * objectstack#37327 — the same lookup-laned board, handed one page of 25 of 70
 * deals, wrote every other lane figure off that page: its header count and a
 * foot `count` read 13 and 12 for lanes of 30 and 30, the `summarizeField`
 * header total summed the page, and the 10 deals of a third account, all past
 * the page, drew no lane. The grouped lane read now asks each lane's record
 * count and the header total's `SUM` beside the statistic, and its group keys
 * name every lane. Over a source with no grouped door the page's figures are
 * marked `+` and no lane past the page is drawn.
 *
 * Deals 0–59 alternate over `acc-a` (even amounts 0…58) and `acc-b` (odd,
 * 1…59); deals 60–69 are `acc-c`'s (60…69), all past the first page.
 */
describe('a lookup-laned board under a list view counts and totals each whole lane, and draws a lane past the page (objectstack#37327)', () => {
  const DEAL = 'crm_deal';
  const ACCOUNT = 'crm_account';
  const DEALS: Row[] = Array.from({ length: 70 }, (_, i) => ({
    id: `deal-${String(i).padStart(2, '0')}`,
    name: `Deal ${String(i).padStart(2, '0')}`,
    account: i >= 60 ? 'acc-c' : i % 2 === 0 ? 'acc-a' : 'acc-b',
    // The same split on a text field, for a board laned by a field that is no reference.
    tier: i >= 60 ? 'bronze' : i % 2 === 0 ? 'gold' : 'silver',
    amount: i,
  }));
  const ACCOUNTS: Row[] = [
    { id: 'acc-a', name: 'Amber Ltd' },
    { id: 'acc-b', name: 'Birch Inc' },
    { id: 'acc-c', name: 'Cyan Corp' },
  ];
  const DEFS: Record<string, unknown> = {
    [DEAL]: {
      name: DEAL,
      label: 'Deal',
      fields: {
        name: { type: 'text', label: 'Deal Name' },
        account: { type: 'lookup', label: 'Account', reference: ACCOUNT },
        tier: { type: 'text', label: 'Tier' },
        amount: { type: 'number', label: 'Amount' },
      },
    },
    [ACCOUNT]: { name: ACCOUNT, label: 'Account', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } },
  };
  const BOARD_VIEW = {
    type: 'list-view',
    objectName: DEAL,
    viewType: 'kanban',
    columns: [{ field: 'name' }, { field: 'account' }, { field: 'amount' }],
    pagination: { pageSize: 25 },
    kanban: { groupByField: 'account', titleField: 'name' },
  };

  /**
   * The platform's grouped-aggregate door: `COUNT(*)` counts rows, the rest
   * read `field`. `door`: `true` answers whole, `false` is no door, `'refuse'`
   * refuses the read (a `403`), `'cut'` answers two groups and `hasMore`, as
   * the door cuts a grouped read to its default page size.
   */
  function dealSource(door: boolean | 'refuse' | 'cut' = true, rows: Row[] = DEALS) {
    const withDoor = door !== false;
    const stores: Record<string, ValueDataSource<Row>> = {
      [DEAL]: new ValueDataSource<Row>({ items: rows }),
      [ACCOUNT]: new ValueDataSource<Row>({ items: ACCOUNTS }),
    };
    const queryGroupHeaders = vi.fn(async (object: string, query: any) => {
      if (door === 'refuse') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const kept = (await stores[object].find(object, { ...(query.where ? { $filter: query.where } : {}), $top: 100000 } as any)) as any;
      const rows: Row[] = Array.isArray(kept) ? kept : kept.data ?? kept.records ?? [];
      const key = query.groupBy[0];
      const groups = new Map<unknown, Row[]>();
      for (const row of rows) groups.set(row[key] ?? null, [...(groups.get(row[key] ?? null) ?? []), row]);
      const answer: Row[] & { hasMore?: boolean } = [...groups].map(([k, members]) => {
        const out: Row = { [key]: k };
        for (const agg of query.aggregations) {
          if (agg.function === 'count' && !agg.field) {
            out[agg.alias] = members.length;
            continue;
          }
          const values = members.map((m) => m[agg.field]).filter((v) => typeof v === 'number') as number[];
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
      if (door !== 'cut') return answer;
      const cut: Row[] & { hasMore?: boolean } = answer.slice(0, 2);
      cut.hasMore = true;
      return cut;
    });
    return {
      find: vi.fn(async (object: string, params: any) => stores[object].find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async (object: string) => DEFS[object]),
      ...(withDoor ? { queryGroupHeaders } : {}),
    } as any;
  }

  /** The count badge beside a lane title, as a person reads it. */
  const laneBadge = (title: string) =>
    (within(lane(title)).getByRole('heading').parentElement!.querySelector('span')!.textContent ?? '').trim();
  /** The `summarizeField` total in a lane header, thousands separators dropped. */
  const headerTotal = (title: string) =>
    (lane(title).querySelector('[data-kanban-lane-total]')?.textContent ?? '').replace(/,/g, '').replace('Amount', '').trim();
  const foot = (title: string) => lane(title).querySelector<HTMLElement>('[data-kanban-lane-statistic]');
  const footFigure = (title: string) => (foot(title)?.lastElementChild?.textContent ?? '').replace(/,/g, '');

  /** RIG SELF-CHECK — the board drew the view's first page: 13 + 12 cards, no `acc-c` card. */
  async function onePageDrawn() {
    await waitFor(() => expect(cards()).toHaveLength(25));
    expect(within(lane('acc-a')).getAllByRole('listitem')).toHaveLength(13);
    expect(within(lane('acc-b')).getAllByRole('listitem')).toHaveLength(12);
  }

  it('each lane header counts the whole lane, 30 and 30, never the page\'s 13 and 12', async () => {
    const ds = dealSource();
    mountBoard(ds, BOARD_VIEW);

    await onePageDrawn();
    await waitFor(() => expect(laneBadge('acc-a')).toBe('30'));
    expect(laneBadge('acc-b')).toBe('30');
    // ONE grouped read by the lane field, asking `COUNT(*)`, with no statistic drawn.
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(ds.queryGroupHeaders.mock.calls[0][1].groupBy).toEqual(['account']);
    expect(ds.queryGroupHeaders.mock.calls[0][1].aggregations).toEqual([{ function: 'count', alias: 'count' }]);
  });

  it('a foot `count` reads the whole lane too', async () => {
    mountBoard(dealSource(), { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summary: { type: 'count' } } });

    await onePageDrawn();
    await waitFor(() => expect(footFigure('acc-a')).toBe('30'));
    expect(footFigure('acc-b')).toBe('30');
  });

  it('CONTROL: over a source with no grouped door each count is the page\'s, marked `+`', async () => {
    mountBoard(dealSource(false), { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summary: { type: 'count' } } });

    await onePageDrawn();
    expect(laneBadge('acc-a')).toBe('13+');
    expect(laneBadge('acc-b')).toBe('12+');
    expect(footFigure('acc-a')).toBe('13+');
  });

  it('a lane whose records all sit past the page is drawn, titled by its account, counting its 10 records', async () => {
    const ds = dealSource();
    mountBoard(ds, BOARD_VIEW);

    await onePageDrawn();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Cyan Corp' })).toBeInTheDocument());
    expect(within(lane('Cyan Corp')).queryAllByRole('listitem')).toHaveLength(0);
    expect(laneBadge('Cyan Corp')).toBe('10');
    // ONE `id IN (…)` read of the referenced records, projecting the id and
    // the field the title is read from.
    const titleReads = ds.find.mock.calls.filter((call: any[]) => call[0] === ACCOUNT);
    expect(titleReads).toHaveLength(1);
    expect(titleReads[0][1]).toEqual({ $filter: { id: { $in: ['acc-c'] } }, $top: 1, $select: ['id', 'name'] });
  });

  it('CONTROL: over a source with no grouped door no lane past the page is drawn', async () => {
    mountBoard(dealSource(false), BOARD_VIEW);

    await onePageDrawn();
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).not.toContain('Cyan Corp');
    expect(screen.queryByRole('group', { name: 'acc-c' })).toBeNull();
  });

  it('the `summarizeField` header total sums the whole lane: 870, 900 and 645, never the page\'s 156 and 144', async () => {
    const ds = dealSource();
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summarizeField: 'amount' } });

    await onePageDrawn();
    await waitFor(() => expect(headerTotal('acc-a')).toBe('870'));
    expect(headerTotal('acc-b')).toBe('900');
    await waitFor(() => expect(screen.getByRole('group', { name: 'Cyan Corp' })).toBeInTheDocument());
    expect(headerTotal('Cyan Corp')).toBe('645');
    // The count and the total ride ONE read.
    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(ds.queryGroupHeaders.mock.calls[0][1].aggregations).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'sum', field: 'amount', alias: 'sum_amount' },
    ]);
  });

  it('CONTROL: over a source with no grouped door the header total is the page\'s, marked `+`', async () => {
    mountBoard(dealSource(false), { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summarizeField: 'amount' } });

    await onePageDrawn();
    await waitFor(() => expect(headerTotal('acc-a')).toBe('156+'));
    expect(headerTotal('acc-b')).toBe('144+');
  });

  it.each([
    ['refuses the read', 'refuse'],
    ['cuts the read (hasMore)', 'cut'],
  ] as const)('CONTROL: when the door %s, the counts and the header total are the page\'s, marked `+`, and no lane past the page is drawn', async (_, door) => {
    const ds = dealSource(door);
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summarizeField: 'amount' } });

    await onePageDrawn();
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(headerTotal('acc-a')).toBe('156+'));
    expect(headerTotal('acc-b')).toBe('144+');
    expect(laneBadge('acc-a')).toBe('13+');
    expect(laneBadge('acc-b')).toBe('12+');
    expect(screen.queryByRole('group', { name: 'Cyan Corp' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'acc-c' })).toBeNull();
  });

  it('counts under the view\'s filter, the one its own window was fetched with', async () => {
    const ds = dealSource();
    mountBoard(ds, { ...BOARD_VIEW, filter: [{ field: 'amount', operator: 'greater_than', value: 9 }] });

    await waitFor(() => expect(cards()).toHaveLength(25));
    // 10, 12, … 58 and 11, 13, … 59: 25 each; all 10 of acc-c clear the filter.
    await waitFor(() => expect(laneBadge('acc-a')).toBe('25'));
    expect(laneBadge('acc-b')).toBe('25');
    await waitFor(() => expect(screen.getByRole('group', { name: 'Cyan Corp' })).toBeInTheDocument());
    expect(laneBadge('Cyan Corp')).toBe('10');
    expect(ds.queryGroupHeaders.mock.calls[0][1].where).toBeDefined();
  });

  it('a lane past the page says how many cards it did not load, never "No cards"', async () => {
    mountBoard(dealSource(), BOARD_VIEW);

    await onePageDrawn();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Cyan Corp' })).toBeInTheDocument());
    expect(within(lane('Cyan Corp')).getByText('Cards not loaded: 10')).toBeInTheDocument();
    expect(within(lane('Cyan Corp')).queryByText('No cards')).toBeNull();
  });

  it('a board laned by a text field counts each whole lane but draws no lane past the page', async () => {
    const ds = dealSource();
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, groupByField: 'tier' } });

    await waitFor(() => expect(cards()).toHaveLength(25));
    await waitFor(() => expect(laneBadge('gold')).toBe('30'));
    expect(laneBadge('silver')).toBe('30');
    // The read names `bronze`, which sits past the page: a key the aggregate
    // spells for a field that is no reference draws no lane.
    expect(screen.queryByRole('group', { name: 'bronze' })).toBeNull();
  });

  it('a float total reads as the page path prints it, without binary residue', async () => {
    const FLOATS: Row[] = [
      { id: 'f1', name: 'Float 1', account: 'acc-a', tier: 'gold', amount: 0.1 },
      { id: 'f2', name: 'Float 2', account: 'acc-a', tier: 'gold', amount: 0.2 },
      { id: 'f3', name: 'Float 3', account: 'acc-b', tier: 'gold', amount: 0.7 },
    ];
    const ds = dealSource(true, FLOATS);
    mountBoard(ds, { ...BOARD_VIEW, kanban: { ...BOARD_VIEW.kanban, summarizeField: 'amount' } });

    await waitFor(() => expect(cards()).toHaveLength(3));
    // The read answers 0.1 + 0.2 = 0.30000000000000004 for acc-a.
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(laneBadge('acc-a')).toBe('2'));
    expect(headerTotal('acc-a')).toBe('0.3');
    expect(headerTotal('acc-b')).toBe('0.7');
  });
});

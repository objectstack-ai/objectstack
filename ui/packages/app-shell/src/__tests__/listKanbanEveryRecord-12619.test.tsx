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

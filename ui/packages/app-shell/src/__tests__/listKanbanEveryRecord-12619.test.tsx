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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  // block of its own (`kanbanViewOptions` in `ObjectView.tsx`).
  options: { kanban: { groupByField: 'stage', titleField: 'name' } },
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

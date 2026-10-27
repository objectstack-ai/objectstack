/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Stacked related lists with zero records fold into ONE line after the lists
 * that have records (#25895, item 1).
 *
 * Measured on HotCRM's account page: the Related tab gave each empty list a
 * full row (「客户 0 · 暂无相关记录 · + 新建」 between 报价单 (2) and 活动 (7),
 * another after 活动), so a reader scrolled past rows that say nothing.
 *
 * The stack is drawn by whatever container holds the `record:related_list`
 * nodes (on the record page, `page:tabs`' Related tab), so the lists that
 * share one container coordinate among themselves: once every one of them has
 * answered, the empty ones are withheld from their place, and the LAST list of
 * the stack draws one line naming them, each keeping its New action.
 *
 * Pinned beside the rule: a stack whose lists are all empty, or a list on its
 * own, draws exactly as before; a list that offers more than New (an `add`
 * picker) keeps its own row; and a folded list that gains a record unfolds.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Registers `record:related_list`, the block under test.
import '../../index';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

const PARENT = 'crm_account';

/** Rows per child object; mutable so a test can give an empty list a record. */
type Rows = Record<string, Array<Record<string, unknown>>>;

const makeDataSource = (rows: Rows) => ({
  find: vi.fn(async (object: string) => {
    const data = rows[object] ?? [];
    return { data, total: data.length };
  }),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
  onMutation: () => () => {},
});

const list = (objectName: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'record:related_list',
  properties: { objectName, title, relationshipField: 'account_id', columns: ['name'], ...extra },
});

/** The card's account: empty lists sitting between and after lists with records. */
const ACCOUNT_STACK = [
  list('crm_quote', 'Quotes'),
  list('crm_child_account', 'Child accounts'),
  list('crm_contact', 'Contacts'),
  list('crm_lead', 'Leads'),
];

const ACCOUNT_ROWS: Rows = {
  crm_quote: [{ id: 'q1', name: 'Q-001', account_id: 'a1' }],
  crm_contact: [
    { id: 'c1', name: 'Ada', account_id: 'a1' },
    { id: 'c2', name: 'Grace', account_id: 'a1' },
  ],
};

function mount(nodes: object[], rows: Rows) {
  const ds = makeDataSource(rows);
  const created = vi.fn();
  const host: RelatedRecordActionsValue = {
    resolve: ({ objectName }) => ({ onCreate: () => created(objectName) }),
  };
  const r = render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <RecordContextProvider objectName={PARENT} recordId="a1" dataSource={ds as never}>
        <RelatedRecordActionsProvider value={host}>
          {/* The stack: siblings in one container, as `page:tabs` draws a tab's children. */}
          <div data-testid="stack">
            {nodes.map((node, idx) => (
              <SchemaRenderer key={idx} schema={node as never} />
            ))}
          </div>
        </RelatedRecordActionsProvider>
      </RecordContextProvider>
    </SchemaRendererProvider>,
  );
  return { ...r, ds, created };
}

const fold = () => screen.queryByTestId('record-related-list-empty-fold');

/** A list's own card, found by its title outside the fold line. */
const cardTitled = (title: string): HTMLElement => {
  const hit = screen
    .getAllByText(title)
    .find((el) => !fold()?.contains(el));
  if (!hit) throw new Error(`no card titled ${title}`);
  return hit;
};

/** Wait until every list of the stack has answered its read. */
const settled = async (ds: ReturnType<typeof makeDataSource>, objects: number) => {
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(objects));
  await screen.findByText('Ada');
};

describe('record:related_list — empty lists of a stack fold into one line (#25895)', () => {
  it('the empty lists leave their place, and one line after the last list names them in stack order', async () => {
    const { ds } = mount(ACCOUNT_STACK, ACCOUNT_ROWS);
    await settled(ds, 4);
    await waitFor(() => expect(fold()).not.toBeNull());
    const line = fold()!;

    // Named, in the order the stack declares them.
    const names = within(line).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual(['Child accounts', 'Leads']);

    // Withheld from their place; the lists with records stay where they are.
    expect(cardTitled('Child accounts')).not.toBeVisible();
    expect(cardTitled('Leads')).not.toBeVisible();
    expect(cardTitled('Quotes')).toBeVisible();
    expect(cardTitled('Contacts')).toBeVisible();

    // The line is drawn AFTER every list that has records.
    expect(cardTitled('Contacts').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('record-related-list-empty-fold')).toHaveLength(1);
  });

  it('each folded list keeps its New action, wired to its own object', async () => {
    const { ds, created } = mount(ACCOUNT_STACK, ACCOUNT_ROWS);
    await settled(ds, 4);
    await waitFor(() => expect(fold()).not.toBeNull());
    const leads = within(fold()!).getByRole('group', { name: 'Leads' });
    fireEvent.click(within(leads).getByRole('button', { name: /New/ }));
    expect(created).toHaveBeenCalledWith('crm_lead');
    const children = within(fold()!).getByRole('group', { name: 'Child accounts' });
    fireEvent.click(within(children).getByRole('button', { name: /New/ }));
    expect(created).toHaveBeenLastCalledWith('crm_child_account');
  });

  it('a folded list that gains a record unfolds back into its place', async () => {
    const rows: Rows = { ...ACCOUNT_ROWS };
    const { ds } = mount(ACCOUNT_STACK, rows);
    await settled(ds, 4);
    await waitFor(() => expect(fold()).not.toBeNull());

    rows.crm_lead = [{ id: 'l1', name: 'Lin', account_id: 'a1' }];
    act(() => {
      window.dispatchEvent(new CustomEvent('objectui:related-changed', { detail: { objectName: 'crm_lead' } }));
    });
    await screen.findByText('Lin');
    await waitFor(() => expect(cardTitled('Leads')).toBeVisible());
    const names = within(fold()!).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual(['Child accounts']);
  });

  it('CONTROL: a stack whose lists are ALL empty draws every list as before, with no fold line', async () => {
    const { ds } = mount([list('crm_child_account', 'Child accounts'), list('crm_lead', 'Leads')], {});
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('No related records found')).toHaveLength(2));
    expect(fold()).toBeNull();
    expect(cardTitled('Child accounts')).toBeVisible();
    expect(cardTitled('Leads')).toBeVisible();
  });

  it('CONTROL: a list on its own draws its empty row as before', async () => {
    const { ds } = mount([list('crm_lead', 'Leads')], {});
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await screen.findByText('No related records found');
    expect(fold()).toBeNull();
    expect(cardTitled('Leads')).toBeVisible();
  });

  it('CONTROL: an empty list that offers more than New (an `add` picker) keeps its own row', async () => {
    const nodes = [
      list('crm_contact', 'Contacts'),
      list('crm_lead', 'Leads'),
      list('crm_team_member', 'Team', { add: { picker: { object: 'sys_user' } } }),
    ];
    const { ds } = mount(nodes, ACCOUNT_ROWS);
    await settled(ds, 3);
    await waitFor(() => expect(fold()).not.toBeNull());
    const names = within(fold()!).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual(['Leads']);
    expect(cardTitled('Team')).toBeVisible();
  });
});

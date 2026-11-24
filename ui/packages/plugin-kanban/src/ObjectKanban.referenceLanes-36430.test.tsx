/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36430 — a board grouped by a reference field (lookup, user,
 * master-detail, tree).
 *
 * The board fetches with `$expand`, so the lane field's value is the
 * referenced record. Before the fix the lanes were built from
 * `String(value)`: one lane per card, every one titled "[object Object]", and
 * each holding every card (bucketing keyed on the same string).
 *
 * Rows:
 *   (a) one lane per referenced record, titled by its name, holding that
 *       record's cards; a card with no value sits in "Uncategorized";
 *   (b) the referenced object's declared name field titles the lane;
 *   (c) a drag to another lane writes the foreign key, and the card stays in
 *       the lane it was dropped on, still naming its new owner;
 *   (d) declared lanes keyed by foreign key bucket expanded values.
 *
 * The drop is driven through `DndContext`'s real `onDragEnd`, captured as in
 * `ObjectKanban.rejectedMoveRollback.test.tsx`: jsdom has no pointer layout.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';
import './KanbanImpl';

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragEnd = props.onDragEnd as (event: unknown) => void;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

registerAllFields();

const DEAL = {
  name: 'deal',
  fields: {
    title: { type: 'text', label: 'Title' },
    owner_id: { type: 'user', label: 'Owner', reference: 'sys_user' },
    account_id: { type: 'lookup', label: 'Account', reference: 'account' },
  },
};

/** The account object names its records by `company`, not by a name-ish key. */
const ACCOUNT = {
  name: 'account',
  nameField: 'company',
  fields: { company: { type: 'text', label: 'Company' }, code: { type: 'text', label: 'Code' } },
};

const ALICE = { id: 'u1', name: 'Alice' };
const BOB = { id: 'u2', name: 'Bob' };
const ACME = { id: 'a1', company: 'Acme', code: 'ZZ-1' };
const GLOBEX = { id: 'a2', company: 'Globex', code: 'ZZ-2' };

const rows = () => [
  { id: 'd1', title: 'Deal one', owner_id: ALICE, account_id: ACME },
  { id: 'd2', title: 'Deal two', owner_id: BOB, account_id: GLOBEX },
  { id: 'd3', title: 'Deal three', owner_id: ALICE, account_id: ACME },
  { id: 'd4', title: 'Deal four', owner_id: null, account_id: null },
];

function makeDataSource(update = vi.fn(async () => ({}))): DataSource {
  return {
    getObjectSchema: vi.fn(async (name: string) => (name === 'account' ? ACCOUNT : name === 'deal' ? DEAL : { name, fields: {} })),
    find: vi.fn(async () => ({ value: rows() })),
    update,
  } as unknown as DataSource;
}

/** The cards in a lane, by the lane's visible title. */
function cardsIn(laneTitle: string): string[] {
  const list = screen.getByRole('list', { name: `${laneTitle} cards` });
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

function laneTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'))
    .map((lane) => lane.getAttribute('aria-label') ?? '');
}

async function mountBoard(groupBy: string, extra: Record<string, unknown> = {}, dataSource = makeDataSource()) {
  const result = render(
    <ObjectKanban
      schema={{ type: 'object-kanban', objectName: 'deal', groupBy, cardTitle: 'title', ...extra } as any}
      dataSource={dataSource}
    />,
  );
  expect(await screen.findByText('Deal four')).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a board grouped by a reference field (objectstack#36430)', () => {
  it('(a) draws one lane per owner, titled by name, holding that owner\'s cards', async () => {
    const { container } = await mountBoard('owner_id');
    await waitFor(() => expect(cardsIn('Alice')).toEqual(['Deal one', 'Deal three']));
    expect(cardsIn('Bob')).toEqual(['Deal two']);
    expect(cardsIn('Uncategorized')).toEqual(['Deal four']);
    expect(container.textContent).not.toContain('[object Object]');
    expect(laneTitles(container).filter((t) => t === 'Alice')).toHaveLength(1);
  });

  it('(b) titles a lookup lane by the target object\'s declared name field', async () => {
    const { container } = await mountBoard('account_id');
    await waitFor(() => expect(cardsIn('Acme')).toEqual(['Deal one', 'Deal three']));
    expect(cardsIn('Globex')).toEqual(['Deal two']);
    expect(laneTitles(container)).not.toContain('ZZ-1');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('(c) a drag to another owner\'s lane writes the foreign key and keeps the card there', async () => {
    const update = vi.fn(async () => ({}));
    await mountBoard('owner_id', {}, makeDataSource(update));
    await waitFor(() => expect(cardsIn('Bob')).toEqual(['Deal two']));

    expect(dnd.onDragEnd).toBeTypeOf('function');
    await act(async () => {
      dnd.onDragEnd!({ active: { id: 'd1' }, over: { id: 'u2' } });
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('deal', 'd1', { owner_id: 'u2' });
    // Lanes hold their cards in fetch order, so d1 sorts ahead of d2.
    await waitFor(() => expect(cardsIn('Bob')).toEqual(['Deal one', 'Deal two']));
    expect(cardsIn('Alice')).toEqual(['Deal three']);
  });

  it('(d) declared lanes keyed by foreign key take the expanded values', async () => {
    await mountBoard('owner_id', {
      columns: [{ id: 'u1', title: 'Team Alice' }, { id: 'u2', title: 'Team Bob' }],
    });
    await waitFor(() => expect(cardsIn('Team Alice')).toEqual(['Deal one', 'Deal three']));
    expect(cardsIn('Team Bob')).toEqual(['Deal two']);
    expect(cardsIn('Uncategorized')).toEqual(['Deal four']);
  });
});

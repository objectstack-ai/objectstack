/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12619 — a board asked to page its lanes (`lanePaging`) queries each
 * lane itself: the first page of every lane under the node's filter and sort,
 * the lane's count from the same answer, "Load more" at the lane's foot, and
 * one more query for the records in no lane.
 *
 * The records live in a `ValueDataSource`, which evaluates `$filter`, `$skip`,
 * `$top` and `$orderby` the way a backend does and answers `total`. The fetch
 * is spied on, so every query the board sends is read back as it left.
 *
 * The board half of the cross-package pin
 * `packages/app-shell/src/__tests__/listKanbanEveryRecord-12619.test.tsx`,
 * which mounts it under the real `ListView`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from '../ObjectKanban';
import { KANBAN_LANE_PAGE_SIZE } from '../KanbanLanePaging';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010).
import '../KanbanImpl';

// The board's real `onDragEnd`, captured while the real provider still renders
// (the device `ObjectKanban.rejectedMoveRollback.test.tsx` uses): dnd-kit's
// pointer sensors need a layout this DOM does not have.
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

afterEach(cleanup);

type Row = Record<string, unknown>;

const OBJECT = 'deal';

const OBJECT_DEF = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
        { value: 'lost', label: 'Lost' },
      ],
    },
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  },
};

/** `n` deals in `stage`, named so their order is their index. */
const deals = (stage: string | null, n: number, extra: Row = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${stage ?? 'none'}-${String(i).padStart(3, '0')}`,
    name: `${stage ?? 'none'} ${String(i).padStart(3, '0')}`,
    stage,
    amount: i,
    region: i % 2 === 0 ? 'north' : 'south',
    ...extra,
  }));

function makeAdapter(rows: Row[]) {
  const store = new ValueDataSource<Row>({ items: rows });
  return {
    find: vi.fn(async (object: string, params: any) => store.find(object, params)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async (_object: string, id: string, patch: Row) => ({ id, ...patch })),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  } as any;
}

const BOARD = { type: 'object-kanban', objectName: OBJECT, groupBy: 'stage' } as const;

function mount(adapter: any, props: Record<string, unknown> = {}, schema: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={adapter}>
      <ObjectKanban
        schema={{ ...BOARD, ...schema } as any}
        dataSource={adapter}
        lanePaging={{}}
        {...props}
      />
    </SchemaRendererProvider>,
  );
}

const lane = (title: string) => screen.getByRole('group', { name: title });
const laneCards = (title: string) => within(lane(title)).queryAllByRole('listitem');

/** The count badge a person reads beside a lane title. */
function laneCountText(columnId: string): string {
  const title = document.querySelector(`#kanban-col-${columnId}`);
  const badge = title?.parentElement?.querySelector('span');
  return (badge?.textContent ?? '').trim();
}

/** The queries the board sent, without the definition read. */
const queries = (adapter: any) => adapter.find.mock.calls.map((call: any[]) => call[1]);

describe('a board pages each lane itself when its host asks (objectui#12619)', () => {
  it('draws the first page of every lane, with the lane\'s count, past any single window', async () => {
    const adapter = makeAdapter([...deals('open', 70), ...deals('won', 5), ...deals('lost', 3)]);
    mount(adapter);

    await waitFor(() => expect(laneCards('Open')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    expect(laneCards('Won')).toHaveLength(5);
    expect(laneCards('Lost')).toHaveLength(3);
    // The lane's count is the server's, not what the lane drew.
    expect(laneCountText('open')).toBe('70');
    expect(laneCountText('won')).toBe('5');
    expect(laneCountText('lost')).toBe('3');
    // A lane that holds more says so at its foot; a lane that holds all does not.
    expect(within(lane('Open')).getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(within(lane('Won')).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('asks one query per lane plus one for records in no lane, each a page with its count, in the node\'s order', async () => {
    const adapter = makeAdapter([...deals('open', 2), ...deals('won', 1)]);
    mount(adapter, {}, { sort: [{ field: 'amount', order: 'desc' }], filter: [{ field: 'region', operator: 'equals', value: 'north' }] });

    await waitFor(() => expect(queries(adapter)).toHaveLength(4));
    const sent = queries(adapter);
    for (const params of sent) {
      expect(params.$top).toBe(KANBAN_LANE_PAGE_SIZE);
      expect(params.$count).toBe(true);
      // The node's `sort`, lowered the way the board's one query lowers it.
      expect(params.$orderby).toEqual({ amount: 'desc' });
    }
    const filters = sent.map((p: any) => JSON.stringify(p.$filter));
    // Each lane: the node's filter AND the lane value.
    for (const id of ['open', 'won', 'lost']) {
      expect(filters.some((f: string) => f.includes(JSON.stringify(['stage', '=', id])) && f.includes('north'))).toBe(true);
    }
    // In no lane: none of the lane values, or none at all.
    expect(filters.some((f: string) => f.includes(JSON.stringify(['stage', 'nin', ['open', 'won', 'lost']])) && f.includes(JSON.stringify(['stage', 'is_null'])))).toBe(true);
  });

  it('"Load more" appends the lane\'s next page and keeps its count', async () => {
    const adapter = makeAdapter([...deals('open', 70), ...deals('won', 1)]);
    mount(adapter);
    await waitFor(() => expect(laneCards('Open')).toHaveLength(KANBAN_LANE_PAGE_SIZE));

    fireEvent.click(within(lane('Open')).getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(laneCards('Open')).toHaveLength(70));
    const last = queries(adapter).at(-1);
    expect(last.$skip).toBe(KANBAN_LANE_PAGE_SIZE);
    expect(last.$top).toBe(KANBAN_LANE_PAGE_SIZE);
    expect(JSON.stringify(last.$filter)).toContain(JSON.stringify(['stage', '=', 'open']));
    expect(laneCountText('open')).toBe('70');
    expect(within(lane('Open')).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    // The cards are the lane's own, in the lane's order, none twice.
    const names = laneCards('Open').map((card) => card.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(70);
  });

  it('records in no lane still reach the trailing "Uncategorized" lane, with its count', async () => {
    const adapter = makeAdapter([...deals('open', 2), ...deals(null, 2), ...deals('archived', 1)]);
    mount(adapter);

    await waitFor(() => expect(laneCards('Uncategorized')).toHaveLength(3));
    expect(laneCountText('__uncolumned__')).toBe('3');
    expect(laneCards('Open')).toHaveLength(2);
  });

  it('the host\'s search rides on every lane query; a refresh asks each lane again at the depth it was loaded to', async () => {
    const adapter = makeAdapter([...deals('open', 70), ...deals('won', 1)]);
    const { rerender } = mount(adapter, { lanePaging: { search: 'open', searchFields: ['name'], reloadKey: 'r0' } });
    await waitFor(() => expect(laneCards('Open')).toHaveLength(KANBAN_LANE_PAGE_SIZE));
    for (const params of queries(adapter)) {
      expect(params.$search).toBe('open');
      expect(params.$searchFields).toEqual(['name']);
    }

    fireEvent.click(within(lane('Open')).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(laneCards('Open')).toHaveLength(70));
    const before = adapter.find.mock.calls.length;

    rerender(
      <SchemaRendererProvider dataSource={adapter}>
        <ObjectKanban
          schema={BOARD as any}
          dataSource={adapter}
          lanePaging={{ search: 'open', searchFields: ['name'], reloadKey: 'r1' }}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.find.mock.calls.length).toBeGreaterThan(before));
    const reasked = queries(adapter).slice(before);
    const openQuery = reasked.find((p: any) => JSON.stringify(p.$filter).includes(JSON.stringify(['stage', '=', 'open'])));
    // Two pages were on screen, so the refresh asks for two pages' worth.
    expect(openQuery.$top).toBe(2 * KANBAN_LANE_PAGE_SIZE);
    await waitFor(() => expect(laneCards('Open')).toHaveLength(70));
  });

  it('CONTROL: without the host\'s request the board keeps its one query, at its fetch batch', async () => {
    const adapter = makeAdapter([...deals('open', 70), ...deals('won', 5)]);
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <ObjectKanban schema={BOARD as any} dataSource={adapter} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(laneCards('Open')).toHaveLength(70));
    expect(queries(adapter)).toHaveLength(1);
    expect(queries(adapter)[0].$top).toBe(100);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('CONTROL: a board that draws swimlanes keeps its one query, with the host\'s search on it', async () => {
    const adapter = makeAdapter([...deals('open', 3), ...deals('won', 2)]);
    mount(adapter, { lanePaging: { search: 'o' } }, { swimlaneField: 'region' });

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('[aria-label="Kanban board with swimlanes"]')).not.toBeNull());
    expect(queries(adapter)).toHaveLength(1);
    expect(queries(adapter)[0].$search).toBe('o');
  });

  it('dragging a card keeps today\'s stage write, and both lane counts follow the card', async () => {
    const adapter = makeAdapter([...deals('open', 3), ...deals('won', 2)]);
    mount(adapter);
    await waitFor(() => expect(laneCards('Open')).toHaveLength(3));
    expect(laneCountText('open')).toBe('3');
    expect(laneCountText('won')).toBe('2');

    expect(dnd.onDragEnd).toBeTypeOf('function');
    await act(async () => {
      dnd.onDragEnd!({ active: { id: 'open-000' }, over: { id: 'won' } });
    });

    expect(adapter.update).toHaveBeenCalledWith(OBJECT, 'open-000', { stage: 'won' });
    await waitFor(() => expect(laneCards('Won')).toHaveLength(3));
    expect(laneCards('Open')).toHaveLength(2);
    expect(laneCountText('won')).toBe('3');
    expect(laneCountText('open')).toBe('2');
  });
});

describe('a card shows its owner\'s avatar when the host names the owner field (objectui#12619)', () => {
  const OWNED = deals('open', 1, { owner_id: { id: 'u1', name: 'Ada Lovelace' } });

  it('draws the owner\'s initials, named by the owner', async () => {
    const adapter = makeAdapter(OWNED);
    mount(adapter, { ownerField: 'owner_id' });

    await waitFor(() => expect(laneCards('Open')).toHaveLength(1));
    const avatar = within(laneCards('Open')[0]).getByLabelText('Ada Lovelace');
    expect(avatar).toHaveTextContent('AL');
  });

  it('CONTROL: no avatar without the host naming the field, or for an owner that is a bare id', async () => {
    const adapter = makeAdapter([...OWNED, ...deals('won', 1, { owner_id: 'u2' })]);
    mount(adapter);
    await waitFor(() => expect(laneCards('Open')).toHaveLength(1));
    expect(document.querySelector('[data-kanban-card-owner]')).toBeNull();
    cleanup();

    const again = makeAdapter([...deals('won', 1, { owner_id: 'u2' })]);
    mount(again, { ownerField: 'owner_id' });
    await waitFor(() => expect(laneCards('Won')).toHaveLength(1));
    expect(document.querySelector('[data-kanban-card-owner]')).toBeNull();
  });
});

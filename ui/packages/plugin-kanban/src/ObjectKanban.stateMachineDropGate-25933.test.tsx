/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25933 — the board reads the object's blocking `state_machine` rule on the
 * grouped field: while a card is dragged, the lanes it may not enter are
 * dimmed, and a drop into one is refused on the client before any write.
 *
 * Measured on the showcase Task Board before the fix: a `backlog` card could
 * be dropped on any column; the server refused the move and the board rolled
 * it back with a toast, and nothing during the drag marked the columns the
 * card could not enter.
 *
 * The board is driven through `DndContext`'s real handlers, captured by the
 * module mock below (dnd-kit's pointer sensors need layout jsdom does not
 * have), as `ObjectKanban.rejectedMoveRollback.test.tsx` does.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time (see the rollback test's note).
import './KanbanImpl';

const dnd = vi.hoisted(() => ({
  onDragStart: undefined as undefined | ((event: unknown) => void),
  onDragEnd: undefined as undefined | ((event: unknown) => void),
  onDragCancel: undefined as undefined | ((event: unknown) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragStart = props.onDragStart as (event: unknown) => void;
    dnd.onDragEnd = props.onDragEnd as (event: unknown) => void;
    dnd.onDragCancel = props.onDragCancel as (event: unknown) => void;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

registerAllFields();

const CARD = 'Fix the widget';

/** The showcase task's machine, as `/meta` serves it (update-only, severity at the default). */
const objectDef = (rule: Record<string, unknown> = {}) => ({
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'todo', label: 'To Do' },
        { value: 'done', label: 'Done' },
      ],
    },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'task_status_flow',
      field: 'status',
      events: ['update'],
      transitions: { backlog: ['todo'], todo: ['done', 'backlog'], done: ['todo'] },
      ...rule,
    },
  ],
});

const schema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'todo', title: 'To Do' },
    { id: 'done', title: 'Done' },
  ],
} satisfies ObjectKanbanSchema;

function makeDataSource(def: unknown, update: DataSource['update']): DataSource {
  return {
    getObjectSchema: vi.fn(async () => def),
    find: vi.fn(async () => ({ value: [{ id: 't1', title: CARD, status: 'backlog' }] })),
    update,
  } as unknown as DataSource;
}

function cardsIn(columnTitle: string): string[] {
  const list = screen.getByRole('list', { name: `${columnTitle} cards` });
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

/** The lanes drawn dimmed right now, by title. */
function blockedLanes(): string[] {
  return ['Backlog', 'To Do', 'Done'].filter((title) =>
    screen.getByRole('group', { name: title }).hasAttribute('data-kanban-drop-blocked'),
  );
}

async function mountBoard(def: unknown, update: DataSource['update']) {
  render(<ObjectKanban schema={schema} dataSource={makeDataSource(def, update)} />);
  expect(await screen.findByText(CARD)).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(cardsIn('Backlog')).toEqual([CARD]));
}

async function startDrag() {
  expect(dnd.onDragStart).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragStart!({ active: { id: 't1' } });
  });
}

async function dropOn(columnId: string) {
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 't1' }, over: { id: columnId } });
  });
}

beforeEach(() => {
  dnd.onDragStart = undefined;
  dnd.onDragEnd = undefined;
  dnd.onDragCancel = undefined;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban — the state-machine drop gate (#25933)', () => {
  it('dims only the lanes a dragged backlog card may not enter', async () => {
    await mountBoard(objectDef(), vi.fn() as never);
    expect(blockedLanes()).toEqual([]);

    await startDrag();

    expect(blockedLanes()).toEqual(['Done']);
  });

  it('refuses a drop into a closed lane before any write', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'done' }));
    await mountBoard(objectDef(), update as never);

    await startDrag();
    await dropOn('done');

    expect(update).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(cardsIn('Backlog')).toEqual([CARD]);
    expect(cardsIn('Done')).toEqual([]);
    // The drag is over: no lane stays dimmed.
    expect(blockedLanes()).toEqual([]);
  });

  it('writes a drop into an open lane, as before', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'todo' }));
    await mountBoard(objectDef(), update as never);

    await startDrag();
    await dropOn('todo');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('task', 't1', { status: 'todo' });
    expect(cardsIn('To Do')).toEqual([CARD]);
  });

  it('puts the lanes back when the drag is cancelled', async () => {
    await mountBoard(objectDef(), vi.fn() as never);

    await startDrag();
    expect(blockedLanes()).toEqual(['Done']);

    await act(async () => {
      dnd.onDragCancel!({ active: { id: 't1' } });
    });

    expect(blockedLanes()).toEqual([]);
  });

  it('CONTROL: a warning-severity machine closes no lane, and the drop is written', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'done' }));
    await mountBoard(objectDef({ severity: 'warning' }), update as never);

    await startDrag();
    expect(blockedLanes()).toEqual([]);
    await dropOn('done');

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a machine on a field the board does not group by closes no lane', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'done' }));
    await mountBoard(objectDef({ field: 'phase' }), update as never);

    await startDrag();
    expect(blockedLanes()).toEqual([]);
    await dropOn('done');

    expect(update).toHaveBeenCalledTimes(1);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #27099 — a lane the drop gate closes says why. While a card is dragged, a
 * lane it may not enter is dimmed and `aria-disabled` (#25933); it now also
 * carries the reason, as its `title` for a pointer user and as the text its
 * `aria-describedby` names for assistive tech. The reason is the `message`
 * of the blocking `state_machine` rule that refuses the move, the sentence the
 * server's refusal of the same move carries.
 *
 * Before the fix the dimmed lane carried no title and no description, so the
 * user was not told why the drop was refused.
 *
 * The board is driven through `DndContext`'s real handlers, captured by the
 * module mock below, as the #25933 drop-gate test beside this file does.
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
const FLOW_MESSAGE = 'A task moves through To Do before it is Done.';

/** The showcase task's machine, as `/meta` serves it (update-only, severity at the default). */
const objectDef = (
  rule: Record<string, unknown> = {},
  extraRules: Record<string, unknown>[] = [],
) => ({
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
      message: FLOW_MESSAGE,
      ...rule,
    },
    ...extraRules,
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

const lane = (title: string) => screen.getByRole('group', { name: title });

/** A lane that explains nothing: no title, no description. */
function expectSilent(title: string) {
  expect(lane(title)).not.toHaveAttribute('title');
  expect(lane(title)).not.toHaveAttribute('aria-describedby');
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

describe('ObjectKanban — a closed lane says why (#27099)', () => {
  it("titles and describes the closed lane with the blocking rule's message", async () => {
    await mountBoard(objectDef(), vi.fn() as never);

    await startDrag();

    const done = lane('Done');
    expect(done).toHaveAttribute('data-kanban-drop-blocked');
    expect(done).toHaveAttribute('title', FLOW_MESSAGE);
    expect(done).toHaveAccessibleDescription(FLOW_MESSAGE);
  });

  it('CONTROL: an open lane, and every lane before the drag, explains nothing', async () => {
    await mountBoard(objectDef(), vi.fn() as never);
    for (const title of ['Backlog', 'To Do', 'Done']) expectSilent(title);

    await startDrag();

    expect(lane('To Do')).not.toHaveAttribute('data-kanban-drop-blocked');
    expectSilent('To Do');
    expectSilent('Backlog');
  });

  it('drops the reason with the drag', async () => {
    await mountBoard(objectDef(), vi.fn() as never);

    await startDrag();
    expect(lane('Done')).toHaveAttribute('title', FLOW_MESSAGE);
    await act(async () => {
      dnd.onDragCancel!({ active: { id: 't1' } });
    });

    expectSilent('Done');
  });

  it('names every rule that closes the lane, and no rule that does not', async () => {
    const second = 'Only a reviewer closes a task.';
    await mountBoard(
      objectDef({}, [
        // Also closes Done to a backlog card.
        {
          type: 'state_machine',
          name: 'task_review_flow',
          field: 'status',
          transitions: { backlog: ['todo'] },
          message: second,
        },
        // Silent on the backlog from-state, so it closes nothing here.
        {
          type: 'state_machine',
          name: 'task_reopen_flow',
          field: 'status',
          transitions: { done: ['todo'] },
          message: 'Never shown.',
        },
        // Warning-only: the gate ignores it, so the reason must too.
        {
          type: 'state_machine',
          name: 'task_soft_flow',
          field: 'status',
          severity: 'warning',
          transitions: { backlog: [] },
          message: 'Never shown either.',
        },
      ]),
      vi.fn() as never,
    );

    await startDrag();

    expect(lane('Done')).toHaveAttribute('title', `${FLOW_MESSAGE} ${second}`);
    expect(lane('Done')).toHaveAccessibleDescription(`${FLOW_MESSAGE} ${second}`);
    expectSilent('To Do');
  });

  it('falls back to the board sentence when the rule carries no message', async () => {
    await mountBoard(objectDef({ message: '  ' }), vi.fn() as never);

    await startDrag();

    const fallback = 'A card in Backlog cannot be moved to Done.';
    expect(lane('Done')).toHaveAttribute('title', fallback);
    expect(lane('Done')).toHaveAccessibleDescription(fallback);
  });
});

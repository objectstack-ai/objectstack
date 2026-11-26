/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36806 — a kanban drag writes the lane field, so the lane field's
 * own lock closes it, through the one hand-lock verdict of `@object-ui/core`
 * (`fieldReadOnlyByHand`): `uiReadonly` (the hand lock) and `readonly` (the
 * server lock) draw every card as not movable and hand no drop to the write;
 * a conditional lock (`uiReadonlyWhen`) TRUE over the dragged record takes the
 * drop and writes nothing. Before, the board read no field lock at all, so a
 * `readonly` lane field took the drop and the write was silently stripped.
 *
 * The harness is `ObjectKanban.moveGrant-12082.test.tsx`'s: the drop is
 * synthesized through `DndContext`'s real `onDragEnd`, captured by the module
 * mock below; the card's `aria-disabled` is dnd-kit's sortable state.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time (AGENTS.md §测试纪律); specifier
// byte-identical to the component's own lazy import.
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

const OBJECT = 'task';
const CARD = 'Fix the widget';

const statusField = (lock: Record<string, unknown>) => ({
  type: 'picklist',
  label: 'Status',
  options: [
    { value: 'backlog', label: 'Backlog' },
    { value: 'in_progress', label: 'In Progress' },
  ],
  ...lock,
});

const schema = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'in_progress', title: 'In Progress' },
  ],
} satisfies ObjectKanbanSchema;

function makeDataSource(lock: Record<string, unknown>) {
  return {
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: { title: { type: 'text', label: 'Title' }, status: statusField(lock) } })),
    find: vi.fn(async () => ({ value: [{ id: 't1', title: CARD, status: 'backlog' }] })),
    update: vi.fn(async () => ({ id: 't1', status: 'in_progress' })),
  } as unknown as DataSource & { update: ReturnType<typeof vi.fn> };
}

async function mountBoard(lock: Record<string, unknown>) {
  const ds = makeDataSource(lock);
  render(<ObjectKanban schema={schema} dataSource={ds} />);
  expect(await screen.findByText(CARD)).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  return ds;
}

const cardNode = () => screen.getByRole('button', { name: CARD });

async function dropOnInProgress() {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 't1' }, over: { id: 'in_progress' } });
  });
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban: the lane field\'s lock closes the drag (objectstack#36806)', () => {
  it.each([
    ['uiReadonly', { uiReadonly: true }],
    ['readonly', { readonly: true }],
  ])('a `%s` lane field draws the cards as not movable, and a drop writes nothing', async (_name, lock) => {
    const ds = await mountBoard(lock);
    await waitFor(() => expect(cardNode().getAttribute('aria-disabled')).toBe('true'));
    await dropOnInProgress();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('a `uiReadonlyWhen` TRUE over the dragged record takes the drop and writes nothing', async () => {
    const ds = await mountBoard({ uiReadonlyWhen: "record.status == 'backlog'" });
    expect(cardNode().getAttribute('aria-disabled')).toBe('false');
    await dropOnInProgress();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('CONTROL — a `uiReadonlyWhen` FALSE over the record, and no lock at all, write the move', async () => {
    for (const lock of [{ uiReadonlyWhen: "record.status == 'in_progress'" }, {}]) {
      const ds = await mountBoard(lock);
      expect(cardNode().getAttribute('aria-disabled')).toBe('false');
      await dropOnInProgress();
      await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 't1', { status: 'in_progress' }));
      cleanup();
    }
  });
});

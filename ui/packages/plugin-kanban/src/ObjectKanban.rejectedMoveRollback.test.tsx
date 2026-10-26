/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A REJECTED cross-column drag rolls the card back to the column it came from —
 * on BOTH data ownerships, including the ListView-hosted (external `data` prop)
 * one. objectui#4138.
 *
 * ── Where the optimistic move actually lives ──────────────────────────────
 * Not in `ObjectKanban`. `KanbanImpl`'s `handleDragEnd` moves the card inside
 * its OWN `boardColumns` state and only then calls `onCardMove`; that state is
 * reset from the `columns` prop by an effect that fires whenever `ObjectKanban`
 * re-renders (the schema handed to `KanbanRenderer` is a fresh object literal
 * each render, so `bucketCardsIntoColumns` re-runs and the columns identity
 * changes). So the card moves on screen on both paths, and what un-says the
 * move is a re-render of `ObjectKanban` that re-buckets the source-of-truth
 * records.
 *
 * That is why the pre-fix bug was invisible to `ObjectKanban`'s own state: on
 * the external path `handleCardMove`'s failure branch took NO state action at
 * all (`if (!hasExternalData)` gated the revert), so nothing re-rendered and
 * `boardColumns` kept the card in the target column until a manual reload —
 * exactly the QA signature in #4138.
 *
 * ── Direction of these pins ───────────────────────────────────────────────
 *  - external + rejected  → RED before the fix (card stuck in "In Progress"),
 *                           GREEN after. This is the issue.
 *  - internal + rejected  → GREEN before and after. The control that proves
 *                           the suite can see a rollback at all, so the red
 *                           above is the gate and not the harness.
 *  - both + accepted      → GREEN before and after. Guards the fix against
 *                           over-reverting a move the server accepted.
 *
 * The board is driven through `DndContext`'s real `onDragEnd`, captured by the
 * module mock below: dnd-kit's pointer sensors need layout/pointer-capture that
 * jsdom does not provide, so a synthesized drop on the production handler is
 * the closest honest reproduction. Everything downstream of that call —
 * `KanbanImpl`'s local move, `ObjectKanban`'s persist, the failure branch, the
 * re-bucket and the reset effect — is the real code path.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time rather than racing it against a
// `findBy` budget (AGENTS.md §测试纪律); specifier byte-identical to `./index`'s
// so the component's own `React.lazy` factory resolves from the ESM cache.
import './KanbanImpl';

// `vi.hoisted` so the mock factory — hoisted above every import — can reach this
// box. A plain `const` would still be in its TDZ when `@dnd-kit/core` is first
// requested by `KanbanImpl`.
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));

// Capture the board's real `onDragEnd` while still rendering the real provider,
// so `@dnd-kit/sortable`'s hooks keep reading the same context instance.
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

const objectDef = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'picklist',
      label: 'Status',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'in_progress', label: 'In Progress' },
      ],
    },
  },
};

const CARD = 'Fix the widget';

const schema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'in_progress', title: 'In Progress' },
  ],
} satisfies ObjectKanbanSchema;

/** Server truth: the card is in `backlog` and the server never moves it. */
const serverRecords = () => [{ id: 't1', title: CARD, status: 'backlog' }];

/**
 * The 400 the QA run measured: an illegal Backlog → In Progress transition.
 * Deliberately NOT a 403 — `isPermissionError` must not claim it, so the
 * failure branch takes its `extractWriteErrorMessage` arm.
 */
function invalidTransition(): Error {
  return Object.assign(new Error('Invalid status transition'), {
    status: 400,
    code: 'invalid_transition',
  });
}

function makeDataSource(update: DataSource['update']): DataSource {
  return {
    getObjectSchema: vi.fn(async () => objectDef),
    find: vi.fn(async () => ({ value: serverRecords() })),
    update,
  } as unknown as DataSource;
}

/** The cards currently rendered inside a column, by the column's visible title. */
function cardsIn(columnTitle: string): string[] {
  const list = screen.getByRole('list', { name: `${columnTitle} cards` });
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

/**
 * Mount the board on one of the two data ownerships and wait until it has
 * settled — the object-schema fetch and (internal path) the record fetch both
 * land as async state updates, and a stray one arriving AFTER the drag would
 * re-render the board and mask the very bug under test.
 */
async function mountBoard(mode: 'external' | 'internal', dataSource: DataSource) {
  render(
    <ObjectKanban
      schema={schema}
      dataSource={dataSource}
      {...(mode === 'external' ? { data: serverRecords() } : {})}
    />,
  );
  expect(await screen.findByText(CARD)).toBeInTheDocument();
  // Flush the object-def / record fetches so nothing re-renders mid-assertion.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(cardsIn('Backlog')).toEqual([CARD]));
}

/** Drop the card onto the "In Progress" column, exactly as the board would. */
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

describe('ObjectKanban — rejected drag rolls the card back (#4138)', () => {
  it('reverts on the EXTERNAL-data path (ListView-hosted): card returns to Backlog', async () => {
    const update = vi.fn(async () => {
      throw invalidTransition();
    });
    await mountBoard('external', makeDataSource(update as never));

    await dropOnInProgress();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('task', 't1', { status: 'in_progress' });
    // The gate: pre-fix this reads ['Fix the widget'] for "In Progress" and []
    // for "Backlog" — the stuck card of #4138.
    expect(cardsIn('Backlog')).toEqual([CARD]);
    expect(cardsIn('In Progress')).toEqual([]);
    // The rollback moves the card, it does not clone it.
    expect(screen.getAllByRole('listitem', { name: CARD })).toHaveLength(1);
  });

  it('still surfaces the rejection as a toast on the EXTERNAL-data path', async () => {
    const update = vi.fn(async () => {
      throw invalidTransition();
    });
    await mountBoard('external', makeDataSource(update as never));

    await dropOnInProgress();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Invalid status transition');
  });

  it('reverts on the INTERNAL-data path (control: green before and after)', async () => {
    const update = vi.fn(async () => {
      throw invalidTransition();
    });
    await mountBoard('internal', makeDataSource(update as never));

    await dropOnInProgress();

    expect(update).toHaveBeenCalledTimes(1);
    expect(cardsIn('Backlog')).toEqual([CARD]);
    expect(cardsIn('In Progress')).toEqual([]);
    expect(screen.getAllByRole('listitem', { name: CARD })).toHaveLength(1);
  });

  it('keeps an ACCEPTED move committed on the EXTERNAL-data path', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'in_progress' }));
    await mountBoard('external', makeDataSource(update as never));

    await dropOnInProgress();

    expect(update).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    // The parent owns the data and has not re-fetched yet; the board must keep
    // showing the move it just made rather than snapping back.
    expect(cardsIn('In Progress')).toEqual([CARD]);
    expect(cardsIn('Backlog')).toEqual([]);
  });

  it('keeps an ACCEPTED move committed on the INTERNAL-data path', async () => {
    const update = vi.fn(async () => ({ id: 't1', status: 'in_progress' }));
    await mountBoard('internal', makeDataSource(update as never));

    await dropOnInProgress();

    expect(update).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(cardsIn('In Progress')).toEqual([CARD]);
    expect(cardsIn('Backlog')).toEqual([]);
  });
});

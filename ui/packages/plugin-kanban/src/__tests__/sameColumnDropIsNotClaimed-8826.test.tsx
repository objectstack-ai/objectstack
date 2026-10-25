/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The board stops claiming an order it cannot keep — objectui#8826, letter B.
 *
 * ── What was ruled ────────────────────────────────────────────────────────
 * objectui#8826 measured that a SAME-column reorder is persisted nowhere: the
 * card moved on screen, nothing recorded it, and the next data round-trip put
 * it back without a word. Its sibling measurement (question 3, pinned in
 * `crossColumnLandingPosition-8826.test.tsx`) found the landing POSITION of a
 * CROSS-column move is lost the same way, on both data ownerships.
 *
 * The maintainer ruled letter B: the board stops claiming a capability it does
 * not have. Not letter A (persist the order) — there is no declared ordering
 * slot in `@objectstack/spec` to write one to, and inventing a UI-local one is
 * the workaround Prime Directive 5 forbids. Not letter C (document the false
 * success) — documenting it formalises it.
 *
 * ⇒ Same-column drop: no optimistic reorder. The card returns to its position.
 * ⇒ Cross-column move: the membership change stays — it IS persisted — and the
 *   landing position is not claimed.
 *
 * ── The two legs, and why BOTH are required ───────────────────────────────
 * A pin that only witnessed "nothing moved" would be green on a board whose
 * drag path was broken outright, which is a far worse product than the one
 * being repaired. So the second leg is not a bonus: it is the LIT CONTROL that
 * proves this instrument drives a real drop, and that the capability the board
 * DOES have still works and still reaches the wire.
 *
 *   LEG 1 — a same-column drop leaves DOM order equal to the DATA order, on
 *           both ownerships, and reaches no `update`.
 *   LEG 2 — a cross-column drop still emits a new `columns` snapshot carrying
 *           the membership change, and still writes it.
 *
 * ── The instrument ────────────────────────────────────────────────────────
 * The recorder objectui#8826 was measured with, reused rather than re-invented:
 * a module mock of `../KanbanImpl` that records the `columns` prop on every
 * render and then renders the real board, plus a module mock of `@dnd-kit/core`
 * that captures the board's real `onDragEnd`. dnd-kit's pointer sensors need
 * layout and pointer capture that happy-dom does not provide, so a synthesized
 * drop on the production handler is the closest honest reproduction; everything
 * downstream of that call is the real path.
 *
 * ── The fixture is built so "did not move" is distinguishable ──────────────
 * `Backlog` holds two cards, and the drop asks for the reverse of the order the
 * records are in. A single-card column, or a drop onto the slot the card is
 * already in, would read green whether the reorder was removed or not.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from '../ObjectKanban';

// Pay the board's lazy chunk at import time rather than racing it against a
// `findBy` budget (AGENTS.md 测试纪律); specifier resolves to the same module as
// `./KanbanImpl` in `../index`, so the `React.lazy` factory hits the cache.
import '../KanbanImpl';

// `vi.hoisted` so the mock factories — hoisted above every import — can reach
// these boxes. A plain `const` would still be in its TDZ when the mocked
// modules are first requested.
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));
const recorder = vi.hoisted(() => ({ snapshots: [] as string[] }));

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

// THE INSTRUMENT: record the `columns` prop on every render of the board, then
// render the real board with it. Recording in the component body (not an
// effect) is deliberate — it is the prop AS DELIVERED that is under test.
vi.mock('../KanbanImpl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../KanbanImpl')>();
  const ReactMod = await import('react');
  const RecordingKanbanBoard = (props: Record<string, unknown>) => {
    const cols = (props.columns as Array<Record<string, unknown>> | undefined) ?? [];
    recorder.snapshots.push(
      cols
        .map((c) => {
          const cards = (c.cards as Array<Record<string, unknown>> | undefined) ?? [];
          return `${String(c.id)}:${cards.map((k) => String(k.title)).join(',')}`;
        })
        .join(' | '),
    );
    return ReactMod.createElement(actual.default as never, props as never);
  };
  return { ...actual, default: RecordingKanbanBoard };
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

/** Record order IS the board's order: `bucketCardsIntoColumns` preserves it. */
const RECORDS = () => [
  { id: 'a', title: 'Alpha', status: 'backlog' },
  { id: 'b', title: 'Beta', status: 'backlog' },
  { id: 'g', title: 'Gamma', status: 'in_progress' },
];

/** What the data says, at mount and after any honest same-column drop. */
const DATA_ORDER = 'backlog:Alpha,Beta | in_progress:Gamma';
/** What the same-column drop below ASKS for. Must never be shown. */
const DROP_ORDER = 'backlog:Beta,Alpha | in_progress:Gamma';

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

function makeDataSource(update: DataSource['update']): DataSource {
  return {
    getObjectSchema: vi.fn(async () => objectDef),
    find: vi.fn(async () => ({ value: RECORDS() })),
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

const acceptingUpdate = () => vi.fn(async () => ({ id: 'a', status: 'in_progress' }));

/**
 * Mount on one of the two data ownerships and wait until it has settled: the
 * object-schema fetch and (internal path) the record fetch both land as async
 * state updates, and a stray one arriving AFTER the drag would re-render the
 * board and add a snapshot that belongs to neither reading.
 */
async function mountBoard(mode: 'external' | 'internal', dataSource: DataSource) {
  render(
    <ObjectKanban
      schema={schema}
      dataSource={dataSource}
      {...(mode === 'external' ? { data: RECORDS() } : {})}
    />,
  );
  expect(await screen.findByText('Alpha')).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(cardsIn('Backlog')).toEqual(['Alpha', 'Beta']));
  expect(recorder.snapshots[recorder.snapshots.length - 1]).toBe(DATA_ORDER);
  return recorder.snapshots.length;
}

/** Drop `Beta` onto `Alpha` — a SAME-column reorder asking for the reverse. */
async function dropBetaOntoAlpha() {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 'b' }, over: { id: 'a' } });
  });
}

/** Drop `Alpha` onto `Gamma` — a CROSS-column move, the capability that stays. */
async function dropAlphaOntoGamma() {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 'a' }, over: { id: 'g' } });
  });
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
  recorder.snapshots.length = 0;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban — an unpersistable order is no longer shown as persisted (#8826)', () => {
  for (const mode of ['internal', 'external'] as const) {
    it(`LEG 1 (${mode} data): a same-column drop leaves DOM order equal to the DATA order`, async () => {
      const update = acceptingUpdate();
      const before = await mountBoard(mode, makeDataSource(update as never));

      await dropBetaOntoAlpha();

      // The ruling, as an assertion: the card returns to its position.
      expect(cardsIn('Backlog')).toEqual(['Alpha', 'Beta']);
      expect(cardsIn('In Progress')).toEqual(['Gamma']);
      // ...and nothing anywhere ever saw the order the user dropped in.
      expect(recorder.snapshots).not.toContain(DROP_ORDER);
      expect(recorder.snapshots.slice(before)).toEqual([]);
      // No write, because there is nothing to write it to.
      expect(update).not.toHaveBeenCalled();
    });
  }

  it('LEG 2 — LIT CONTROL: a cross-column move still emits the new membership snapshot, and still writes it', async () => {
    // Without this leg, LEG 1 would be green on a board whose drag path was
    // broken outright. It is the same synthesized drop, on the same instrument.
    const update = acceptingUpdate();
    const before = await mountBoard('internal', makeDataSource(update as never));

    await dropAlphaOntoGamma();

    const fresh = recorder.snapshots.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    const latest = fresh[fresh.length - 1];
    expect(latest).not.toBe(DATA_ORDER);
    // Membership DID flow back: `Alpha` left `backlog` and is in `in_progress`.
    expect(latest).toMatch(/^backlog:Beta \| in_progress:/);
    expect(latest).toContain('Alpha');
    // And it reached the wire: exact body, so an added positional key fails here.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('task', 'a', { status: 'in_progress' });
  });

  it('LEG 2 — LIT CONTROL (external data): the membership change is on screen without any prop reflow', async () => {
    // The ownership where nothing re-renders the board: the local mirror is the
    // only thing that can show the move, and it still does. This is also the
    // control that fails any "fix" which deletes that mirror.
    const update = acceptingUpdate();
    await mountBoard('external', makeDataSource(update as never));

    await dropAlphaOntoGamma();

    expect(cardsIn('Backlog')).toEqual(['Beta']);
    expect(cardsIn('In Progress')).toContain('Alpha');
    expect(update).toHaveBeenCalledTimes(1);
  });
});

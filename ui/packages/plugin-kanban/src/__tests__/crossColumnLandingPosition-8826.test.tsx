/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A CROSS-column drop loses the landing POSITION too — objectui#8826, question 3.
 *
 * ── What this file is ─────────────────────────────────────────────────────
 * A CHARACTERIZATION pin, not a gate. objectui#8826 measured that a SAME-column
 * reorder is persisted nowhere; its third question — is the landing position
 * within the TARGET column also lost on a CROSS-column move? — was filed
 * explicitly unmeasured, because the fix surface depends on the answer. This
 * file is that measurement, frozen. It asserts today's behaviour so that a
 * later change to it is announced rather than silent; it does NOT claim the
 * behaviour is correct, and it rules nothing about questions 1 and 2 (whether
 * in-column order should be persisted at all, and whether the optimistic update
 * should be removed if not). Those are the maintainer's.
 *
 * ── The answer, and where the index dies ──────────────────────────────────
 * `KanbanImpl.handleDragEnd`'s cross-column branch DOES compute a landing index
 * (`overIndex`) and DOES splice the card in at it, then hands that index to
 * `onCardMove` as its fourth argument. `ObjectKanban.handleCardMove` receives it
 * as `_newIndex` and discards it outright (`void _newIndex`), and
 * `persistCardMove` writes a body of exactly `{ [groupBy]: toColumnId }`. So the
 * index reaches a parameter and stops there: no sink, no PATCH key, no storage.
 * Column MEMBERSHIP flows back through the `columns` prop; ORDER never does —
 * the board's order is whatever `bucketCardsIntoColumns` produces, which is the
 * order of the underlying record array.
 *
 * ── ⚠️ The two data ownerships answer DIFFERENTLY, and that is the finding ──
 * The card anticipated one answer; there are two, because the optimistic write
 * that re-renders the board is itself gated on ownership.
 *
 *  - INTERNAL data (the board fetches): `persistCardMove`'s optimistic
 *    `setFetchedData` re-renders `ObjectKanban`, `KanbanRenderer` re-buckets,
 *    the `columns` identity changes and `KanbanImpl`'s mirror re-syncs from it.
 *    The dropped card therefore leaves the slot the user dropped it in
 *    IMMEDIATELY — inside the same `act()` — and lands wherever record order
 *    puts it. This is WORSE than the same-column signature the card describes:
 *    not a silent revert on some later reflow, but a visible snap on the spot.
 *  - EXTERNAL data (a parent owns `data`, e.g. ListView): the optimistic write
 *    is deliberately skipped, so nothing re-renders and the mirror is never
 *    reset. The drop position SURVIVES on screen — until the parent's next data
 *    reflow, which carries membership and not order. That is the card's
 *    silent-revert signature exactly.
 *
 * ⇒ The position is lost on BOTH paths. They differ only in WHEN the user sees
 *   it happen.
 *
 * ── ⭐ WHAT THIS FILE ANNOUNCED, AND WHAT WAS THEN RULED ───────────────────
 * The paragraph above is the reading this file was written to freeze, and the
 * maintainer ruled on it: objectui#8826 letter B — the board stops claiming a
 * capability it does not have. Two of the assertions below moved as a result,
 * and this note is the announcement the file exists to make:
 *  - the EXTERNAL-path asymmetry no longer leaves the card in the slot it was
 *    dropped in. The cross-column branch appends instead of splicing at the
 *    drop index, so the board claims membership and says nothing about
 *    position. ⚠️ In THIS fixture appended and record order coincide (`Alpha`
 *    is last in the record array), so what the assertion distinguishes is the
 *    dropped slot from everything else — not "appended" from "record order".
 *  - the internal-path snap is unchanged in outcome and no longer a snap: the
 *    card never occupies the dropped slot to begin with.
 * The wire, both controls and the record-order reading are untouched, and
 * still say what they said. The ruled behaviour is pinned in
 * `sameColumnDropIsNotClaimed-8826.test.tsx`.
 *
 * ── The instrument ────────────────────────────────────────────────────────
 * The card's recorder: the `columns` prop the board receives, captured on every
 * render, via a module mock of `../KanbanImpl` that records and then renders the
 * real board. (`columnsReachDomSameCommit-8534.test.tsx` has a recorder too, but
 * it snapshots the DOM per commit at the `KanbanImpl` seam — a different
 * instrument, and it never drives a cross-column drop.) The board is driven
 * through `DndContext`'s real `onDragEnd`, captured by the second module mock:
 * dnd-kit's pointer sensors need layout and pointer capture that happy-dom does
 * not provide, so a synthesized drop on the production handler is the closest
 * honest reproduction. Everything downstream of that call is the real path.
 *
 * Both controls the measurement needs are here as their own tests:
 *  - LIT positive control — a cross-column move DOES produce a new `columns`
 *    snapshot, with the membership change in it. The instrument is connected,
 *    so "the drop order never appears" is a reading and not a dead wire.
 *  - DEAD negative control — a drag that ends on nothing produces NO new
 *    snapshot and no write. The instrument does not fire spuriously.
 *
 * ── The fixture is built so the two orders cannot coincide ────────────────
 * The moved card is LAST in the record array and is dropped FIRST in the target
 * column. A fixture where the dropped card also happens to sort first would
 * read green whether the index survived or not.
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
// `findBy` budget (AGENTS.md §测试纪律); specifier resolves to the same module
// as `./KanbanImpl` in `../index`, so the `React.lazy` factory hits the cache.
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

/**
 * Record order is the load-bearing part of this fixture. `Alpha` is LAST in the
 * array and alone in `backlog`; the two cards already in `in_progress` come
 * FIRST. Dropping `Alpha` onto `Xray` asks for slot 0 of the target column,
 * while record order puts it in slot 2 — so drop order and record order are
 * distinguishable, which is the whole point.
 */
const RECORDS = () => [
  { id: 'x', title: 'Xray', status: 'in_progress' },
  { id: 'y', title: 'Yankee', status: 'in_progress' },
  { id: 'a', title: 'Alpha', status: 'backlog' },
];

/** What the recorder shows at mount, before any drag. */
const AT_MOUNT = 'backlog:Alpha | in_progress:Xray,Yankee';
/** What the drop asks for: `Alpha` in slot 0 of the target column. */
const DROP_ORDER = 'backlog: | in_progress:Alpha,Xray,Yankee';
/** What the prop actually carries back: record order, with `Alpha` last. */
const RECORD_ORDER = 'backlog: | in_progress:Xray,Yankee,Alpha';

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

/** An accepted write — this file measures the SUCCESS path, not a refusal. */
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
  await waitFor(() => expect(cardsIn('Backlog')).toEqual(['Alpha']));
  expect(recorder.snapshots[recorder.snapshots.length - 1]).toBe(AT_MOUNT);
  return recorder.snapshots.length;
}

/** Drop `Alpha` onto `Xray` — slot 0 of "In Progress" — exactly as the board would. */
async function dropAlphaOntoXray() {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 'a' }, over: { id: 'x' } });
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

describe('ObjectKanban — a cross-column drop loses the landing position too (#8826 Q3)', () => {
  it('LIT POSITIVE CONTROL: the drop does produce a new `columns` snapshot, carrying the membership change', async () => {
    // The card's own control. Without it, "the drop order never appears" would
    // be indistinguishable from a recorder that was never wired up.
    const before = await mountBoard('internal', makeDataSource(acceptingUpdate() as never));

    await dropAlphaOntoXray();

    const fresh = recorder.snapshots.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    const latest = fresh[fresh.length - 1];
    // Membership DID flow back: `Alpha` left `backlog` and is in `in_progress`.
    expect(latest).not.toBe(AT_MOUNT);
    expect(latest).toMatch(/^backlog: \| in_progress:/);
    expect(latest).toContain('Alpha');
  });

  it('DEAD NEGATIVE CONTROL: a drag that ends on nothing records no snapshot and writes nothing', async () => {
    const update = acceptingUpdate();
    const before = await mountBoard('internal', makeDataSource(update as never));

    await act(async () => {
      dnd.onDragEnd!({ active: { id: 'a' }, over: null });
    });

    expect(recorder.snapshots.slice(before)).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it('THE MEASUREMENT (internal data): the drop order is never recorded — the prop comes back in RECORD order', async () => {
    const before = await mountBoard('internal', makeDataSource(acceptingUpdate() as never));

    await dropAlphaOntoXray();

    // The whole reading: across every snapshot this board has ever received,
    // the order the user dropped in is not among them.
    expect(recorder.snapshots).not.toContain(DROP_ORDER);
    expect(recorder.snapshots.slice(before)).toEqual([RECORD_ORDER]);
  });

  it('THE MEASUREMENT (internal data): the card is never in the dropped slot', async () => {
    await mountBoard('internal', makeDataSource(acceptingUpdate() as never));

    await dropAlphaOntoXray();

    // Dropped at slot 0; on screen at slot 2. Two things agree on that now:
    // the branch appends rather than honouring the drop index, and the
    // optimistic write re-renders the board, which re-buckets and re-syncs the
    // mirror from the prop. Before objectui#8826 this was a visible snap out of
    // slot 0 inside this same act.
    expect(cardsIn('In Progress')).toEqual(['Xray', 'Yankee', 'Alpha']);
    expect(cardsIn('Backlog')).toEqual([]);
  });

  it('THE ASYMMETRY (external data): still no snapshot at all — and the dropped slot is no longer claimed', async () => {
    const before = await mountBoard('external', makeDataSource(acceptingUpdate() as never));

    await dropAlphaOntoXray();

    // The optimistic write is skipped on this ownership, so nothing re-renders
    // and `KanbanImpl`'s mirror is never reset — the local move stands, and on
    // this path it is the ONLY thing the user sees until the parent reflows.
    // That is exactly why it may not encode the drop index: this board would
    // otherwise hold a position no reload reproduces, indefinitely.
    expect(recorder.snapshots.slice(before)).toEqual([]);
    // ⚠️ `Alpha` is last in the record array, so appended and record order are
    // the same list here. What this distinguishes is the DROPPED slot (`Alpha`
    // first) from everything else — which is the claim that was removed.
    expect(cardsIn('In Progress')).toEqual(['Xray', 'Yankee', 'Alpha']);
    expect(cardsIn('In Progress')).not.toEqual(['Alpha', 'Xray', 'Yankee']);
    // ...and the order is still persisted nowhere: the next reflow from the
    // parent will carry membership and not order.
  });

  it('THE WIRE: the landing index reaches no sink — the write body carries the column and nothing else', async () => {
    for (const mode of ['internal', 'external'] as const) {
      const update = acceptingUpdate();
      await mountBoard(mode, makeDataSource(update as never));

      await dropAlphaOntoXray();

      expect(update).toHaveBeenCalledTimes(1);
      // Exact body, not a subset match: an added positional key must fail here.
      expect(update).toHaveBeenCalledWith('task', 'a', { status: 'in_progress' });
      cleanup();
      recorder.snapshots.length = 0;
      dnd.onDragEnd = undefined;
    }
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8827 — the board's empty state hangs on SETTLED, not on "zero rows".
 *
 * ## The defect, as measured
 *
 * `KanbanRenderer` loads `KanbanImpl` behind `React.lazy`, and nothing orders
 * the chunk's arrival against the records' arrival (objectui#8534's second
 * half; the mirror half was closed by PR #8825 and is NOT this). On the
 * production shape — lanes derived synchronously from `schema.columns`, rows
 * arriving from `ObjectKanban`'s query — the two orderings were measured on
 * post-#8825 `main` and they DIVERGE:
 *
 *   - data wins: the Suspense skeleton covers the whole window, nothing is
 *     announced;
 *   - chunk wins: `KanbanImpl`'s first committed frame carries the authored
 *     lanes with zero cards, satisfies `totalCardCount === 0 &&
 *     boardColumns.length > 1`, and paints `DataEmptyState` —
 *     `role="status" aria-live="polite"`, titled "No cards" — while the rows
 *     are STILL IN FLIGHT. A false claim, announced to assistive technology.
 *
 * The only thing hiding it was the lazy skeleton happening to be slower than
 * the fetch, and nothing makes it slower.
 *
 * ## ⚠️ Why the reverse test below is not optional
 *
 * The forward test alone proves nothing: DELETING the empty state entirely
 * would make it green. The regression it cannot see is named in
 * `ObjectKanban.tsx` itself — "gating on a truthy definition would leave those
 * boards empty forever". So every settle exit gets a test that a GENUINELY
 * empty board still paints `DataEmptyState`: the query returning no rows, a
 * board with no readable source, inline data, and the schema-only `kanban-ui`
 * entry which has no provider at all and must therefore DEFAULT to settled.
 *
 * ## ⚠️ Rig self-checks, and why they are assertions rather than comments
 *
 * The first measurement run of this race had too small a flush budget: the
 * chunk never landed, all four orderings sat on the Suspense fallback, and
 * "the orderings look identical" read as a finding when it was an instrument
 * that had never connected. Every test here that depends on the chunk being
 * held ASSERTS that it is held (fallback on screen, board not mounted) and
 * ASSERTS the end state it converges to. A run that fails to reproduce the
 * race goes RED; it can never read as a pass.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban` and `kanban-ui`.
import { KanbanRenderer } from '../index';
import '../index';

/**
 * Holds `index.tsx`'s `React.lazy(() => import('./KanbanImpl'))` open so the
 * chunk's arrival can be ordered against the records'. `vi.mock`'s factory runs
 * once, on the FIRST import of the module — so the only test that can observe a
 * held chunk is the first one to mount a board, and that test asserts the chunk
 * IS held rather than assuming it.
 */
const chunkGate = vi.hoisted(() => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release: () => release() };
});

vi.mock('../KanbanImpl', async (importOriginal) => {
  await chunkGate.promise;
  return await importOriginal<typeof import('../KanbanImpl')>();
});

const LANES = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
];

const ROWS = [
  { id: '1', name: 'Alpha', status: 'todo' },
  { id: '2', name: 'Beta', status: 'in_progress' },
];

/** The board itself, as opposed to the Suspense skeleton standing in for it. */
const boardIsMounted = () =>
  !!document.querySelector('[role="region"][aria-label^="Kanban board"]') ||
  !!document.querySelector('[role="list"][aria-label$=" cards"]');

/** The live-region empty state — the thing that must never be a false claim. */
const emptyState = () => document.querySelector('[role="status"][aria-live="polite"]');

/** Every "No cards" string on screen, board-level live region and per-lane placeholder alike. */
const noCardsTextCount = () =>
  [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'No cards',
  ).length;

/**
 * Pump the event loop inside `act` until `pred()` holds or the budget expires,
 * and REPORT whether it did. Callers assert on the return value: a rig that
 * never completed must not read as "no difference".
 */
async function pumpUntil(pred: () => boolean, budgetMs = 5000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  return pred();
}

/** A deferred promise, so `find` can be left in flight for as long as a test needs. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderObjectKanban(adapter: unknown, extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'deal',
            groupBy: 'status',
            cardTitle: 'name',
            columns: LANES,
            ...extra,
          } as never
        }
      />
    </SchemaRendererProvider>,
  );
}

beforeEach(() => {
  cleanup();
});

describe('objectui#8827 — forward: the chunk winning the race announces NOTHING', () => {
  it('paints no empty state while the records are still in flight', async () => {
    const rows = deferred<{ data: unknown[] }>();
    const find = vi.fn(() => rows.promise);
    const adapter = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

    renderObjectKanban(adapter);

    // RIG SELF-CHECK 1 — the chunk really is held. If this file is ever
    // reordered so another test resolves `../KanbanImpl` first, this goes RED
    // rather than letting the test below pass without reproducing the race.
    expect(boardIsMounted()).toBe(false);

    // The board's own query is in flight before the chunk is released: this is
    // the ordering under test, and the reason `find` is a deferred promise.
    await waitFor(() => expect(find).toHaveBeenCalled());

    // ── The chunk wins the race ────────────────────────────────────────────
    chunkGate.release();
    const mounted = await pumpUntil(boardIsMounted);
    // RIG SELF-CHECK 2 — if the chunk never landed, every assertion below is
    // about a Suspense fallback and "no empty state" is an artefact of an
    // instrument that never connected, not a reading.
    expect(mounted).toBe(true);

    // The lanes ARE on screen — the fix withholds the CLAIM ABOUT THE DATA, it
    // does not withhold the board. Without this the test would also pass on a
    // change that simply stopped rendering anything.
    expect(screen.getByLabelText('To Do cards')).toBeTruthy();
    expect(screen.getByLabelText('In Progress cards')).toBeTruthy();
    expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(0);

    // ── The reading this card exists for ───────────────────────────────────
    // RED before the fix: `DataEmptyState` with role=status/aria-live=polite
    // and the title "No cards", painted over rows that had not arrived.
    expect(emptyState()).toBeNull();
    expect(noCardsTextCount()).toBe(0);

    // ── The records finally arrive ─────────────────────────────────────────
    await act(async () => {
      rows.resolve({ data: ROWS });
      await rows.promise;
    });
    const settled = await pumpUntil(() => document.querySelectorAll('[role="listitem"]').length >= 2);
    // RIG SELF-CHECK 3 — end state. Both events have happened, so the finished
    // board must carry every card; if it does not, everything above describes
    // a run that never completed.
    expect(settled).toBe(true);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    // Rows arrived, so there is nothing empty to announce.
    expect(emptyState()).toBeNull();
  });
});

describe('objectui#8827 — reverse: a genuinely empty board STILL announces', () => {
  /**
   * ⚠️ These are the tests the forward one cannot replace. Deleting
   * `DataEmptyState` outright, or gating it on something that never becomes
   * true, turns the forward test green and every test here red.
   */

  it('exit 1 — the query settles with NO rows: the empty state appears', async () => {
    const find = vi.fn(async () => ({ data: [] }));
    const adapter = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

    renderObjectKanban(adapter);

    // A real wait on a real appearance: if the settle never lands, this times
    // out and the file is red — which is exactly the "empty forever"
    // regression `ObjectKanban.tsx:276` names.
    await waitFor(() => expect(emptyState()).not.toBeNull());
    expect(emptyState()!.textContent).toContain('No cards');
    expect(find).toHaveBeenCalled();
  });

  it('exit 3 — NO readable source (adapter without `find`): the empty state appears', async () => {
    // Settled with nothing, exactly as `useSettledSchema` settles when there is
    // nothing to read from. A board waiting on a query that will never be
    // issued is the regression, not the fix.
    const adapter = { findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

    renderObjectKanban(adapter);

    await waitFor(() => expect(emptyState()).not.toBeNull());
    expect(emptyState()!.textContent).toContain('No cards');
  });

  it('exit 3 — NO dataSource at all: the empty state appears', async () => {
    // `object-kanban` reads its adapter from the renderer context, so the
    // provider stays — what is absent is the DATA SOURCE, which is the
    // "nothing to read from" exit under test.
    render(
      <SchemaRendererProvider dataSource={undefined as never}>
        <SchemaRenderer
          schema={
            {
              type: 'object-kanban',
              objectName: 'deal',
              groupBy: 'status',
              columns: LANES,
            } as never
          }
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(emptyState()).not.toBeNull());
    expect(emptyState()!.textContent).toContain('No cards');
  });

  it('exit 4 — inline `data` is settled FROM THE FIRST FRAME, not after a fetch', async () => {
    // The rows arrived whole with the render; no query is issued at all, so a
    // settle that depended on one would strand this board.
    const find = vi.fn(async () => ({ data: ROWS }));
    const adapter = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

    renderObjectKanban(adapter, { data: [] });

    await waitFor(() => expect(emptyState()).not.toBeNull());
    expect(emptyState()!.textContent).toContain('No cards');
    // The inline branch really is the one under test: `rawData`'s precedence
    // puts `schema.data` ahead of `fetchedData`, and the effect never queries.
    expect(find).not.toHaveBeenCalled();
  });

  it('exit 5 — the schema-only `KanbanRenderer` path has NO provider and DEFAULTS to settled', async () => {
    // No `ObjectKanban` on this path, so nothing supplies the signal. Its rows
    // arrive whole from their author and are settled by construction; the
    // context default is what says so. A default of `false` would leave every
    // authored board that happens to be empty silent forever.
    //
    // ⚠️ Driven by rendering `KanbanRenderer` DIRECTLY. It used to be reached
    // through the `kanban-ui` registry key, which RETIRED (objectui#8257) —
    // ⛔ and re-pointing this leg at `object-kanban` would have destroyed it
    // rather than moved it: that key resolves to `ObjectKanbanRenderer`, which
    // DOES mount `ObjectKanban` and therefore DOES supply the provider, so the
    // "no provider" premise would be false and the assertion would pass for the
    // wrong reason. The component is unchanged; only the lookup is gone.
    render(<KanbanRenderer schema={{ type: 'object-kanban', groupBy: 'status', columns: LANES, data: [] } as never} />);

    await waitFor(() => expect(emptyState()).not.toBeNull());
    expect(emptyState()!.textContent).toContain('No cards');
  });
});

describe('objectui#8827 — the per-lane placeholder is the same claim and takes the same gate', () => {
  /**
   * `KanbanColumnView` renders the SAME `kanban.noCards` string inside any lane
   * with no cards, suppressed only when the board-level empty state is already
   * saying it. When this was written, `isBoardEmpty` additionally required
   * `boardColumns.length > 1`, so on a SINGLE-lane board the board-level gate
   * never ran and the placeholder was the only thing on screen, still claiming
   * "No cards" over rows in flight. Gating only the live region would have left
   * the false claim alive on exactly the boards the live region never covered.
   *
   * ⚠️ objectui#9045 has since made `isBoardEmpty` blind to the lane count, so
   * a settled single-lane empty board now reaches the BOARD-level region and
   * the placeholder gives way to it. ⭐ Both legs below are unchanged and both
   * still measure what they always did: nothing may say "No cards" while the
   * rows are in flight, and something must say it once they settle with none.
   * ⛔ What changed is which element says it, which neither leg reads —
   * `emptyStateLaneCountBlind-9045.test.tsx` is where that is pinned.
   */
  const ONE_LANE = [{ id: 'todo', title: 'To Do' }];

  it('withholds the single-lane placeholder while the records are in flight, then paints it', async () => {
    const rows = deferred<{ data: unknown[] }>();
    const find = vi.fn(() => rows.promise);
    const adapter = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };

    renderObjectKanban(adapter, { columns: ONE_LANE });

    // The lane is on screen and its query is in flight — the state in which
    // nothing may claim the board is empty.
    const laneUp = await pumpUntil(() => !!document.querySelector('[role="list"][aria-label="To Do cards"]'));
    expect(laneUp).toBe(true);
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(noCardsTextCount()).toBe(0);

    // Settling with nothing is a settled answer, and now it may be said.
    await act(async () => {
      rows.resolve({ data: [] });
      await rows.promise;
    });
    await waitFor(() => expect(noCardsTextCount()).toBeGreaterThan(0));
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9045 — the board's empty state is about CARDS, not about LANES.
 *
 * ## The defect, as measured on the parent commit
 *
 * `KanbanImpl` derived its board-level empty state from
 * `totalCardCount === 0 && boardColumns.length > 1`. The second conjunct is a
 * LANE COUNT, and it made the announcement unreachable on exactly two shapes:
 *
 *   - a ZERO-lane board — no lanes at all, so nothing on screen says anything;
 *   - a ONE-lane board — the board-level live region never painted, and the
 *     only "No cards" string was the lane's own dashed placeholder, a plain
 *     `span` with no `role` and no `aria-live`.
 *
 * ⇒ On both, a screen-reader user was told nothing. `DataEmptyState` is the
 * only `role="status" aria-live="polite"` region on the board, and the lane
 * count decided whether it existed.
 *
 * ## ⭐ Why the premise is LIVE rather than theoretical
 *
 * A lane-less `object-kanban` document could not pass validation until
 * objectui#9021 made `ObjectKanbanSchema.groupBy` optional, as the protocol
 * declares it. The `ZERO LANES` legs below author exactly that document —
 * `{ type: 'object-kanban', objectName }` with no lane key and no `columns` —
 * and `LIVE PREMISE` asserts it still parses green on this tree, so the shape
 * these legs measure is one an author can actually write.
 *
 * ## ⚠️ What the lane count was NOT doing — measured, not assumed
 *
 * The obvious reading of `boardColumns.length > 1` is that it separated "still
 * loading" from "genuinely empty" — a board mid-flight can look lane-less. It
 * did not, and the `STILL LOADING` legs are how that is established rather
 * than argued: the loading/settled distinction is carried by a SEPARATE
 * conjunct, `recordsSettled` (objectui#8827), which this card does not touch.
 * Those legs drive a zero-lane and a one-lane board with their query held in
 * flight and assert nothing is announced, then release the query and assert
 * the announcement arrives. Both halves are required: the first alone would
 * stay green if the empty state were deleted outright.
 *
 * ## ⚠️ The one-lane board is now treated exactly like a multi-lane one
 *
 * `suppressEmptyPlaceholder` is deliberately left alone. Its own stated reason
 * is that the board-level empty state is already saying it, so a per-lane copy
 * would be a duplicate — and on a one-lane empty board that reason is now TRUE
 * where it used to be vacuous. So the lane's dashed placeholder gives way to
 * the live region, which is the treatment a multi-lane empty board has always
 * had. `ONE LANE` asserts the announcement AND that it is not doubled.
 *
 * ## ⚠️ Which legs are CONTROLS and are ⛔ not evidence of this fix
 *
 * `NON-REGRESSION` marks the two multi-lane legs. Both were already correct
 * before this card and both are unchanged by it; they are here to catch a
 * repair that widened the predicate into "always announce" or narrowed it into
 * "never announce". ⛔ Do not read them as showing that anything was fixed.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanbanSchema, safeValidateSchema } from '@object-ui/types/zod';
// Registers `object-kanban`.
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

const TWO_LANES = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
];
const ONE_LANE = [{ id: 'todo', title: 'To Do' }];

const ROWS = [
  { id: '1', name: 'Alpha', status: 'todo' },
  { id: '2', name: 'Beta', status: 'in_progress' },
];

/**
 * The board's only live region — `role="status" aria-live="polite"`, titled
 * "No cards". Queried off `document` rather than a render container so a
 * portalled subtree could not read as an absence.
 */
const liveRegion = () => document.querySelector('[role="status"][aria-live="polite"]');

/** Whether the board ANNOUNCES, as assistive technology would learn of it. */
const announces = () => {
  const el = liveRegion();
  return !!el && (el.textContent ?? '').includes('No cards');
};

/** Every "No cards" string on screen — live region and per-lane placeholder alike. */
const noCardsTextCount = () =>
  [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'No cards',
  ).length;

/** A deferred promise, so `find` can be left in flight for as long as a leg needs. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Pump the event loop inside `act` until `pred()` holds or the budget expires,
 * and REPORT whether it did — a rig that never completed must not read as an
 * absence.
 */
async function pumpUntil(pred: () => boolean, budgetMs = 3000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  return pred();
}

function renderBoard(schema: Record<string, unknown>, rows: unknown) {
  const find = vi.fn(() =>
    rows instanceof Promise ? rows : Promise.resolve({ data: rows, total: (rows as unknown[]).length }),
  );
  const dataSource = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const result = render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <SchemaRenderer schema={{ objectName: 'deal', cardTitle: 'name', ...schema } as never} />
    </SchemaRendererProvider>,
  );
  return { ...result, find };
}

/**
 * Settle the board and PROVE it settled: the query must have been issued and
 * resolved before any "nothing is announced" reading is taken, or the reading
 * is about a board that is merely still loading.
 */
async function settle(find: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(find).toHaveBeenCalled());
  await pumpUntil(() => true, 50);
}

afterEach(cleanup);

describe('objectui#9045 — LIVE PREMISE: a lane-less board is a document an author may write', () => {
  it('parses green on both published faces, so the ZERO-lane legs measure a reachable shape', () => {
    const laneless = { type: 'object-kanban', objectName: 'deal' };
    expect(
      ObjectKanbanSchema.safeParse(laneless).success,
      'objectui#9021 made `groupBy` optional; without that this shape is unauthorable',
    ).toBe(true);
    expect(safeValidateSchema(laneless).success, 'the union entry path must agree').toBe(true);
  });
});

describe('objectui#9045 — ZERO LANES: an empty lane-less board announces', () => {
  it('paints the live region once its records have settled with nothing', async () => {
    const { find } = renderBoard({ type: 'object-kanban' }, []);
    await settle(find);
    const announced = await pumpUntil(announces);
    expect(announced, 'a zero-lane board holds no cards and must say so').toBe(true);
    expect((liveRegion()!.textContent ?? '')).toContain('No cards');
  });

  it('STILL LOADING — announces NOTHING while its query is in flight, then announces once it lands', async () => {
    const rows = deferred<{ data: unknown[] }>();
    const { find, container } = renderBoard({ type: 'object-kanban' }, rows.promise);

    // Lit control for the absence below: the board is really mounted and its
    // query is really outstanding, so "nothing announced" is a reading about a
    // loading board rather than about a board that never rendered.
    const mounted = await pumpUntil(
      () => !!container.querySelector('[role="region"][aria-label="Kanban board"]'),
    );
    expect(mounted, 'RIG SELF-CHECK: the board must be on screen').toBe(true);
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(announces(), 'nobody may claim the board is empty before the answer arrives').toBe(false);

    // Settling with nothing IS a settled answer, and now it may be said.
    await act(async () => {
      rows.resolve({ data: [] });
      await rows.promise;
    });
    const announced = await pumpUntil(announces);
    expect(announced, 'withholding it forever is the regression this must not trade for').toBe(true);
  });
});

describe('objectui#9045 — ONE LANE: an empty single-lane board announces, exactly once', () => {
  it('paints the live region, and does not also leave the lane placeholder saying it', async () => {
    const { find } = renderBoard({ type: 'object-kanban', groupBy: 'status', columns: ONE_LANE }, []);
    await settle(find);
    const announced = await pumpUntil(announces);
    expect(announced, 'one lane is still a board that holds no cards').toBe(true);
    expect(
      noCardsTextCount(),
      'the board-level region says it; a per-lane copy would be a duplicate',
    ).toBe(1);
  });

  it('LIT CONTROL — the same single-lane board WITH a card announces nothing', async () => {
    const { find, container } = renderBoard(
      { type: 'object-kanban', groupBy: 'status', columns: ONE_LANE },
      [ROWS[0]],
    );
    await settle(find);
    // The card really landed — this is what makes the silence below a reading
    // about a populated board rather than about a board that never got rows.
    await waitFor(() => expect(container.textContent).toContain('Alpha'));
    expect(announces(), 'a board holding a card is not empty, whatever its lane count').toBe(false);
  });

  it('STILL LOADING — announces NOTHING while its query is in flight, then announces once it lands', async () => {
    const rows = deferred<{ data: unknown[] }>();
    const { find } = renderBoard(
      { type: 'object-kanban', groupBy: 'status', columns: ONE_LANE },
      rows.promise,
    );

    // Lit control: the lane itself is on screen and the query is outstanding.
    const laneUp = await pumpUntil(
      () => !!document.querySelector('[role="list"][aria-label="To Do cards"]'),
    );
    expect(laneUp, 'RIG SELF-CHECK: the lane must be on screen').toBe(true);
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(announces(), 'nobody may claim the board is empty before the answer arrives').toBe(false);

    await act(async () => {
      rows.resolve({ data: [] });
      await rows.promise;
    });
    const announced = await pumpUntil(announces);
    expect(announced).toBe(true);
  });
});

describe('objectui#9045 — NON-REGRESSION: the multi-lane readings are unchanged by this card', () => {
  it('⛔ NOT evidence of this fix — a multi-lane board WITH cards still announces nothing', async () => {
    const { find, container } = renderBoard(
      { type: 'object-kanban', groupBy: 'status', columns: TWO_LANES },
      ROWS,
    );
    await settle(find);
    await waitFor(() => expect(container.textContent).toContain('Alpha'));
    expect(announces()).toBe(false);
  });

  it('⛔ NOT evidence of this fix — a multi-lane board with NO cards still announces, as it always did', async () => {
    const { find } = renderBoard(
      { type: 'object-kanban', groupBy: 'status', columns: TWO_LANES },
      [],
    );
    await settle(find);
    const announced = await pumpUntil(announces);
    expect(announced).toBe(true);
  });
});

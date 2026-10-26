/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree` reads its `find()` answer as `QueryResult` DECLARES it — and
 * does NOT read `records` (objectui#6839).
 *
 * ⭐ This module reaches the shared reader INDIRECTLY, and that is the whole
 * reason it needs its own pin. It does not call `extractRecords` at all: it
 * hands its `find()` answer to `applyNonGridRowCeiling` (`@object-ui/react`),
 * which unwraps it. A card that enumerated the helper's direct callers would
 * not list this file, and a repo-wide "nothing reads `records`" assertion would
 * pass over it in silence — so the route itself is what is measured here, at
 * the rows the forest draws.
 *
 * MEASURED for this module: no `find()` in `plugin-tree`, nor in any app or
 * example mounting a tree, emits a `records` envelope — the package's single
 * `records:` occurrence is a `buildForest(records: any[], …)` parameter name.
 * CONTROL, so the zero is a reading: the same sweep finds a live `find()`
 * double emitting `{ records: [...] }` at `plugin-list`'s ObjectGallery, a
 * consumer with its own unwrap ladder.
 *
 * ⚠️ The refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it: same rows, same mount.
 *
 * ## ⭐ Why the two outcomes wait DIFFERENTLY
 *
 * This file used to hand all three cases ONE wait, and it went red on `main`
 * on PRs that cannot reach `plugin-tree` at all — `expected 1 to be 2`.
 *
 * That wait was `container.querySelector('[data-testid="object-tree"]') ??
 * queryByText('No records')`, and the row count was read the instant it passed.
 * The testid is on the TABLE WRAPPER, so it is a MOUNT signal, not a rows
 * signal — and the rows this file counts arrive at a LATER commit than the
 * table does.
 *
 * MEASURED, the mechanism is one race, in `ObjectTree` itself: expansion is a
 * `useState<Set<string>>(new Set())` MIRROR that a `useEffect` keyed on
 * `[roots, defaultExpandedDepth]` re-seeds from the forest. Rows are then
 * `flattenVisible(roots, expanded)`. So when `find()`'s rows land, the commit
 * that first paints the table still carries the PREVIOUS (empty) mirror: the
 * root draws, its child does not, and `tbody tr` is 1. The mirror is seeded in
 * the passive effect that follows, and a second commit takes it to 2. Probed
 * on this file's own fixture, the DOM sequence is exactly
 * `loading → table:1rows → table:2rows`, and the OLD wait's first passing state
 * was `table:1rows`, where it yielded 1 — the CI failure, by construction and
 * not by luck. Which of the two commits the read lands on is decided by machine
 * load, which is why it was green locally and red on a saturated shard.
 *
 * ⚠️ NOT the same shape as the `plugin-kanban` twin (objectui#8532 / PR #8533),
 * although it is the same family. That board had TWO independent races —
 * `React.lazy(() => import('./KanbanImpl'))` chunk reveal AND a prop-mirrored
 * `boardColumns` — and its symptom was `expected +0 to be 2`, nothing drawn at
 * all. `plugin-tree` has NO lazy boundary anywhere in its source (`index.tsx`
 * imports `./ObjectTree` eagerly), so only the mirrored-state half transfers,
 * and the symptom is a PARTIAL draw: the root without its child.
 *
 * The two outcomes therefore no longer share a wait:
 *
 *   - the POSITIVE arms wait FOR the DESCENDANT row — the row that only exists
 *     once the mirror has been seeded. That is the condition the race is
 *     about, so waiting on it is what makes these arms immune to which commit
 *     the read lands on. It is NOT a wider window on the same race, which is
 *     all a raised timeout would have bought. They then assert the drawn SHAPE
 *     (label + depth per row) plus the root's toggle reading `Collapse`, so the
 *     pin is the seeded-open hierarchy and not merely "eventually 2 rows" — a
 *     count alone is also satisfied by a tree that flattens everything.
 *   - the REFUSAL arm cannot wait for an absence, so it takes a SETTLED read
 *     anchored on something that DOES appear in that scenario: the tree's own
 *     "No records" panel, which `ObjectTree` renders only once `loading` has
 *     flipped false. Probed on the `records` fixture the sequence is
 *     `loading → empty-state` with no table at any point, and the panel is
 *     absent while loading — so this arm cannot pass by timing out on an
 *     absence, which is the failure mode every absence-shaped pin has.
 *
 * ⛔ Do not fold these back into one wait, and ⛔ do not "fix" a future red here
 * with a longer timeout: the failure was never slowness, it was reading a
 * signal that does not carry the answer.
 *
 * ## ⚠️ The race described above was FIXED in the component (objectui#8666)
 *
 * Everything above stands as the record of why these waits are shaped the way
 * they are, but one of its statements is no longer true of `ObjectTree`:
 * expansion is no longer a `useState` mirror re-seeded from a `useEffect`, so
 * the `loading → table:1rows → table:2rows` sequence it measures is now
 * `loading → table:2rows` and the intermediate one-row commit does not happen.
 * The new shape and both halves of its contract are pinned in
 * `ObjectTree.expandedDerived-8666.test.tsx`.
 *
 * ⭐ NOTHING IN THIS FILE CHANGED FOR THAT, and the note exists to say why the
 * absence of a change is deliberate. No assertion here was standing on the
 * two-commit sequence: the positive arms wait FOR the descendant row, which is
 * a condition on the settled forest and not on how many commits produced it, so
 * they were green before objectui#8666 and are green after it. The reason to
 * keep them as they are is the one the section above gives — the table's
 * `data-testid` is a MOUNT signal and the rows are what this file counts, which
 * stays true no matter how many commits the component takes to get there.
 */

import React from 'react';
import { render, waitFor, cleanup, within, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTree } from './ObjectTree';

// objectui#6892 slice 9 — inherit the real surface through `<any>` rather than
// `typeof import('@object-ui/plugin-detail')`. `plugin-tree` does NOT declare
// that package and `ObjectTree`'s module graph reaches zero of its modules, so
// a type-position `import()` of it would be a real specifier to
// `check-phantom-dependencies`, which would then correctly demand a dependency
// the runtime does not have.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...((await importOriginal<any>()) as Record<string, unknown>),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const ROWS = [
  { id: '1', name: 'Root', parent_id: null },
  { id: '2', name: 'Child', parent_id: '1' },
];

const schema: any = {
  type: 'object-tree',
  objectName: 'node',
  tree: { parentField: 'parent_id', labelField: 'name' },
  data: { provider: 'object', object: 'node' },
};

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/** One row the forest actually painted, as the tree-grid describes it. */
interface DrawnRow {
  readonly label: string;
  readonly depth: number;
}

/**
 * Everything this file reads off a settled tree.
 *
 * `tableDrawn` and `emptyPanelDrawn` are carried SEPARATELY rather than
 * collapsed into a row count: `ObjectTree` returns early on an empty forest and
 * never mounts the table, so a refused envelope and a mount that never rendered
 * are DIFFERENT DOM, not both "zero rows". Reporting which one happened is what
 * keeps them distinguishable.
 */
interface Settled {
  readonly rows: readonly DrawnRow[];
  readonly tableDrawn: boolean;
  readonly emptyPanelDrawn: boolean;
  /** The root row's toggle, by accessible name — the mirror's state, named. */
  readonly rootToggle: string | null;
}

/** The rows the tree-grid has painted, in document order. */
function drawnRows(container: HTMLElement): DrawnRow[] {
  return Array.from(
    container.querySelectorAll('tbody tr[data-testid="object-tree-row"]'),
  ).map((tr) => ({
    label: (tr.querySelector('td')?.textContent ?? '').trim(),
    depth: Number(tr.getAttribute('data-depth')),
  }));
}

/**
 * Has the tree drawn its own "No records" panel?
 *
 * ⚠️ `queryAllByText`, not `queryByText`: the singular form THROWS on multiple
 * matches as well as answering `null` on none, so it cannot express "how many"
 * without the throw becoming the result.
 */
function emptyPanelDrawn(container: HTMLElement): boolean {
  return within(container).queryAllByText('No records').length > 0;
}

function readSettled(container: HTMLElement): Settled {
  const root = container.querySelector('tbody tr[data-depth="0"]');
  return {
    rows: drawnRows(container),
    tableDrawn: container.querySelector('[data-testid="object-tree"]') !== null,
    emptyPanelDrawn: emptyPanelDrawn(container),
    rootToggle: root?.querySelector('button')?.getAttribute('aria-label') ?? null,
  };
}

/**
 * What a case expects the tree to settle on — which is also what decides HOW it
 * waits. See this file's header.
 */
type Outcome =
  /** Wait FOR that shape. `because` is carried into the timeout message. */
  | { readonly draws: readonly DrawnRow[]; readonly because: string }
  /** No absence to wait for: anchor on the empty panel, settle, then read. */
  | { readonly refuses: true };

const REFUSES: Outcome = { refuses: true };

/**
 * Mount the tree over a `find()` answering `envelope`, and hand back what it
 * settled on once `outcome` says it has settled.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 *
 * ⚠️ The predicates BELOW are inside `waitFor` on purpose and stay sound under
 * that same rule: `drawnRows` and `emptyPanelDrawn` are pure reads of a
 * container that is already mounted. They mount nothing, so re-running them on
 * a DOM mutation is free — which is exactly the property this helper itself
 * does not have.
 */
async function settledOn(envelope: Envelope, outcome: Outcome): Promise<Settled> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'node',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text' },
        parent_id: { name: 'parent_id', type: 'text' },
      },
    })),
  };
  const { container } = render(<ObjectTree schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it "no rows" is satisfied by the mount's initial
  // empty state, which every arm renders identically.
  await find.mock.results[0].value;

  if ('refuses' in outcome) {
    // A refusal has no arrival to wait for, so this is a SETTLED read built
    // from the two things that CAN be observed: `find` has answered (above),
    // and the tree has drawn the "No records" panel — a node it renders only
    // after `loading` flips false, so it is a COMPLETION ANCHOR and not the
    // mere passage of time. `act` then flushes what React still had queued; it
    // is the opposite of widening a timeout.
    await waitFor(() =>
      expect(
        emptyPanelDrawn(container),
        'the tree must have drawn its own "No records" panel before it is read — without that anchor an absence assertion passes by timing out',
      ).toBe(true),
    );
    await act(async () => {});
    return readSettled(container);
  }

  // Wait on the SHAPE, whose deepest row is the one the expansion mirror gates.
  // The table wrapper appears a commit earlier, carrying the root alone.
  await waitFor(() =>
    expect(drawnRows(container), outcome.because).toEqual(outcome.draws),
  );
  return readSettled(container);
}

/** Both positive arms draw the same seeded-open hierarchy. */
const OPEN_FOREST: readonly DrawnRow[] = [
  { label: 'Root', depth: 0 },
  { label: 'Child', depth: 1 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ObjectTree — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    const because = 'the declared rows member must still draw the whole forest';
    const settled = await settledOn(asData, { draws: OPEN_FOREST, because });
    expect(settled.rows, because).toEqual(OPEN_FOREST);
    // The CONDITION the wait above is keyed to, asserted rather than assumed:
    // the child is on screen because the root was seeded OPEN, not because the
    // tree flattens its forest regardless of expansion.
    expect(settled.rootToggle, 'the root must have settled open').toBe('Collapse');
    expect(settled.tableDrawn, 'the tree-grid must be the node that drew').toBe(true);
    expect(settled.emptyPanelDrawn, 'and not the empty panel').toBe(false);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    const because = 'the bare-array arm must still draw the whole forest';
    const settled = await settledOn(asBareArray, { draws: OPEN_FOREST, because });
    expect(settled.rows, because).toEqual(OPEN_FOREST);
    expect(settled.rootToggle, 'the root must have settled open').toBe('Collapse');
    expect(settled.tableDrawn, 'the tree-grid must be the node that drew').toBe(true);
    expect(settled.emptyPanelDrawn, 'and not the empty panel').toBe(false);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two nodes drew off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`. The tree now settles on its own
    // "No records" panel — a DIFFERENT node from the table, which is what makes
    // this a reading of the refusal rather than of a mount that never happened.
    const settled = await settledOn(asRecords, REFUSES);
    expect(
      settled.emptyPanelDrawn,
      'the refusal must be OBSERVED: the tree drew its "No records" panel',
    ).toBe(true);
    expect(
      settled.rows,
      'a `records` envelope must reach the forest as no rows at all, not as the rows it names',
    ).toEqual([]);
    expect(
      settled.tableDrawn,
      'a refused envelope must not mount the tree-grid at all',
    ).toBe(false);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree` DERIVES expansion during render, and a user's answer survives a
 * re-seed (objectui#8666).
 *
 * Two things are pinned here, and they are pinned separately because ONE of
 * them is satisfiable by an implementation strictly worse than the bug.
 *
 * ## 1 — the frames (`describe` "the commit sequence")
 *
 * Expansion used to be a `useState<Set<string>>(new Set())` MIRROR that a
 * passive `useEffect` keyed on `[roots, defaultExpandedDepth]` re-seeded from
 * the forest, with rows computed as `flattenVisible(roots, expanded)`. So the
 * commit that FIRST painted the table still carried the previous, empty mirror:
 * the root drew, its children did not, and a SECOND commit drew the seeded-open
 * forest. Probed in the DOM on this file's own fixture, the sequence was
 *
 *     loading → table:1rows → table:2rows
 *
 * and it is now
 *
 *     loading → table:2rows
 *
 * ⭐ MEASURED, not inferred: the recorder is a `React.Profiler` whose
 * `onRender` reads the container on EVERY commit of the tree's subtree, and
 * only CONSECUTIVE IDENTICAL snapshots collapse. A one-row table and a two-row
 * table are different snapshots, so an intermediate commit cannot be collapsed
 * away — which is why this recorder was able to show the defect before it was
 * fixed, and is the reason to trust the absence it now reports.
 *
 * ⚠️ The DEFERRED arm exists because a same-task pair of commits could
 * otherwise be argued to have batched rather than merged. `@testing-library`'s
 * `asyncWrapper` drains one macrotask before returning, so a `setTimeout(…, 0)`
 * deferral sits INSIDE that drain window and proves nothing about ordering;
 * the arm uses **50ms**, which lands the rows in their own task, well outside
 * it. Both arms record the same sequence.
 *
 * ## 2 — the feature (`describe` "the user's answer vs. a re-seed")
 *
 * ⛔ The frames pin ALONE is passed by "seed during render and ignore the
 * user's overrides" — an implementation that removes the intermediate commit
 * and answers the same thing for every input, destroying expand/collapse
 * entirely. That mutation is the reason this second group exists, and each of
 * its cases was OBSERVED RED under it.
 *
 * The composition rule those cases read (stated on `resolveExpanded`):
 *
 * > A new forest may re-seed, but a node the user deliberately opened or closed
 * > — and which is still in the forest — keeps the user's answer. Every other
 * > node, including a genuinely NEW one, takes the seed.
 *
 * Both halves are load-bearing, and they fail in OPPOSITE directions, so each
 * needs its own case:
 *
 *   - "re-seed and drop the overrides" is caught by the two SURVIVES cases —
 *     the collapse case and the expand case, which also prove the override map
 *     carries `false` and `true` and not merely "the user touched this".
 *   - "never re-seed" (freeze the seed on the first forest) is caught ONLY by
 *     the NEW-NODE case: the two survives cases pass under it, because a frozen
 *     seed leaves the user's answer alone.
 *
 * ⚠️ Rows are read by COUNTING nodes (`querySelectorAll` over
 * `tbody tr[data-testid="object-tree-row"]`) rather than by navigating to the
 * first match: `queryByText` THROWS on multiple matches, so it cannot express
 * "how many" without the throw becoming the result. Nothing here reads pixels —
 * happy-dom reports `clientWidth: 0`, so the indent is asserted through
 * `data-depth`, which is a real attribute, and never through the inline
 * `paddingLeft` it also carries.
 */

import React from 'react';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTree } from './ObjectTree';

// Same reason as `ObjectTree.contractEnvelope-6839.test.tsx` (objectui#6892
// slice 9): inherit the real surface through `<any>`, because `plugin-tree`
// does not declare `@object-ui/plugin-detail` and a type-position `import()`
// of it would be a real specifier to `check-phantom-dependencies`.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...((await importOriginal<any>()) as Record<string, unknown>),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

/* ────────────────────────── shared DOM readers ────────────────────────── */

/** One row the tree-grid painted: its label and its indent level. */
interface DrawnRow {
  readonly label: string;
  readonly depth: number;
}

function drawnRows(container: HTMLElement): DrawnRow[] {
  return Array.from(
    container.querySelectorAll('tbody tr[data-testid="object-tree-row"]'),
  ).map((tr) => ({
    label: (tr.querySelector('td')?.textContent ?? '').trim(),
    depth: Number(tr.getAttribute('data-depth')),
  }));
}

/**
 * The accessible name of one row's chevron — `Expand` or `Collapse`, i.e. the
 * resolved expansion answer for that node, NAMED rather than inferred from
 * whether a child happens to be on screen.
 */
function toggleLabel(container: HTMLElement, label: string): string | null {
  const row = Array.from(
    container.querySelectorAll('tbody tr[data-testid="object-tree-row"]'),
  ).find((tr) => (tr.querySelector('td')?.textContent ?? '').trim() === label);
  return row?.querySelector('button')?.getAttribute('aria-label') ?? null;
}

function clickToggle(container: HTMLElement, label: string): void {
  const row = Array.from(
    container.querySelectorAll('tbody tr[data-testid="object-tree-row"]'),
  ).find((tr) => (tr.querySelector('td')?.textContent ?? '').trim() === label);
  const button = row?.querySelector('button');
  if (!button) throw new Error(`no chevron on the row labelled "${label}"`);
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ───────────────────── 1. the commit sequence (frames) ───────────────────── */

const ROWS = [
  { id: '1', name: 'Root', parent_id: null },
  { id: '2', name: 'Child', parent_id: '1' },
];

const fetchedSchema: any = {
  type: 'object-tree',
  objectName: 'node',
  tree: { parentField: 'parent_id', labelField: 'name' },
  data: { provider: 'object', object: 'node' },
};

/**
 * One commit's worth of DOM, as a short face. `loading` / `empty` / `nothing`
 * are the three non-table states `ObjectTree` can return early with, kept
 * distinct so a sequence cannot read as "the table" when no table was drawn.
 */
function snapshot(container: HTMLElement): string {
  if (!container.querySelector('[data-testid="object-tree"]')) {
    const text = container.textContent ?? '';
    if (text.includes('Loading')) return 'loading';
    if (text.includes('No records')) return 'empty';
    return 'nothing';
  }
  return `table:${drawnRows(container).length}rows`;
}

/**
 * Mount the tree over a `find()` that answers after `delayMs`, recording the
 * DOM at every commit of its subtree.
 *
 * ⛔ `render` is called ONCE, outside every `waitFor` (objectui#7802): a
 * predicate that renders feeds itself on each DOM mutation and leaks a
 * container per run. The reads below ARE inside `waitFor` and stay sound under
 * the same rule, because they mount nothing.
 */
async function recordCommits(delayMs: number): Promise<string[]> {
  const find = vi.fn(async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { data: ROWS, total: ROWS.length };
  });
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

  // The container is created HERE rather than taken from `render`'s return,
  // because the recorder fires during the very first commit — before that
  // return value exists.
  const container = document.createElement('div');
  document.body.appendChild(container);

  const sequence: string[] = [];
  const onCommit = () => {
    const face = snapshot(container);
    if (sequence[sequence.length - 1] !== face) sequence.push(face);
  };

  render(
    <React.Profiler id="object-tree" onRender={onCommit}>
      <ObjectTree schema={fetchedSchema} dataSource={ds} />
    </React.Profiler>,
    { container },
  );

  // Wait FOR the descendant row — the row the expansion answer gates. The
  // table wrapper is a MOUNT signal and appeared a commit earlier on the
  // pre-fix component, which is the whole thing being measured.
  await waitFor(() =>
    expect(drawnRows(container).length, 'the seeded-open forest must arrive').toBe(2),
  );
  expect(
    toggleLabel(container, 'Root'),
    'the root must have settled OPEN — 2 rows is also what a tree that ignores expansion draws',
  ).toBe('Collapse');
  return sequence;
}

describe('ObjectTree — the commit sequence (objectui#8666)', () => {
  it('paints the seeded-open forest in the FIRST commit that has rows', async () => {
    const sequence = await recordCommits(0);
    expect(
      sequence.join(' -> '),
      'a commit drawing the table with FEWER rows than the seed asks for is the defect: ' +
        'the forest must never be painted collapsed and then re-painted open',
    ).toBe('loading -> table:2rows');
  });

  it('still paints it in one commit when the rows arrive in their own task', async () => {
    // 50ms, NOT 0: RTL's `asyncWrapper` drains one macrotask before returning,
    // so a 0ms deferral resolves inside that drain window and would leave the
    // ordering unforced. See this file's header.
    const sequence = await recordCommits(50);
    expect(
      sequence.join(' -> '),
      'rows landing outside the drain window must not reintroduce the collapsed frame',
    ).toBe('loading -> table:2rows');
  });
});

/* ────────── 2. the user's answer vs. a re-seed (the feature) ────────── */

//   Acme
//   ├─ Engineering
//   │  └─ Platform
//   └─ Sales
const FOREST_V1 = [
  { id: '1', name: 'Acme', parent_id: null },
  { id: '2', name: 'Engineering', parent_id: '1' },
  { id: '3', name: 'Platform', parent_id: '2' },
  { id: '4', name: 'Sales', parent_id: '1' },
];

/** The same four records, plus a subtree that was NOT there before. */
const FOREST_V2_WITH_NEW_SUBTREE = [
  ...FOREST_V1.map((r) => ({ ...r })),
  { id: '5', name: 'Ops', parent_id: null },
  { id: '6', name: 'Ops Platform', parent_id: '5' },
];

/** The same four records, freshly allocated — a new forest of the same shape. */
const FOREST_V2_SAME_SHAPE = FOREST_V1.map((r) => ({ ...r }));

function mountInline(rows: any[], extra: any = {}) {
  const schema: any = {
    type: 'object-tree',
    objectName: 'business_unit',
    parentField: 'parent_id',
    labelField: 'name',
    fields: ['name'],
    data: rows,
    ...extra,
  };
  return render(<ObjectTree schema={schema} data={rows} />);
}

function reseed(
  rerender: (ui: React.ReactElement) => void,
  rows: any[],
  extra: any = {},
): void {
  const schema: any = {
    type: 'object-tree',
    objectName: 'business_unit',
    parentField: 'parent_id',
    labelField: 'name',
    fields: ['name'],
    data: rows,
    ...extra,
  };
  rerender(<ObjectTree schema={schema} data={rows} />);
}

describe("ObjectTree — the user's answer vs. a re-seed (objectui#8666)", () => {
  it('keeps a node the user COLLAPSED when the forest identity changes', async () => {
    const { container, rerender } = mountInline(FOREST_V1);
    await waitFor(() => expect(drawnRows(container).length).toBe(4));

    clickToggle(container, 'Engineering');
    await waitFor(() =>
      expect(drawnRows(container).map((r) => r.label)).toEqual(['Acme', 'Engineering', 'Sales']),
    );

    // A NEW forest of the same shape: different record objects, so `roots` is
    // a different value and the seed is recomputed from scratch.
    reseed(rerender, FOREST_V2_SAME_SHAPE);
    await waitFor(() => expect(container.querySelector('[data-testid="object-tree"]')).toBeTruthy());

    expect(
      drawnRows(container).map((r) => r.label),
      "the re-seed must not re-open a node the user closed — that is the mutation 'seed during render and drop the overrides'",
    ).toEqual(['Acme', 'Engineering', 'Sales']);
    expect(
      toggleLabel(container, 'Engineering'),
      "and the chevron must still NAME the user's answer",
    ).toBe('Expand');
  });

  it('keeps a node the user EXPANDED below `defaultExpandedDepth` across a re-seed', async () => {
    // depth 0 seeds NOTHING open, so every open node here is one the user
    // opened — the `true` direction of the override map, which the collapse
    // case above cannot reach.
    const depth0 = { defaultExpandedDepth: 0 };
    const { container, rerender } = mountInline(FOREST_V1, depth0);
    await waitFor(() => expect(drawnRows(container).map((r) => r.label)).toEqual(['Acme']));

    clickToggle(container, 'Acme');
    await waitFor(() =>
      expect(drawnRows(container).map((r) => r.label)).toEqual(['Acme', 'Engineering', 'Sales']),
    );

    reseed(rerender, FOREST_V2_SAME_SHAPE, depth0);
    await waitFor(() => expect(container.querySelector('[data-testid="object-tree"]')).toBeTruthy());

    expect(
      drawnRows(container).map((r) => r.label),
      'a re-seed at depth 0 must not close a node the user opened',
    ).toEqual(['Acme', 'Engineering', 'Sales']);
    expect(toggleLabel(container, 'Acme'), 'the root must still read as open').toBe('Collapse');
    expect(
      toggleLabel(container, 'Engineering'),
      'and a node the user never touched must still take the seed, which at depth 0 is closed',
    ).toBe('Expand');
  });

  it('seeds a genuinely NEW subtree open while the override still holds', async () => {
    const { container, rerender } = mountInline(FOREST_V1);
    await waitFor(() => expect(drawnRows(container).length).toBe(4));

    clickToggle(container, 'Engineering');
    await waitFor(() =>
      expect(drawnRows(container).map((r) => r.label)).toEqual(['Acme', 'Engineering', 'Sales']),
    );

    // `Ops` and its child did not exist when the user clicked, so nothing the
    // user said covers them: they take the seed.
    reseed(rerender, FOREST_V2_WITH_NEW_SUBTREE);
    await waitFor(() => expect(drawnRows(container).length).toBe(5));

    expect(
      drawnRows(container),
      "the new subtree must arrive OPEN (a frozen seed leaves it closed) while the user's collapse still holds (a dropped override re-opens Platform)",
    ).toEqual([
      { label: 'Acme', depth: 0 },
      { label: 'Engineering', depth: 1 },
      { label: 'Sales', depth: 1 },
      { label: 'Ops', depth: 0 },
      { label: 'Ops Platform', depth: 1 },
    ]);
    expect(toggleLabel(container, 'Ops'), 'the new root took the seed').toBe('Collapse');
    expect(toggleLabel(container, 'Engineering'), "the old one kept the user's answer").toBe(
      'Expand',
    );
  });
});

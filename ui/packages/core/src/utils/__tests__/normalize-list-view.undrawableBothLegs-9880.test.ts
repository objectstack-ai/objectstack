/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9880 — the two view-kind tables in `normalize-list-view.ts` have to
 * be total against TWO different `ViewType` unions at once:
 *
 *   · the `@objectstack/spec` this repository RESOLVES today, which still
 *     publishes the list-view kind `page`;
 *   · a spec built from objectstack `main`, which RETIRED it (objectstack#17063,
 *     ADR-0049 enforce-or-remove) and which objectui#9860's shape gate compiles
 *     this repository against on every pull request.
 *
 * The spelling that failed was the ANNOTATION
 * `Record<Exclude<ViewType, ListViewVisualization>, string | null>` on the
 * undrawable table. An annotated object literal is exact in BOTH directions, so
 * the day the kind left the union its row became an excess property — TS2353,
 * the one diagnostic that gate reported on its first run — and the only repair
 * the annotation admits is DELETING the row, which the resolved published spec
 * forbids because an author can still write a `page` view against it.
 *
 * ⭐ The card's first deliverable was the judgement "is a both-legs spelling
 * possible at all", with a re-grade switch if it was not. It is: keep the
 * value constraint with `satisfies`, drop the exactness, and derive the
 * undrawable union from the table's keys INTERSECTED with the live vocabulary
 * (`Extract`), so a retired row is inert rather than illegal. This file pins
 * that judgement in both directions, with the failing spelling kept as a firing
 * control so the green below can never be the green of a check that stopped
 * checking.
 *
 * ⚠️ UPDATE (objectui#11073): the resolved `@objectstack/spec` is 17.5.0, which
 * carries the retirement too, so both legs now read `main`'s shape. The real
 * table's `page` row was deleted — the `Extract` spelling is what let that be a
 * plain deletion — and the runtime row below was re-pinned to the silence that
 * follows. The simulated legs are kept: they are the proof that the next
 * retirement lands the same way.
 *
 * ⚠️ Only ONE spec is installed in any single run, so the two legs cannot both
 * be observed at runtime here. The vocabulary is therefore SIMULATED for the
 * type-level half — the same two operators in the same composition, applied to
 * a published-shaped union, a main-shaped one, and a grown one. The real
 * module's own cross-leg invariants are asserted separately below, and they are
 * written to hold identically under either spec; the two-spec compile itself
 * lives in this card's pull request, where both legs were run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { isListViewVisualization } from '../normalize-list-view.js';
import type { ListViewVisualization } from '../normalize-list-view.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

/* ------------------------------------------------------------------ *
 * The mechanism, lifted off the live vocabulary so both legs are      *
 * reachable from one compile.                                         *
 * ------------------------------------------------------------------ */

/** The source's `UndrawableViewKind`, over an arbitrary vocabulary and table. */
type Undrawable<Vocabulary, Table> = Extract<Vocabulary, keyof Table>;

/** The source's `ListViewVisualization`, over the same two parameters. */
type Drawable<Vocabulary, Table> = Exclude<Vocabulary, Undrawable<Vocabulary, Table>>;

/** A stand-in for `UNDRAWABLE_VIEW_KINDS`, spelled the way the source spells it. */
const SIMULATED_UNDRAWABLE = {
  list: null,
  detail: null,
  page: 'the retired kind, still classed while the resolved spec accepts one',
} satisfies Record<string, string | null>;
type SimulatedTable = typeof SIMULATED_UNDRAWABLE;

/** The resolved spec's shape: the kind is still in the vocabulary. */
type PublishedVocabulary = 'grid' | 'kanban' | 'page' | 'list' | 'detail';
/** objectstack `main`'s shape: the kind is gone. */
type MainVocabulary = 'grid' | 'kanban' | 'list' | 'detail';
/** The direction the guard was written FOR: the spec grows a member. */
type GrownVocabulary = 'grid' | 'kanban' | 'page' | 'pivot' | 'list' | 'detail';

// The derived drawable set is the SAME under both legs — the retired row does
// not leak into it, and its absence does not take a drawable kind with it.
export type _DrawableUnderPublished = Expect<
  Equal<Drawable<PublishedVocabulary, SimulatedTable>, 'grid' | 'kanban'>
>;
export type _DrawableUnderMain = Expect<Equal<Drawable<MainVocabulary, SimulatedTable>, 'grid' | 'kanban'>>;

// …and a table total over it compiles under both, which is the whole claim.
export const drawableUnderPublished: Record<Drawable<PublishedVocabulary, SimulatedTable>, true> = {
  grid: true,
  kanban: true,
};
export const drawableUnderMain: Record<Drawable<MainVocabulary, SimulatedTable>, true> = {
  grid: true,
  kanban: true,
};

// FIRING CONTROL — the spelling this card replaced. Annotated with the exact
// `Record<Exclude<…>>`, the retired row is an excess property the moment the
// vocabulary drops it. If this assignment ever compiles, the green above has
// stopped meaning "tolerant of a retirement" and this file must be re-read.
export const retiredRowUnderTheOldSpelling: Record<
  Exclude<MainVocabulary, Drawable<MainVocabulary, SimulatedTable>>,
  string | null
> = {
  list: null,
  detail: null,
  // @ts-expect-error — TS2353: 'page' does not exist in type 'Record<"list" | "detail", string | null>'
  page: 'the retired kind',
};

// The ADD direction objectui#8127 installed the guard for, unchanged by this
// card: a kind NEITHER table classes stays in the drawable union, so the
// drawable table is missing a key (TS2739) until it is classed.
// @ts-expect-error — 'pivot' is classed by neither table, so it is a required key here
export const drawableUnderGrown: Record<Drawable<GrownVocabulary, SimulatedTable>, true> = {
  grid: true,
  kanban: true,
};

/** The other half of "drawable OR explained": explaining it clears the red. */
const SIMULATED_UNDRAWABLE_WITH_PIVOT = {
  ...SIMULATED_UNDRAWABLE,
  pivot: 'a hypothetical non-visualization list type',
} satisfies Record<string, string | null>;

export const drawableUnderGrownOnceExplained: Record<
  Drawable<GrownVocabulary, typeof SIMULATED_UNDRAWABLE_WITH_PIVOT>,
  true
> = {
  grid: true,
  kanban: true,
};

/* ------------------------------------------------------------------ *
 * The real module: invariants that read the same under either spec.   *
 * ------------------------------------------------------------------ */

/**
 * The exported visualization union is the nine kinds `ListView` has a `case`
 * for — under the resolved spec AND under `main`'s. This is what makes the
 * change a re-spelling rather than a re-definition: the published type does not
 * move, only the way it is derived.
 */
export type _VisualizationUnionIsTheNineDrawnKinds = Expect<
  Equal<
    ListViewVisualization,
    'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' | 'map' | 'chart' | 'tree'
  >
>;

const DRAWN_KINDS = [
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'gantt',
  'map',
  'chart',
  'tree',
] as const;

describe('the undrawable table survives an upstream retirement (objectui#9880)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the simulated legs honest: every table above is a real, non-empty reading', () => {
    // A census over an empty set passes, so the simulated tables are sized
    // before the type-level assertions above are trusted.
    expect(Object.keys(SIMULATED_UNDRAWABLE)).toEqual(['list', 'detail', 'page']);
    expect(Object.keys(SIMULATED_UNDRAWABLE_WITH_PIVOT)).toEqual(['list', 'detail', 'page', 'pivot']);
    expect(Object.keys(drawableUnderPublished)).toEqual(Object.keys(drawableUnderMain));
    expect(Object.keys(drawableUnderGrownOnceExplained)).toEqual(['grid', 'kanban']);
    expect(Object.keys(retiredRowUnderTheOldSpelling)).toContain('page');
    expect(Object.keys(drawableUnderGrown)).toEqual(['grid', 'kanban']);
  });

  it('answers the drawable question identically whichever spec is resolved', () => {
    for (const kind of DRAWN_KINDS) {
      expect(isListViewVisualization(kind)).toBe(true);
    }
    // Controls: the predicate is a membership test, not a `true` generator.
    // All three are undrawable under either spec — `list` and `detail` because
    // they are objectui CATEGORIES with no spec counterpart, `page` because the
    // renderer has no branch for it whether or not the spec still offers it.
    expect(isListViewVisualization('page')).toBe(false);
    expect(isListViewVisualization('list')).toBe(false);
    expect(isListViewVisualization('detail')).toBe(false);
  });

  it('no longer explains a `page` view: the resolved spec refuses one, and the row retired with it', async () => {
    // Through `@objectstack/spec` 17.4.0 the retired row was kept at RUNTIME on
    // purpose: while the resolved spec accepted a `page` view an author could
    // still write one, and the degrade to a grid had to say so. 17.5.0 refuses
    // `type: 'page'` at the door, both published `@object-ui/types` faces refuse
    // it, and the row was deleted as it said it would be (objectui#11073). A
    // stored `page` view now degrades like any kind outside the vocabulary.
    //
    // ⚠️ The warning is once-per-kind-per-MODULE-INSTANCE, and the `unit`
    // project runs with `isolate: false`, so a sibling suite that already
    // normalised a `page` view in this worker has spent it — asserting on the
    // statically imported module measured whichever file ran first. A fresh
    // instance is what makes the count below a reading instead of a race.
    vi.resetModules();
    const fresh = await import('../normalize-list-view.js');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = fresh.normalizeListViewSchema({
      type: 'list-view',
      objectName: 'account',
      specType: 'page',
    });

    expect((out as { viewType?: string }).viewType).toBe('grid');
    expect(warn).not.toHaveBeenCalled();

    // Control: a kind outside the vocabulary answers exactly the same way, so
    // the silence above is `page` being an ordinary unknown now — not a
    // normalizer that stopped degrading.
    const typo = fresh.normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: 'nonsense' });
    expect((typo as { viewType?: string }).viewType).toBe('grid');
    expect(warn).not.toHaveBeenCalled();
  });
});

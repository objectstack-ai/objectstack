/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8429 — the RESIDUAL left standing after objectui#8127 / PR #8372,
 * and how it CLOSED (objectui#11073).
 *
 * #8127 was the DECLARATION gap: `ViewType` was a hand-written copy of
 * `@objectstack/spec`'s list-view vocabulary. PR #8372 derived both published
 * `@object-ui/types` faces from the spec, and that made a renderer gap visible:
 * `page` was a list-view type the spec ACCEPTED and both objectui faces
 * published, which `ListView` cannot draw, so `normalizeListViewSchema` handed
 * the renderer a grid with the `pageName` mount target unread.
 *
 * This file stayed DISPOSITION-FREE: it pinned that behaviour so that neither
 * "grow a renderer" nor "narrow `ViewType`" could land silently. The answer
 * came from the protocol instead: objectstack#17063 retired `type: 'page'` and
 * `pageName` (ADR-0049 enforce-or-remove), and `@objectstack/spec` 17.5.0
 * publishes the retirement. The derived faces followed the spec, as the
 * derivation promised, so the residual set is EMPTY: every list-view type the
 * spec accepts is one `ListView` draws. The pins below state the closed state,
 * each population sized before it is used, because a census over an empty set
 * passes. The seat's Q4 ruling on objectui#11073 retired the matching members
 * on objectui's own faces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ViewTypeSchema } from '@object-ui/types/zod';
import type { ViewType } from '@object-ui/types';
import { normalizeListViewSchema, isListViewVisualization } from '../normalize-list-view.js';

/** The spec's own list-view vocabulary, unwrapped from its `.default('grid')`. */
const SPEC_LIST_VIEW_TYPES: readonly string[] = SpecListViewSchema.shape.type.removeDefault().options;

/** objectui's published vocabulary: the spec's list plus the two local CATEGORIES. */
const OBJECTUI_VIEW_TYPES: readonly string[] = ViewTypeSchema.options;

/**
 * The page-mount document objectui#8429 held spec-valid through 17.4.0:
 * `type: 'page'` with its `pageName` and empty `columns`. The spec REFUSES it
 * since 17.5.0, by name, with the removal prescription.
 */
const RETIRED_PAGE_VIEW = {
  name: 'account_page',
  type: 'page',
  pageName: 'crm_welcome',
  columns: [] as unknown[],
} as const;

const readViewType = (out: unknown): unknown => (out as { viewType?: unknown }).viewType;

/* ── The TYPE face, asserted DERIVED rather than annotated (objectui#9978) ──────
 *
 * This pin used to state the type face inline, inside the `BOTH published
 * faces` test, as `const pageAsViewType: ViewType = 'page'`. An annotation
 * judges the literal against whichever `ViewType` is RESOLVED, and
 * objectstack#17063 retired the kind on objectstack `main` — so under
 * objectui#9860's shape gate, which compiles this repository against a spec
 * built from there, that line became `TS2322: Type '"page"' is not assignable
 * to type 'ViewType'`. The pin stopped COMPILING on the one leg where the
 * retirement is the news, instead of reporting anything about it.
 *
 * ⛔ The spelling is NOT deleted — it is this file's subject. What moves is what
 * it is checked AGAINST, the same move objectui#9880 made in the source with
 * `Extract` and objectui#9943 made for the `Record<ViewType, …>` totals.
 * `@object-ui/types` derives its two faces from two DIFFERENT exports of the
 * spec (`ViewType` from `SpecListView['type']`, `ViewTypeSchema` from
 * `SpecListViewTypeEnum.options`), and the zod-mirror ledger registers
 * `views.zod.ts#ViewTypeSchema` as a bare vocabulary it does NOT compare — so
 * the claim the test below is named for, `page` on BOTH faces, is checked here
 * as the two faces AGREEING about it. They carry it together on the resolved
 * spec, where the runtime leg beside it proves the value face does; they drop
 * it together on a spec that retires it, and the assert stays `never` rather
 * than uncompilable.
 *
 * ⚠️ What no COMPILE-time spelling can state on both legs is `page`'s bare
 * presence in the live union. It is stated at RUNTIME instead, against the spec
 * this repository actually resolves — since objectui#11073 that is 17.5.0,
 * which retired the kind, so the sized vocabularies, the `safeParse` and the
 * census below state its ABSENCE, and redden if it comes back.
 */

/** The VALUE face's vocabulary, read as a type off the enum's own options. */
type ValueFaceViewType = (typeof ViewTypeSchema.options)[number];

/** `never` only while `T` is; a live union here is the failure (TS2344). */
type AssertNever<T extends never> = T;

/** The two faces' DISAGREEMENT about `page`, over any pair of vocabularies. */
type PageFaceSkew<TypeFace extends string, ValueFace extends string> =
  | Exclude<Extract<ValueFace, 'page'>, TypeFace>
  | Exclude<Extract<TypeFace, 'page'>, ValueFace>;

/** ⭐ The live assert: red the day either published face drops `page` alone. */
export type _LivePageFaceSkew = AssertNever<PageFaceSkew<ViewType, ValueFaceViewType>>;

/* The assert FIRES — shown over SIMULATED vocabularies, because any one run
 * installs exactly one spec and so cannot reach both legs. Same operator, same
 * composition; only the vocabulary is written down here. */

/** The shape of a spec that still publishes the kind (through 17.4.0). */
type PublishedShapedViewType = 'grid' | 'page';
/** The shape of a spec that retired it (objectstack#17063; 17.5.0, the resolved spec since objectui#11073). */
type MainShapedViewType = 'grid';

/** LEG 1 — a spec that publishes the kind. Both faces carry it, so the skew is `never`. */
export type _SkewUnderPublished = AssertNever<PageFaceSkew<PublishedShapedViewType, PublishedShapedViewType>>;
/** LEG 2 — a spec that retired it, the resolved one today. Both faces dropped it together. */
export type _SkewUnderMain = AssertNever<PageFaceSkew<MainShapedViewType, MainShapedViewType>>;

/** FIRING CONTROL A — the TYPE face narrowed alone. The skew is `'page'`. */
// @ts-expect-error - TS2344: Type '"page"' does not satisfy the constraint 'never'.
export type _SkewTypeFaceNarrowedAlone = AssertNever<PageFaceSkew<MainShapedViewType, PublishedShapedViewType>>;

/** FIRING CONTROL B — the VALUE face narrowed alone; the other direction. */
// @ts-expect-error - TS2344: Type '"page"' does not satisfy the constraint 'never'.
export type _SkewValueFaceNarrowedAlone = AssertNever<PageFaceSkew<PublishedShapedViewType, MainShapedViewType>>;

/**
 * FIRING CONTROL C — the ANNOTATION this pin carried, over a main-shaped face.
 * This is the card's own diagnostic, reproduced inside ordinary CI on the
 * resolved spec. If it ever compiles, LEG 2 above has stopped meaning
 * "survives the retirement" and this whole section must be re-read.
 */
// @ts-expect-error - TS2322: Type '"page"' is not assignable to type '"grid"'.
export const pageUnderTheOldAnnotation: MainShapedViewType = 'page';

describe('the `page` residual (objectui#8429), closed by the protocol at @objectstack/spec 17.5.0', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the populations, sized before they are used', () => {
    it('reads a non-empty, exactly-sized vocabulary from each face', () => {
      // The spec's list-view types, as published in @objectstack/spec 17.5.0:
      // the nine visualizations, `page` retired.
      expect(SPEC_LIST_VIEW_TYPES.length).toBe(9);
      expect([...SPEC_LIST_VIEW_TYPES].sort()).toEqual([
        'calendar', 'chart', 'gallery', 'gantt', 'grid', 'kanban', 'map', 'timeline', 'tree',
      ]);

      // objectui's derived face: the spec's nine, plus the two local categories.
      expect(OBJECTUI_VIEW_TYPES.length).toBe(11);
      expect([...OBJECTUI_VIEW_TYPES].sort()).toEqual([
        'calendar', 'chart', 'detail', 'gallery', 'gantt', 'grid',
        'kanban', 'list', 'map', 'timeline', 'tree',
      ]);

      // The derivation itself: objectui declares a superset, never a subset.
      for (const kind of SPEC_LIST_VIEW_TYPES) {
        expect(OBJECTUI_VIEW_TYPES).toContain(kind);
      }
    });

    it('partitions objectui`s vocabulary into 9 drawable kinds and the 2 local categories', () => {
      const drawable = OBJECTUI_VIEW_TYPES.filter((k) => isListViewVisualization(k));
      const undrawable = OBJECTUI_VIEW_TYPES.filter((k) => !isListViewVisualization(k));

      expect(drawable.length).toBe(9);
      expect(undrawable.length).toBe(2);
      expect(drawable.length + undrawable.length).toBe(OBJECTUI_VIEW_TYPES.length);
      expect([...undrawable].sort()).toEqual(['detail', 'list']);
    });
  });

  describe('⭐ the contradiction is gone: the residual set is EMPTY', () => {
    it('leaves no spec-authorable list-view type ListView cannot draw', () => {
      const residual = SPEC_LIST_VIEW_TYPES.filter((k) => !isListViewVisualization(k));
      expect(residual).toEqual([]);
      // Control: the subtraction is a real one — every one of the spec's nine IS drawable.
      expect(SPEC_LIST_VIEW_TYPES.filter((k) => isListViewVisualization(k)).length).toBe(9);
    });

    it('refuses `page` on BOTH published `@object-ui/types` faces, as the spec does', () => {
      expect(ViewTypeSchema.safeParse('page').success).toBe(false);
      expect(OBJECTUI_VIEW_TYPES).not.toContain('page');
      // Control: the enum is a reading, not a schema that refuses everything.
      expect(ViewTypeSchema.safeParse('kanban').success).toBe(true);
    });

    it('the spec refuses the page-mount document by name, with its removal prescription', () => {
      const r = SpecListViewSchema.safeParse(RETIRED_PAGE_VIEW);
      expect(r.success).toBe(false);
      const messages = r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      expect(messages.find((m) => m.path === 'type')?.message).toContain('removed');
      expect(messages.find((m) => m.path === 'pageName')?.message).toContain('removed');
      // Controls: the same shape as a drawable kind parses, and a typo is still refused.
      expect(SpecListViewSchema.safeParse({ name: 'account_grid', type: 'grid', columns: ['name'] }).success).toBe(true);
      expect(SpecListViewSchema.safeParse({ name: 'account_typo', type: 'nonsense', columns: [] }).success).toBe(false);
    });
  });

  describe('the OUTPUT — a stored `page` view degrades like any kind outside the vocabulary', () => {
    it('normalises a stored `page` view to `viewType: "grid"`, exactly as it normalises a typo', () => {
      expect(readViewType(normalizeListViewSchema({ ...RETIRED_PAGE_VIEW }))).toBe('grid');
      expect(readViewType(normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: 'page' }))).toBe('grid');
      expect(readViewType(normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: 'nonsense' }))).toBe('grid');
    });

    it('discriminates: a drawable kind keeps its own identity', () => {
      expect(readViewType(normalizeListViewSchema({ type: 'list-view', objectName: 'a', specType: 'kanban' }))).toBe('kanban');
      expect(readViewType(normalizeListViewSchema({ type: 'list-view', objectName: 'a', specType: 'gantt' }))).toBe('gantt');
      expect(readViewType(normalizeListViewSchema({ viewType: 'kanban', objectName: 'a' }))).toBe('kanban');
    });
  });

  describe('the whole vocabulary, as a census', () => {
    it('maps every one of the 11 declared kinds to what the renderer actually gets', () => {
      const census = new Map<string, unknown>(
        OBJECTUI_VIEW_TYPES.map((kind) => [
          kind,
          readViewType(normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: kind })),
        ]),
      );
      expect(census.size).toBe(11);
      expect(Object.fromEntries(census)).toEqual({
        grid: 'grid',
        kanban: 'kanban',
        gallery: 'gallery',
        calendar: 'calendar',
        timeline: 'timeline',
        gantt: 'gantt',
        map: 'map',
        chart: 'chart',
        tree: 'tree',
        // The two objectui CATEGORIES — folding to grid is correct and intended.
        list: 'grid',
        detail: 'grid',
      });
      // Every SPEC-declared kind resolves to itself: the residual is closed.
      expect(SPEC_LIST_VIEW_TYPES.filter((kind) => census.get(kind) !== kind)).toEqual([]);
    });
  });
});

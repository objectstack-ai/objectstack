/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:grid` renders every breakpoint its `columns` map is authored with —
 * all SIX of the repo's breakpoint vocabulary, not the first five
 * (objectui#7097).
 *
 * ## What was wrong
 *
 * `grid.tsx` carried one static Tailwind class map per breakpoint (`GRID_COLS`,
 * `GRID_COLS_SM` … `GRID_COLS_XL`) and one read arm per breakpoint. Both stopped
 * at `xl`. `2xl` — a full member of `BreakpointName` (`@object-ui/types`), of
 * `@object-ui/mobile`'s `BREAKPOINTS` / `BREAKPOINT_ORDER`, and of
 * `@object-ui/layout`'s `BreakpointColumnMap`, whose `ResponsiveGrid` already
 * emits `2xl:grid-cols-*` — had no arm and no map here. Measured on the base
 * commit through this same harness:
 *
 * ```
 * authored { xs: 1, '2xl': 6 }  ->  "grid grid-cols-1 gap-4"
 * ```
 *
 * The entry type-checked, survived `GridSchema`'s zod mirror, emitted no class,
 * and the grid rendered at its `xs` count on every screen. No error, no warning
 * — the declared-but-not-read shape `skills/objectui/rules/protocol.md` warns
 * authors about, inside the layout key that section uses as its own example.
 *
 * ## Which layer dropped it, and why that decides the fix
 *
 * BOTH layers, and this is the load-bearing measurement. Adding a `2xl` read arm
 * alone would have produced the string `2xl:grid-cols-6` from a template — and a
 * Tailwind class that no static source literal spells is a class Tailwind's
 * scanner never sees, so it is never compiled. The node would carry a class name
 * with no rule behind it: GREEN in this file and unstyled in the browser. That
 * is precisely what the `GRID_COLS_*` maps exist for — their own comment says
 * "Helper maps to ensure Tailwind classes are scanned and included". The fix
 * therefore adds the sixth static map (`GRID_COLS_2XL`, twelve literal class
 * strings) as well as the sixth read arm. `packages/components/src/index.css`
 * scans `../src/**` and this repo defines no `--breakpoint-*` override in any
 * `@theme` block, so Tailwind v4's default `2xl` (96rem / 1536px — the same
 * 1536 `BREAKPOINTS['2xl']` carries) is the variant those literals compile to.
 *
 * ## What this file observes, and why that observation is sound
 *
 * The EMITTED CLASS STRING, compared whole. Not `getComputedStyle`: these are
 * CSS-only Tailwind responsive variants, and happy-dom does not compile Tailwind
 * or resolve `@media (width >= 96rem)` the way a browser does, so a computed
 * `grid-template-columns` here would measure the harness, not the renderer. The
 * class string is the renderer's entire output on this path — `grid.tsx` reads
 * no window, no matchMedia, no ResizeObserver — so nothing is lost by observing
 * it, and `renders-identically-at-any-viewport` below pins that width
 * independence explicitly rather than assuming it (a viewport-dependent pin that
 * is green only on an unpinned desktop default is the failure this repo has been
 * bitten by).
 *
 * ## Why every case compares the WHOLE string
 *
 * `toContain('2xl:grid-cols-6')` would also pass for an implementation that
 * emits the `2xl` class and drops `xl`, or that emits all six classes at the
 * same column count. Whole-string equality makes the other five breakpoints
 * non-regression assertions of this file, so a change that trades one
 * breakpoint for another reddens here. An implementation strictly WORSE than the
 * bug — one that emits no responsive classes at all, the "delete the feature"
 * shape — fails every case below rather than satisfying them.
 *
 * ## Why the case list is derived, not typed out
 *
 * `ALL_BREAKPOINTS` is checked for exhaustiveness against `BreakpointName` at
 * the type level, so a seventh member of the vocabulary makes this file a
 * COMPILE error (`pnpm --filter @object-ui/components type-check`, which covers
 * `tsconfig.test.json`) instead of silently leaving the new tier untested. That
 * is the durable half of this card: the gap survived because nothing compared
 * the breakpoint vocabulary against the keys this renderer actually reads.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { BreakpointName } from '@object-ui/types';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

/**
 * The breakpoint vocabulary, smallest first — the same six and the same order as
 * `@object-ui/mobile`'s `BREAKPOINT_ORDER`.
 */
const ALL_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

/**
 * Exhaustiveness gate, both directions.
 *
 * Forward: if `BreakpointName` grows a member that `ALL_BREAKPOINTS` does not
 * list, `Exclude<...>` stops being `never`, stops satisfying `T extends never`,
 * and this alias fails to compile — the new tier cannot join the vocabulary
 * without this file being updated to cover it. (An `Uncovered[]` variable would
 * NOT do: `const x: '2xl'[] = []` type-checks happily, so the empty-array
 * spelling of this gate is inert. This one was verified to redden by deleting a
 * member from `ALL_BREAKPOINTS`.)
 *
 * Reverse: a member listed here that is NOT a `BreakpointName` fails at the
 * `expectedClassFor(bp, …)` call below, whose parameter is typed `BreakpointName`.
 *
 * Both are checked by `pnpm --filter @object-ui/components type-check`, whose
 * second program is `tsconfig.test.json`.
 */
type _AssertNever<T extends never> = T;
type _UncoveredBreakpoint = _AssertNever<
  Exclude<BreakpointName, (typeof ALL_BREAKPOINTS)[number]>
>;
type _GateIsLive = _UncoveredBreakpoint;

const classOf = (schema: unknown): string => {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  const el = container.firstElementChild as HTMLElement | null;
  // Checked, not asserted away. A renderer that produced no element at all would
  // otherwise throw a bare `Cannot read properties of null` here, BEFORE any
  // `expect` ran — the failure summary would name a TypeError instead of the
  // node that failed to render. This turns that case into a named assertion.
  expect(el, `SchemaRenderer produced no element for ${JSON.stringify(schema)}`).not.toBeNull();
  return (el as HTMLElement).className;
};

/** `xs` is the base tier: its class carries no variant prefix. */
const expectedClassFor = (bp: BreakpointName, cols: number): string =>
  bp === 'xs' ? `grid-cols-${cols}` : `${bp}:grid-cols-${cols}`;

describe('ui:grid emits a column class for every breakpoint in the vocabulary (#7097)', () => {
  it('a fully authored six-breakpoint map emits all six classes, in order', () => {
    expect(
      classOf({
        type: 'grid',
        columns: { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, '2xl': 6 },
        gap: 4,
      }),
    ).toBe(
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4',
    );
  });

  it('the reported node — { xs: 1, "2xl": 6 } — now emits its 2xl class', () => {
    // The card's measured row. Before the fix this was "grid grid-cols-1 gap-4".
    expect(classOf({ type: 'grid', columns: { xs: 1, '2xl': 6 }, gap: 4 })).toBe(
      'grid grid-cols-1 2xl:grid-cols-6 gap-4',
    );
  });

  it.each(ALL_BREAKPOINTS)(
    'a map naming only %s emits that tier and no other tier',
    (bp) => {
      const authored = classOf({ type: 'grid', columns: { [bp]: 6 }, gap: 4 });
      // Whole-string equality: this is simultaneously the presence assertion for
      // `bp` and the absence assertion for the other five.
      const base = bp === 'xs' ? 'grid-cols-6' : 'grid-cols-1';
      const expected =
        bp === 'xs' ? `grid ${base} gap-4` : `grid ${base} ${expectedClassFor(bp, 6)} gap-4`;
      expect(authored, `authored { "${bp}": 6 } rendered: ${authored}`).toBe(expected);
    },
  );

  it('the two rows that already worked keep working', () => {
    // Non-regression on the shapes the card measured as CORRECT, so a fix that
    // moves the 2xl tier in by breaking one of them cannot pass this file.
    expect(classOf({ type: 'grid', columns: { xs: 1, xl: 5 }, gap: 4 })).toBe(
      'grid grid-cols-1 xl:grid-cols-5 gap-4',
    );
    // A bare number keeps its mobile-first ramp (baseCols collapses to 1).
    expect(classOf({ type: 'grid', columns: 4, gap: 4 })).toBe(
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4',
    );
  });

  it('an unmapped 2xl column count emits no 2xl class, exactly as xl behaves', () => {
    // The static maps cover 1-12. Out-of-range counts fall out of BOTH the xl and
    // the 2xl map the same way — the sixth tier is not given a lenient path the
    // other five do not have.
    expect(classOf({ type: 'grid', columns: { xs: 1, xl: 99 }, gap: 4 })).toBe(
      'grid grid-cols-1 gap-4',
    );
    expect(classOf({ type: 'grid', columns: { xs: 1, '2xl': 99 }, gap: 4 })).toBe(
      'grid grid-cols-1 gap-4',
    );
  });
});

describe('the emitted class is viewport-independent, which is why reading it is sound (#7097)', () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('renders identically at a phone width and at a 2xl desktop width', () => {
    const node = { type: 'grid', columns: { xs: 1, xl: 5, '2xl': 6 }, gap: 4 };

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    const atPhone = classOf(node);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const atWideDesktop = classOf(node);

    // Equal, and equal to the full six-class-per-authored-tier string: the
    // renderer emits every tier's class unconditionally and lets CSS pick. A
    // pin that only held at one viewport would be measuring happy-dom's default
    // window size instead of the renderer.
    expect(atPhone).toBe('grid grid-cols-1 xl:grid-cols-5 2xl:grid-cols-6 gap-4');
    expect(atWideDesktop, `phone=${atPhone} desktop=${atWideDesktop}`).toBe(atPhone);
  });
});

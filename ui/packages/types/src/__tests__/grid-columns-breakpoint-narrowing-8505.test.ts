/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8505 — `GridSchema.columns` is keyed by the BREAKPOINT VOCABULARY,
 * not by `string`.
 *
 * ## What was wrong
 *
 * The member was declared `number | Record<string, number>`. The renderer
 * (`@object-ui/components`, `renderers/layout/grid.tsx`) reads exactly six keys
 * — `xs` `sm` `md` `lg` `xl` `2xl`, the whole of {@link BreakpointName} — and
 * `grid-breakpoint-columns-7097.test.tsx` already pins that read set exhaustive
 * in BOTH directions. So the renderer and its pins agreed on six; only the type
 * still said "any string". Measured on the base commit:
 *
 * ```
 * const node: GridSchema = { type: 'grid', columns: { xxl: 6 } };  // compiled
 * ```
 *
 * `{ xxl: 6 }`, `{ XL: 5 }` and `{ '2XL': 6 }` type-checked, passed the zod
 * mirror, emitted no class and rendered the grid at its `xs` count on every
 * screen — the declared-but-not-read shape objectui#7097 fixed at the value
 * level, surviving one card longer at the type level.
 *
 * ## Why the assertions below are shaped the way they are
 *
 * The caricature of this fix is a narrowing that rejects EVERYTHING —
 * `Record<never, number>`, or quietly dropping the bare-number arm. Either
 * would satisfy any "a typo is now rejected" assertion while being strictly
 * worse than the bug. So the negatives are never load-bearing alone, and the
 * division of labour between the constructs below was MEASURED by mutating the
 * member four ways and reading `tsc -p tsconfig.test.json` each time — not
 * reasoned about. What each mutation actually reddened:
 *
 * | member mutated to                      | what catches it, in this file |
 * | :------------------------------------- | :---------------------------- |
 * | `number \| Record<string, number>` (the bug) | the five `@ts-expect-error`s go TS2578 "unused", + both `Eq`s |
 * | `number \| Record<never, number>`       | `_keyedByVocabulary` only, + the five TS2578s |
 * | `Partial<Record<BreakpointName, number>>` (no number arm) | `_columnsShape`, the bare-number row, + 2 reds in the sibling `zod-mirror-parity` pin |
 * | `number \| Partial<Record<'xs', number>>` | five {@link ONE_KEY_NODES} rows, + both `Eq`s, + 2 positive rows |
 *
 * ⚠️ The row that is easy to get wrong, and was: {@link ONE_KEY_NODES} does NOT
 * catch `Record<never, number>`. That type is `{}`, and TypeScript runs no
 * excess-property check against the empty object type, so all six rows stay
 * green under the very caricature they look like they exist to stop. The
 * `keyof` equality is what actually holds that line. Both are kept: they fail
 * on different mutations, and neither alone covers the pair.
 *
 * ⚠️ The trap next door, recorded by objectui#7097: `const x: '2xl'[] = []`
 * type-checks happily, so an empty-array assertion proves nothing about an
 * element type. Every negative here is a `@ts-expect-error`, which `tsc` itself
 * verifies in the failing direction — an unused one is TS2578 — and all five
 * were observed to become TS2578 under the first two mutations above.
 *
 * ## Which program checks this file
 *
 * `packages/types`' `type-check` script runs THREE programs; this file is in
 * the third, `tsconfig.test.json` (`tsc --noEmit` builds `tsconfig.json`, which
 * excludes `__tests__/` by directory). Confirmed with `--listFiles`, not
 * assumed — objectui#8342 measured a case that was red only in a test program.
 * The subject is imported as a sibling SOURCE module (`../layout`), so that one
 * program reads the declaration directly and no `dist` staleness sits between
 * this file and what it pins.
 *
 * ## What this card deliberately did NOT change
 *
 * The zod mirror. See the last block: it still validates `columns` as an open
 * record, so the JSON authoring face still admits `{ xxl: 6 }`. That is a
 * REPORTED gap with its own card, not an oversight — the reasoning is in the
 * PR body and the block below holds the current reading visible so it cannot
 * rot into a silent assumption that both faces closed together.
 */

import { describe, it, expect } from 'vitest';
import type { GridSchema } from '../layout';
import type { BreakpointName } from '../mobile';
import { GridSchema as GridZodMirror } from '../zod/layout.zod';

/** Mutual assignability, the standard invariant `Eq` — not `extends`. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

/**
 * The column counts the renderer maps. This card's subject is the KEY
 * vocabulary; since objectui#11491 the VALUES are closed too, at the bare number
 * and at every breakpoint, so the shapes below carry the count set where they
 * said `number` (`grid-columns-set-11491.test.ts` pins the values themselves).
 */
type ColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * One authored node per breakpoint, EVERY key positively type-checked inside
 * `columns`.
 *
 * The annotation is the gate. `Record<BreakpointName, …>` is exhaustive both
 * ways in a single construct: drop a member from the vocabulary and the entry
 * for it becomes an excess property; add a seventh and this object stops
 * satisfying its annotation. And because each VALUE is a `GridSchema`, a
 * narrowing that admits FEWER than the vocabulary reddens once per key it
 * dropped rather than passing quietly — measured: mutating the member to
 * `Partial<Record<'xs', number>>` produced exactly five TS2353 here, one per
 * lost breakpoint. It does NOT catch `Record<never, number>`; `_keyedByVocabulary`
 * does. See the table in the file header.
 */
const ONE_KEY_NODES: Record<BreakpointName, GridSchema> = {
  xs: { type: 'grid', columns: { xs: 1 } },
  sm: { type: 'grid', columns: { sm: 2 } },
  md: { type: 'grid', columns: { md: 3 } },
  lg: { type: 'grid', columns: { lg: 4 } },
  xl: { type: 'grid', columns: { xl: 5 } },
  '2xl': { type: 'grid', columns: { '2xl': 6 } },
};

const BREAKPOINTS = Object.keys(ONE_KEY_NODES) as BreakpointName[];

/* ── (a) the member's type, pinned whole ──────────────────────────────────── */

describe('objectui#8505 — GridSchema.columns declares the breakpoint vocabulary', () => {
  it('the member type is exactly the bare count OR a partial breakpoint map of counts', () => {
    // Mutual assignability, so this fails in BOTH directions: widened back to
    // `Record<string, number>` it fails, and narrowed to `Record<never, number>`
    // or stripped of the `number` arm it also fails. A one-way `extends` check
    // would pass for the caricature.
    const _columnsShape: Eq<
      GridSchema['columns'],
      ColumnCount | Partial<Record<BreakpointName, ColumnCount>> | undefined
    > = true;
    expect(_columnsShape).toBe(true);
  });

  it('the map arm is keyed by the vocabulary the renderer reads, not by string', () => {
    // This is the assertion that catches the `Record<never, number>` caricature,
    // and the ONLY one in this file that does — see the table in the header.
    const _keyedByVocabulary: Eq<
      keyof NonNullable<Exclude<GridSchema['columns'], ColumnCount>>,
      BreakpointName
    > = true;
    expect(_keyedByVocabulary).toBe(true);
  });
});

/* ── (b) non-regression: everything that was valid is still valid ─────────── */

describe('objectui#8505 — every shape the renderer honours still type-checks', () => {
  it.each(BREAKPOINTS)('a map naming only `%s` is accepted', (bp) => {
    // The TYPE-level assertion for this row is `ONE_KEY_NODES`' annotation; the
    // runtime half asserts the same six survive the mirror unchanged, so the
    // accept set is measured on both faces rather than assumed to move together.
    const node = ONE_KEY_NODES[bp];
    const parsed = GridZodMirror.safeParse(node);
    expect(parsed.success, `zod refused ${JSON.stringify(node)}`).toBe(true);
    if (parsed.success) expect(parsed.data.columns).toEqual(node.columns);
  });

  it('the bare-number form is still accepted — the arm a caricature would drop', () => {
    const bare: GridSchema = { type: 'grid', columns: 4 };
    expect(bare.columns).toBe(4);
    expect(GridZodMirror.safeParse(bare).success).toBe(true);
  });

  it('the node objectui#7097 was reported with is still accepted', () => {
    const reported: GridSchema = { type: 'grid', columns: { xs: 1, '2xl': 6 }, gap: 4 };
    expect(reported.columns).toEqual({ xs: 1, '2xl': 6 });
    expect(GridZodMirror.safeParse(reported).success).toBe(true);
  });

  it('a fully authored six-breakpoint map is still accepted', () => {
    const full: GridSchema = {
      type: 'grid',
      columns: { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, '2xl': 6 },
    };
    expect(Object.keys(full.columns as object)).toHaveLength(BREAKPOINTS.length);
    expect(GridZodMirror.safeParse(full).success).toBe(true);
  });

  it('omitting `columns` entirely is still accepted — the member stays optional', () => {
    const none: GridSchema = { type: 'grid', gap: 4 };
    expect(none.columns).toBeUndefined();
  });
});

/* ── (c) the refusals this card exists for ────────────────────────────────── */

describe('objectui#8505 — a key outside the vocabulary no longer compiles', () => {
  it('`xxl` — the card\'s own reproduction — is refused', () => {
    // @ts-expect-error `xxl` is not a breakpoint; the vocabulary is `xs`…`2xl` (objectui#8505)
    const typo: GridSchema = { type: 'grid', columns: { xxl: 6 } };
    expect(typo).toBeDefined();
  });

  it('`XL` is refused, and `tsc` names the member it meant', () => {
    // @ts-expect-error `XL` is not a breakpoint — the authored spelling is `xl` (objectui#8505)
    const upper: GridSchema = { type: 'grid', columns: { XL: 5 } };
    expect(upper).toBeDefined();
  });

  it('`2XL` is refused — the authored key is and stays lower-case `2xl`', () => {
    // @ts-expect-error `2XL` is not a breakpoint — the authored spelling is `2xl` (objectui#8505)
    const upper: GridSchema = { type: 'grid', columns: { '2XL': 6 } };
    expect(upper).toBeDefined();
  });

  it('a bad key mixed in with a good one is refused too', () => {
    // Freshness matters here: this is an object LITERAL, so excess-property
    // checking fires on `xxl` even though `xs` is present. The non-fresh case is
    // pinned in the block below, deliberately, as the boundary it is.
    // @ts-expect-error `xxl` is not a breakpoint, even alongside a valid one (objectui#8505)
    const mixed: GridSchema = { type: 'grid', columns: { xs: 1, xxl: 6 } };
    expect(mixed).toBeDefined();
  });
});

/* ── (d) the boundary: what this narrowing does NOT catch, measured ───────── */

describe('objectui#8505 — the narrowing broke no producer, and this is why', () => {
  it('a computed `Record<string, number>` still assigns — index signatures satisfy optional members', () => {
    // The blast-radius question this card was dispatched with: does something
    // assign into `columns` from a COMPUTED record rather than a literal, and
    // would that go red at the call site? Measured two ways and they agree.
    //
    // Structurally, here: a string index signature supplies every optional
    // member of the target, so this compiles and a computed-record producer
    // cannot be broken by the narrowing. This line is the pin for that fact —
    // a future tightening that removes the escape (a mapped type with no index
    // signature, say) turns it red and names its own blast radius instead of
    // discovering it in a consumer's build.
    //
    // Empirically: `turbo run type-check` over the whole repo — 81 tasks, every
    // package's source, test and example programs — was green with the
    // narrowing applied and zero call sites edited.
    //
    // ⚠️ Re-read by objectui#11491, which closed the VALUES to the counts the
    // renderer maps, and measured with `tsc -p tsconfig.test.json`: this row
    // still compiles, `Record<string, number>` and all. TypeScript does not
    // judge an index signature's VALUE type against optional target members
    // either, so the escape covers values as well as keys. The TypeScript face
    // closes what an author writes as a literal; the zod mirror judges the
    // values a computed record carries (`grid-columns-set-11491.test.ts`).
    const computed: Record<string, number> = { xs: 1, sm: 2 };
    const fromComputed: GridSchema = { type: 'grid', columns: computed };
    expect(fromComputed.columns).toEqual({ xs: 1, sm: 2 });
  });

  it('a NON-fresh object with at least one valid key also still assigns', () => {
    // Excess-property checking only fires on fresh literals. Through a variable
    // the extra key survives the type system — so the narrowing is a check on
    // the authoring spelling, not a proof that no bad key can reach the
    // renderer. Stated rather than papered over. (`as const` since
    // objectui#11491: a widened `number` value is refused for its value, which
    // would hide the key fact this row is about.)
    const viaVariable = { xs: 1, xxl: 6 } as const;
    const node: GridSchema = { type: 'grid', columns: viaVariable };
    expect(node.columns).toEqual({ xs: 1, xxl: 6 });
  });

  it('a NON-fresh object with NO valid key is still refused — weak-type detection', () => {
    // The one case the freshness gap does not swallow: a target whose members
    // are all optional requires the source to share at least one of them.
    const noValidKey = { xxl: 6 };
    // @ts-expect-error `{ xxl: number }` shares no member with the breakpoint map (objectui#8505)
    const node: GridSchema = { type: 'grid', columns: noValidKey };
    expect(node).toBeDefined();
  });
});

/* ── (e) the other authoring face — the handoff, now COLLECTED ────────────── */

describe('objectui#8505 — the zod mirror now refuses what the declaration refuses', () => {
  it('the JSON face refuses `{ xxl: 6 }` — the gap objectui#8516 closed', () => {
    // THE HANDOFF PIN, FLIPPED (objectui#8516, the objectui#7070 convention).
    // It asserted `success: true` for the whole of objectui#8505's life, with
    // the reason stated rather than assumed: that card narrowed the TypeScript
    // face only, and this block held the mirror's remaining reading visible so
    // it could not rot into a silent assumption that both faces closed
    // together. objectui#8516 narrowed the mirror, so the block is collected
    // here rather than deleted — the flip IS the record that the handoff was
    // honoured, and a deletion would leave nothing that fails if the mirror is
    // ever widened back.
    //
    // ⚠️ The blocker this block used to cite is GONE, and the obsolete number
    // is left named on purpose: it said a narrowing was unaffordable because
    // the console's `framework` chunk measured 70,999 gzip bytes against a
    // 71,000 ceiling. PR #8550 landed the maintainer's raise — that ceiling is
    // 100,000 against a re-derived 72,245 baseline — so the narrowing cost no
    // byte-hunt at all.
    const r = GridZodMirror.safeParse({ type: 'grid', columns: { xxl: 6 } });
    expect(r.success).toBe(false);
  });

  it('CONTROL — the mirror is live: it refuses a non-numeric column count', () => {
    // Without this, the reading above would be equally green against a mirror
    // that validates nothing at all.
    const r = GridZodMirror.safeParse({ type: 'grid', columns: { xs: 'two' } });
    expect(r.success).toBe(false);
  });

  it('CONTROL — and it still ACCEPTS a partial breakpoint map', () => {
    // ⚠️ Added with the flip, and load-bearing because of it. Both readings
    // above are now `false`, so on their own they are equally green against a
    // mirror that refuses EVERYTHING — the caricature the header's table warns
    // about, one authoring face down. This is also the overshoot guard: the
    // `z.record(z.enum([…]), …)` spelling objectui#8516 refused reddens exactly
    // here, because zod 4 makes it require all six members.
    const r = GridZodMirror.safeParse({ type: 'grid', columns: { md: 2 } });
    expect(r.success).toBe(true);
  });
});

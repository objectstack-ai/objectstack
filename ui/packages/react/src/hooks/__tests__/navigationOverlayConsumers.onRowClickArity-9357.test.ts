/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9357, consumer half — every component prop that is genuinely on the
 * modifier-forwarding path declares the payload it is invoked with.
 *
 * The hook half landed in objectui#9360: `UseNavigationOverlayOptions.onRowClick`
 * now declares `(record, event?: HandleClickModifiers)` and `handleClick` calls
 * it without a type assertion. What that left open is this file's subject — the
 * consumers that had copied the understated one-parameter spelling outward.
 *
 * ## The IN/OUT criterion, stated before the sites are listed
 *
 * A declaration is IN iff **the function value flowing through it is actually
 * invoked with the modifier payload**, so the declaration understates a real
 * call. Every IN site below feeds its value to `useNavigationOverlay` as that
 * hook's `onRowClick` (or, for `KanbanRendererProps`, straight to `KanbanImpl`,
 * whose `SortableCard` invokes it with the DOM click event).
 *
 * ⛔ A declaration is NOT in scope merely because it is spelled with one
 * parameter and is named `onRowClick`. The census this card was handed counted
 * 24 one-parameter occurrences and that number is a POPULATION, not a defect
 * count. The `CONTROLS` block below pins the ones that are deliberately OUT,
 * each for a different reason, and they are controls in the strict sense: they
 * share the file, the name and the shape with the IN sites and vary only the
 * claim.
 *
 * ⭐ THE LEDGER MOVED ONCE, AND THAT IS THE HANDSHAKE THIS FILE WAS BUILT FOR
 * (objectui#9462). Two of the original controls were OUT on a claim about
 * BEHAVIOUR, not about spelling: the `data-table` renderer and `ObjectView`'s
 * `handleRowClick` each received the payload and passed one argument on, so
 * widening their declarations would have promised what those hops never
 * delivered. objectui#9462 repaired the hops — the renderer's two call sites
 * now read `schema.onRowClick(row, e)` and the view forwards
 * `onRowClick(record, event)` — which made the same declarations understated
 * instead of accurate, so they moved into `IN_SITES` below rather than being
 * edited in place.
 *
 * ⭐ AND IT MOVED A SECOND TIME, THE SAME WAY (objectui#9799). The one control
 * that family left behind — `ObjectDataTableSchema.onRowClick`, the object-arm
 * face one hop further out — was OUT on an explicitly TEMPORARY claim: its
 * entry recorded a KNOWN GAP under measurement, not a declaration anyone
 * argued was accurate, because objectui#9462 was scope-pinned to three hops.
 * objectui#9799 widened that declaration on its own card, so it is IN below.
 * ⭐ What this file bought is visible in that sequence: the gap was named here
 * while it stood, the card that closed it turned this file RED first, and the
 * entry moved rather than the control being quietly edited to agree.
 *
 * ## Why the instrument is bytes and not assignability
 *
 * The same reason objectui#9360's own pin records: `(r) => void` and
 * `(r, e?) => void` satisfy each other in BOTH directions, so an `extends` pin
 * is green on the broken tree and green on the repaired one. What separates
 * them is the parameter LIST, and this file reads it two ways:
 *
 *  - COMPILE-TIME, on the two spellings themselves (`Parameters<…>` through an
 *    exact-identity `Equal`). No plugin package is imported here — `@object-ui/react`
 *    is what the plugins depend ON, so importing their prop types would invert
 *    the dependency. The spellings are reproduced locally instead, which is what
 *    the source-compatibility claim is actually about.
 *  - BYTES, off disk, with a depth-aware arity counter. ⚠️ A naive comma split
 *    reads `(record: Record<string, unknown>)` as TWO parameters and would score
 *    seven one-parameter sites "already fixed"; `self-tests the counter` below
 *    proves this counter on known legs, and pins the naive counter's wrong
 *    answer beside it so the two cannot be confused for equivalent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MouseEvent as ReactMouseEvent } from 'react';

/* ------------------------------------------------------------------ *
 * COMPILE-TIME half — erased at runtime. `tsc -p tsconfig.test.json`
 * (chained from this package's `type-check` script) is the only thing
 * that executes it.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The spelling every IN site carried before this card. */
type NarrowConsumer = (record: any) => void;
/** The spelling every IN site carries after it. */
type WideConsumer = (record: any, event?: any) => void;

/**
 * SOURCE COMPATIBILITY — reported as a measurement, not assumed. Both
 * directions hold, so no existing caller of these props is refused: a host's
 * one-parameter handler still satisfies the widened declaration, and a
 * two-parameter handler still satisfies the old one.
 */
type _NarrowIsAssignableToWide = Expect<NarrowConsumer extends WideConsumer ? true : false>;
type _WideIsAssignableToNarrow = Expect<WideConsumer extends NarrowConsumer ? true : false>;

/** ...and therefore assignability cannot separate them. Exact identity can. */
type _IdentityStillSeparatesThem = Expect<Equal<Equal<WideConsumer, NarrowConsumer>, false>>;

/** The arity pin: the parameter list spans one-or-two rather than exactly one. */
type _WideAritySpansBoth = Expect<Equal<Parameters<WideConsumer>['length'], 1 | 2>>;
type _NarrowArityIsExactlyOne = Expect<Equal<Parameters<NarrowConsumer>['length'], 1>>;

/**
 * THE ACCEPT-SET BOUNDARY, and the one place this file's result DIFFERS from
 * objectui#9360's. The hook spells its second parameter `HandleClickModifiers`
 * and therefore REFUSES a handler whose second parameter is annotated narrower
 * — React's `MouseEvent` is the shape that hits in practice, and objectui#9360
 * pins that refusal with a `@ts-expect-error`.
 *
 * These consumer faces spell it `any`, so that class is NOT refused here. That
 * is the reason for the spelling, measured rather than asserted: the population
 * most likely to already be passing a second argument is precisely the one that
 * discovered the payload from the implementation — where it is a
 * `React.MouseEvent` — and `app-shell`'s three host call sites spell it
 * `(record: any, event?: any)` for exactly that reason. A narrower declaration
 * would have broken them.
 */
type NarrowerSecondParam = (record: any, event?: ReactMouseEvent) => void;
type _ReactMouseEventAnnotationIsAccepted = Expect<
  NarrowerSecondParam extends WideConsumer ? true : false
>;

/**
 * Control: the checker is live in this file, and the widened spelling really
 * stops at two parameters. Written as an expected error so that a third
 * parameter appearing would make the directive UNUSED and fail with TS2578.
 */
// @ts-expect-error the widened consumer spelling declares no third parameter
type _NoThirdParameter = Parameters<WideConsumer>[2];

/* ------------------------------------------------------------------ *
 * BYTES half — the declarations, read off disk.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/react/src/hooks/__tests__  ->  repo root. Rooted on THIS FILE and
// never on `process.cwd()`, which differs between the repo-root and
// package-level vitest invocations.
const repoRoot = path.resolve(here, '../../../../..');

/**
 * Depth-aware parameter split: counts only TOP-LEVEL commas, tracking
 * `<>` `()` `[]` `{}`. `=>` is not read as a closing angle bracket.
 */
function splitParams(src: string, open: number): string[] | null {
  if (src[open] !== '(') return null;
  let depth = 0;
  let start = open + 1;
  const params: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}' || c === '>') {
      if (c === '>' && src[i - 1] === '=') continue;
      depth--;
      if (depth === 0 && c === ')') {
        const tail = src.slice(start, i).trim();
        if (tail.length) params.push(tail);
        return params;
      }
      continue;
    }
    if (c === ',' && depth === 1) {
      params.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/**
 * Parameters of the inline function TYPE declared for `member`, or null.
 *
 * `after` scopes the search to the text following a literal anchor — the
 * declaring interface's own `export interface X` line. ⚠️ It is not a
 * convenience: without it this reader answers for the FIRST declaration of
 * `member` in the file and silently reattributes the site the moment a second
 * one appears above it. objectui#7804's `objectql.ts` slice made that concrete —
 * that file now carries TWO `onRowClick` declarations with DIFFERENT contracts
 * (`ObjectGallerySchema`'s two-parameter modifier-forwarding one, and
 * `ObjectDataTableSchema`'s one-parameter `row: any`), and they sit in opposite
 * halves of this file's ledger. A file-scoped reader cannot express that.
 *
 * A missing anchor returns `null` rather than falling back to the whole file,
 * so a renamed or deleted interface REDS here instead of quietly answering
 * about some other declaration.
 */
function declParams(src: string, member: string, after?: string): string[] | null {
  let text = src;
  if (after !== undefined) {
    const at = src.indexOf(after);
    if (at < 0) return null;
    text = src.slice(at);
  }
  const re = new RegExp(`(^|[^\\w$])${member}\\??\\s*:\\s*\\(`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf('(', m.index + m[0].length - 1);
  const params = splitParams(text, open);
  if (!params) return null;
  return params;
}

function readSource(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * IN — every site whose value is invoked with the modifier payload. Each entry
 * names the hop that makes it so, because "it is called `onRowClick`" is not
 * the criterion.
 */
const HOOK_CALL = /useNavigationOverlay\s*\(/;
const IN_SITES: Array<{ rel: string; member: string; why: string; hop: RegExp; after?: string }> = [
  { rel: 'packages/plugin-grid/src/ObjectGrid.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-kanban/src/ObjectKanban.tsx', member: 'onRowClick',
    why: 'the onRowClick arm of `externalClick`, fed to useNavigationOverlay', hop: HOOK_CALL },
  { rel: 'packages/plugin-calendar/src/ObjectCalendar.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-gantt/src/ObjectGantt.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-map/src/ObjectMap.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-tree/src/ObjectTree.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-timeline/src/ObjectTimeline.tsx', member: 'onRowClick',
    why: 'the onRowClick arm of `onRowClick ?? onItemClick`, fed to the hook', hop: HOOK_CALL },
  { rel: 'packages/plugin-timeline/src/ObjectTimeline.tsx', member: 'onItemClick',
    why: 'the onItemClick arm of the same `??`', hop: HOOK_CALL },
  { rel: 'packages/plugin-list/src/ListView.tsx', member: 'onRowClick',
    why: 'fed to useNavigationOverlay as its onRowClick', hop: HOOK_CALL },
  { rel: 'packages/plugin-list/src/ObjectGallery.tsx', member: 'onRowClick',
    why: 'the onRowClick arm of `props.onRowClick ?? props.onCardClick`', hop: HOOK_CALL },
  { rel: 'packages/plugin-list/src/ObjectGallery.tsx', member: 'onCardClick',
    why: 'the onCardClick arm of the same `??`', hop: HOOK_CALL },
  { rel: 'packages/plugin-detail/src/RelatedList.tsx', member: 'onRowClick',
    why: 'placed on the object-gallery schema it renders, reaching ObjectGallery props',
    hop: /type: 'object-gallery'/ },
  // ⭐ objectui#7804's `objectql.ts` slice closed the remaining hole on this
  // exact path. `RelatedList` above is IN *because* it writes `onRowClick` onto
  // the `object-gallery` NODE — and until that slice the node type declared
  // neither key, so `BaseSchema`'s index signature typed both `any` and a host
  // writing the node learned nothing about the second parameter. That is this
  // card's own defect ("Declaring one parameter hid the second on the ONE line a
  // host reads") one hop further out. Both are anchored to their interface: the
  // same file's `ObjectDataTableSchema.onRowClick` was a CONTROL below until
  // objectui#9799 closed it, and is now the last entry in this block — the
  // anchors are what keep the three `onRowClick` declarations that file now
  // carries from answering for one another.
  { rel: 'packages/types/src/objectql.ts', member: 'onRowClick',
    why: 'the object-gallery node face ListView and RelatedList write onto; SchemaRenderer spreads it into the props fed to useNavigationOverlay',
    hop: /type: 'object-gallery'/, after: 'export interface ObjectGallerySchema' },
  { rel: 'packages/types/src/objectql.ts', member: 'onCardClick',
    why: 'the onCardClick arm of the same `??` inside ObjectGallery, on the same node face',
    hop: /type: 'object-gallery'/, after: 'export interface ObjectGallerySchema' },
  // ⚠️ objectui#11234 moved the forwarding line one module over: `KanbanRenderer`
  // hands its whole `schema` to the internal `KanbanBoardCore`, and
  // `onCardClick={schema.onCardClick}` now sits in `KanbanBoardCore.tsx`. The
  // declaration this entry reads stays on `KanbanRendererProps` (that module
  // declares none of its own: its schema type is this one minus the Quick Add
  // pair), so the hop quoted here is the hand-off in the SAME file.
  { rel: 'packages/plugin-kanban/src/index.tsx', member: 'onCardClick',
    why: 'handed with the schema to KanbanBoardCore, which forwards it to KanbanImpl, whose SortableCard invokes it with the DOM event',
    hop: /<KanbanBoardCore\s+schema=\{schema\}/ },
  // ⭐ The three entries below arrived by objectui#9462, which repaired the
  // hops rather than the spellings. Each was a CONTROL until that card: they
  // were OUT because the hop that CALLS them passed one argument, so widening
  // them would have declared a payload that never arrived. The hops now pass
  // the payload, so the same declarations understate a real call and the
  // criterion at the top of this file puts them IN. The `hop` of each is the
  // forwarding call itself, quoted in the declaring file.
  { rel: 'packages/types/src/data-display.ts', member: 'onRowClick',
    why: "the slot `data-table`'s renderer calls; ObjectGrid, ObjectDataTable and RelatedList all supply it",
    hop: /`schema\.onRowClick\(row, e\)`/ },
  { rel: 'packages/plugin-view/src/ObjectView.tsx', member: 'onRowClick',
    why: "the view's own host-facing prop; `handleRowClick` forwards both arguments to it",
    hop: /onRowClick\(record, event\)/, after: 'export interface ObjectViewProps' },
  { rel: 'packages/plugin-view/src/ObjectView.tsx', member: 'onRowClick',
    why: "the same `handleRowClick`, handed verbatim to a host's custom list view through `renderListView`",
    hop: /onRowClick: handleRowClick/, after: '  renderListView?: (props: {' },
  // ⭐ objectui#9799 — the object-arm twin of the `data-display.ts` entry above,
  // and the last member of the family this file has been tracking. It was the
  // remaining CONTROL until that card; its OUT entry stated a known gap rather
  // than an accurate declaration, which is why closing it MOVED the entry here
  // instead of rewriting a justification in place.
  //
  // ⚠️ The `hop` is quoted from `ObjectDataTable`'s forwarding line IN FULL,
  // gate included. An earlier report of this site paraphrased it as
  // `schema.onRowClick ?? handleRowClick`; the fallback is gated on
  // `recordDrillEnabled`, and a hop written from that paraphrase would match
  // nothing while still reading like a reading of the tree. The gate does not
  // change the criterion — a host's handler is the FIRST operand and reaches
  // the node whatever the gate says — but the quote is the quote.
  { rel: 'packages/types/src/objectql.ts', member: 'onRowClick',
    why: 'the object-data-table node face; ObjectDataTable forwards it onto the `data-table` node whose renderer now calls it with the payload',
    hop: /`onRowClick: schema\.onRowClick \?\? \(recordDrillEnabled \? handleRowClick : undefined\)`/,
    after: 'export interface ObjectDataTableSchema' },
];

/**
 * CONTROLS — one-parameter (or two-parameter) declarations deliberately left
 * alone. Each varies ONLY the claim: same tree, same instrument, same shape.
 * If a later change widens one of these, this file reds and the reasoning below
 * gets revisited instead of the edit going through unremarked.
 */
const OUT_SITES: Array<{ rel: string; member: string; arity: number; param: RegExp; why: string; after?: string }> = [
  { rel: 'packages/plugin-grid/src/VirtualGrid.tsx', member: 'onRowClick', arity: 2,
    param: /^index: number$/, why: 'its second parameter is `index: number` — a DIFFERENT contract, not this one' },
  { rel: 'packages/plugin-view/src/ManageViewsDialog.tsx', member: 'onRowClick', arity: 1,
    param: /^id: string$/, why: 'invoked as `onRowClick?.(view.id)` — a view id, not a record callback at all' },
];

describe('objectui#9357 — the arity counter, before it is pointed at the tree', () => {
  it('self-tests on known legs', () => {
    const legs: Array<[string, string, number | null]> = [
      // ⚠️ THE TRAP: one parameter whose type carries a comma.
      ['onRowClick?: (record: Record<string, unknown>) => void;', 'onRowClick', 1],
      ['onRowClick?: (record: Record<string, unknown>, event?: HandleClickModifiers) => void;', 'onRowClick', 2],
      ['onRowClick?: () => void;', 'onRowClick', 0],
      ['onRowClick?: (r: Map<string, Array<number, string>>) => void;', 'onRowClick', 1],
      ['onRowClick?: (r: { a: number, b: string }, e?: any) => void;', 'onRowClick', 2],
      ['onRowClick?: (cb: (a: number, b: number) => void) => void;', 'onRowClick', 1],
      // Not declarations at all.
      ['onRowClick(record, event);', 'onRowClick', null],
      ['onRowClick={handleClick}', 'onRowClick', null],
      ['onRowClick?: RowClickHandler;', 'onRowClick', null],
    ];
    for (const [src, member, expected] of legs) {
      const params = declParams(src, member);
      expect(params === null ? null : params.length, src).toBe(expected);
    }
  });

  it('the `after` anchor scopes the read, and a missing anchor reads NULL', () => {
    // objectui#7804: `objectql.ts` gained a SECOND `onRowClick` with the opposite
    // contract, above the one the CONTROLS block pins. Unanchored, the reader
    // answers for whichever comes first — so these three legs are what keep the
    // IN site and the OUT site in that one file from swapping places unnoticed.
    const two = 'export interface A { onRowClick?: (record: Record<string, unknown>, event?: any) => void; }\n'
      + 'export interface B { onRowClick?: (row: any) => void; }';
    expect(declParams(two, 'onRowClick'), 'unanchored reads the FIRST declaration').toHaveLength(2);
    expect(declParams(two, 'onRowClick', 'export interface B'), 'anchored reads B').toHaveLength(1);
    expect(declParams(two, 'onRowClick', 'export interface B')![0]).toBe('row: any');
    expect(
      declParams(two, 'onRowClick', 'export interface Nope'),
      'a missing anchor must read NULL, never fall back to the whole file',
    ).toBeNull();
  });

  it('pins the naive counter\'s WRONG answer, so the two are never confused', () => {
    const oneParam = 'onRowClick?: (record: Record<string, unknown>) => void;';
    const naive = /\(([^)]*)\)/.exec(oneParam)![1].split(',').length;
    // The naive split reads the ONE parameter as two. Seven sites in the census
    // this card was handed are spelled exactly this way.
    expect(naive).toBe(2);
    expect(declParams(oneParam, 'onRowClick')).toHaveLength(1);
  });
});

describe('objectui#9357 — consumers on the modifier-forwarding path declare the payload', () => {
  it.each(IN_SITES)('$rel declares two parameters for $member ($why)', ({ rel, member, after }) => {
    const params = declParams(readSource(rel), member, after);
    expect(params, `${rel} :: ${member} — no inline function-type declaration found`).not.toBeNull();
    expect(params, `${rel} :: ${member}`).toHaveLength(2);
    // The second parameter is optional, so no existing caller is forced to pass it.
    expect(params![1], `${rel} :: ${member} second parameter must stay optional`).toMatch(/^\w+\?:/);
  });

  it('every IN site carries its own forwarding hop — the criterion, not the name', () => {
    // ⚠️ ONE blanket regex would be wrong here: `RelatedList` never calls the
    // hook itself, it builds an `object-gallery` schema whose `onRowClick` the
    // renderer spreads into `ObjectGallery`'s props. A control that shared the
    // suspect component would have hidden exactly that.
    for (const { rel, hop } of IN_SITES) {
      expect(hop.test(readSource(rel)), `${rel} is listed IN but its hop ${hop} does not appear`).toBe(true);
    }
  });
});

describe('objectui#9357 — CONTROLS: sites that share the shape and are deliberately OUT', () => {
  it.each(OUT_SITES)('$rel keeps $member at arity $arity ($why)', ({ rel, member, arity, param, after }) => {
    const params = declParams(readSource(rel), member, after);
    expect(params, `${rel} :: ${member}`).toHaveLength(arity);
    // The LAST parameter is what says which contract this is. `VirtualGrid`
    // has arity 2 and is still out of scope because its second parameter is an
    // index; a numeric check alone cannot express that.
    expect(params![params!.length - 1], `${rel} :: ${member}`).toMatch(param);
  });

  it('the instrument is live on the control tree too (a silent zero would fake every control)', () => {
    // Same counter, same files, a member that IS declared there — so a control
    // reading "arity 1" cannot be the counter failing to find anything.
    for (const { rel, member, after } of OUT_SITES) {
      expect(declParams(readSource(rel), member, after), `${rel} :: ${member}`).not.toBeNull();
    }
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6004 — what `ObjectGrid.generateColumns()` is allowed to EMIT.
 *
 * ⚠️ THE DEFECT IS TYPE-LEVEL, SO A RENDERING TEST IS BLIND TO IT. A grid that
 * renders correctly renders exactly as correctly with the emit type deleted;
 * every assertion in a render test stays green. What can actually fail is a
 * COMPILE, so the pins below are compile-time and this file's value is that
 * `tsc -p tsconfig.test.json` reads it. (It does — verified with `--listFiles`,
 * not assumed: `tsconfig.json` EXCLUDES `**\/__tests__\/**`, so the package
 * build's program never sees this file and only the test project checks it.)
 *
 * Each `@ts-expect-error` below is written to be refused for exactly ONE
 * reason, because a directive refused for two reasons pins neither: it stays
 * "used" when one of them is deleted, and a pin that survives the deletion of
 * the thing it guards is a ghost. Where freshness (excess-property checking)
 * would be a second reason, the fixture is routed through a non-fresh value
 * first — which is also how the real emit reaches the type.
 */
import { describe, it, expect } from 'vitest';
import type { ListColumn, TableColumn } from '@object-ui/types';
import type { ObjectGridColumn, ObjectGridColumnDraft } from '../ObjectGrid';

/** True only for `any`. `any` is the one type both branches of a conditional accept. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Compile-time equality, exact in both directions. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

describe('objectui#6004 — the emit boundary is an instrument, not a decoration', () => {
  /**
   * ⭐ THE ROOT CAUSE, PINNED.
   *
   * `objectSchema` is `useState<any>`, so the field type read off it is `any`.
   * Spreading an `any` into an object literal collapses the ENTIRE literal to
   * `any` — every other key in it silently stops being checked. That is why
   * annotating `generateColumns()` changed nothing until the four inference
   * locals were annotated: the emit literals were `any`, so no return type
   * could bite on them.
   *
   * This is the non-obvious half of the card and nothing else in the repo
   * states it, so it is pinned as an executable claim. If TypeScript ever
   * stops collapsing here, this goes red and the annotations in
   * `generateColumns()` can be revisited — a useful red, not noise.
   */
  it('an `any` in a conditional spread collapses the whole object literal to `any`', () => {
    // `any` is the SUBJECT of this test, not a shortcut in it: `unknown` does
    // not reproduce the collapse, which is the whole behaviour being pinned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyValue = JSON.parse('null') as any;
    const collapsed = { header: 'h', accessorKey: 'a', ...(anyValue && { type: anyValue }) };
    type _CollapsesToAny = Expect<IsAny<typeof collapsed>>;

    // …and naming the value stops it, which is exactly what the fix does.
    const named: string | null = anyValue;
    const notCollapsed = { header: 'h', accessorKey: 'a', ...(named && { type: named }) };
    type _StaysReal = Expect<IsAny<typeof notCollapsed> extends true ? false : true>;

    expect(collapsed.accessorKey).toBe('a');
    expect(notCollapsed.accessorKey).toBe('a');
  });

  /**
   * ⭐ WHY THE TOMBSTONES EXIST — the measurement that says a bare
   * `TableColumn` annotation could not have done this job.
   *
   * This assignment MUST COMPILE. `summary` is a `ListColumn` key that
   * `TableColumn` does not declare, and here it reaches a `TableColumn[]` slot
   * through the same `.map()` the real producer uses. Excess-property checking
   * is a FRESHNESS check on a literal being assigned directly; a literal that
   * has been through `.map()` is no longer fresh, so `TableColumn[]` accepts it
   * silently. If this ever fails to compile, TypeScript has tightened and the
   * docblock in `ObjectGrid.tsx` needs re-measuring.
   */
  it('a bare `TableColumn[]` annotation accepts an undeclared key (the blind instrument)', () => {
    const authored = [{ field: 'amount', summary: 'sum' }] as ListColumn[];
    const bare: TableColumn[] = authored.map((c) => ({
      header: 'Amount',
      accessorKey: c.field,
      ...(c.summary && { summary: c.summary }),
    }));
    expect(bare).toHaveLength(1);
  });

  /**
   * The same emit, against the type the producer actually declares: REFUSED.
   * Freshness cannot be the reason (the value went through `.map()` first), so
   * the tombstone is the only thing that can refuse it — delete
   * `{ [K in RetiredListColumnKey]?: never }` and this directive goes unused.
   */
  it('the emit type refuses a tombstoned key arriving through a spread', () => {
    const authored = [{ field: 'amount', summary: 'sum' }] as ListColumn[];
    const emitted = authored.map((c) => ({
      header: 'Amount',
      accessorKey: c.field,
      ...(c.summary && { summary: c.summary }),
    }));
    // @ts-expect-error objectui#6004 — `summary` is tombstoned on the emit.
    const refused: ObjectGridColumnDraft[] = emitted;
    expect(refused).toHaveLength(1);
  });

  /**
   * Same refusal for a key WRITTEN OUT rather than spread, still routed through
   * a non-fresh value so freshness cannot be the reason either.
   */
  it('the emit type refuses a tombstoned key written out', () => {
    const emitted = { header: 'Name', accessorKey: 'name', label: 'Name' };
    // @ts-expect-error objectui#6004 — `label` is tombstoned on the emit.
    const refused: ObjectGridColumnDraft = emitted;
    expect(refused.accessorKey).toBe('name');
  });

  /**
   * ⭐ DERIVED, NEVER HAND-LISTED. The tombstone set is
   * `Exclude<keyof ListColumn, keyof TableColumn | 'pinned'>`, so a
   * key ADDED to the spec's `ListColumn` tomorrow is refused by default and has
   * to be adjudicated to escape. These two pin both halves of that rule: a
   * `ListColumn` key that `TableColumn` does not declare is `never` on the
   * emit, and a key both declare is untouched.
   */
  it('every undeclared ListColumn key is tombstoned, and declared ones are not', () => {
    type _FieldTombstoned = Expect<ObjectGridColumnDraft['field'] extends undefined ? true : false>;
    type _LinkTombstoned = Expect<ObjectGridColumnDraft['link'] extends undefined ? true : false>;
    type _ActionTombstoned = Expect<ObjectGridColumnDraft['action'] extends undefined ? true : false>;
    type _PrefixTombstoned = Expect<ObjectGridColumnDraft['prefix'] extends undefined ? true : false>;
    type _HiddenTombstoned = Expect<ObjectGridColumnDraft['hidden'] extends undefined ? true : false>;
    // Shared with `TableColumn`, so NOT tombstoned — the Exclude has to keep them alive.
    type _SortableLives = Expect<boolean extends ObjectGridColumnDraft['sortable'] ? true : false>;
    type _WidthLives = Expect<ObjectGridColumnDraft['width'] extends undefined ? false : true>;
    expect(true).toBe(true);
  });

  /**
   * Both keys the emit type must ACCEPT: a tombstone set that swallowed either
   * would be a behaviour change wearing a type change's clothes.
   *
   * ⚠️ They no longer arrive by the same route, and objectui#6424 settled
   * that. `pinned` is still HELD: undeclared by `TableColumn`, so
   * `ObjectGridColumnHolds` is its only declaration on the emit types, AND it
   * has a measured live reader — `ObjectGrid`'s own reorder pass, which
   * consumes it before the array reaches the slot. `headerIcon` reaches the
   * emit types through `TableColumn` itself: it was held on the same
   * "undeclared by `TableColumn`" premise, objectui#6615 declared it
   * (`packages/types/src/data-display.ts`) and the premise expired with nothing
   * going red, so objectui#6424 removed the hold after measuring that both emit
   * types are unchanged without it. So `ObjectGridColumnHolds` declares ONE key
   * today, not two. This test pins only that both keys are accepted, which is
   * true either way; the routes themselves are pinned in
   * `columnHoldsExpiry-6424.test.ts`.
   *
   * ⚠️ There were three until objectui#5453. `wrap` was the third, and it was
   * held for a reason that was never "a live reader": the card that owned it
   * was blocked, so it had "an open card" standing in for a measurement. That
   * card has since taken the measurement and RETIRED the key, so it moved to
   * the tombstone pin below. The lesson worth keeping: a hold justified by an
   * open card is a hold with no evidence under it yet, and it should be
   * re-checked the moment the card closes rather than aging into a fact.
   */
  it('accepts headerIcon (via TableColumn) and pinned (via the hold)', () => {
    const held = { header: 'H', accessorKey: 'a', headerIcon: null, pinned: 'left' as const };
    const accepted: ObjectGridColumnDraft = held;
    expect(accepted.pinned).toBe('left');
  });

  /**
   * ⭐ THE UN-RETIRED KEY (`wrap`, objectui#5453 → objectui#6650).
   *
   * This block asserted the OPPOSITE until 2026-09-02, and the flip is the
   * substance of objectui#6650 rather than a side effect of it, so the old
   * reading is kept here in full: `ObjectGrid` forwarded a per-column `wrap`
   * into the `TableColumn[]` slot and `data-table.tsx` never read it —
   * measured comments-stripped in the same query shape that finds the keys
   * that ARE consumed (`accessorKey` 34, `align` 5, `header` 4, `className` 4,
   * `fitContent` 2), a column-level `wrap` scored 0, with those sibling counts
   * as the positive control that made the zero a measurement rather than a
   * mis-aimed grep. Nor was there anything for it to switch on: the cell
   * wrapper was a two-way `isFit ? 'w-full whitespace-nowrap' : 'truncate
   * w-full'`. No clamp, no expand, no wrap affordance ⇒ enforce-or-remove
   * resolved to remove, and #5453 removed it.
   *
   * ⭐ What changed is not the rule and not the measurement — it is the
   * CONSUMER. objectui#6650 escalated the question one level up, where it
   * belonged: `@objectstack/spec` never stopped declaring `ListColumn.wrap`,
   * and describes it to authors as "Allow text wrapping", so a retired forward
   * left the platform promising a capability at authoring time and silently
   * dropping it at render time. The maintainer ruled (2026-09-02, Option B)
   * that the promise is KEPT: `data-table.tsx` now renders a `wrap: true` cell
   * `whitespace-normal break-words`, `TableColumn` declares the key, the
   * derived band stops covering it with no edit to `RetiredListColumnKey`, and
   * the forward returns.
   *
   * ⚠️ The emit rule did not bend to allow this — it produced it. "A producer
   * may write only keys the CONSUMER reads, and the read set is MEASURED" is
   * exactly why the key was refused in 2026-08 and exactly why it is written
   * now. A pin that could only ever ratchet toward fewer keys would be a pin
   * on a direction, not on a rule.
   */
  it('the emit type ACCEPTS `wrap` again, now that data-table reads it', () => {
    // The derived band no longer covers it: `TableColumn` declares the key, so
    // `Exclude<keyof ListColumn, keyof TableColumn | 'pinned'>` drops it. The
    // member resolves to the real type, not to `never` — the exact inverse of
    // the `_WrapTombstoned` pin that stood here.
    type _WrapLive = Expect<Equal<ObjectGridColumnDraft['wrap'], boolean | undefined>>;

    // Routed through a NON-FRESH value, the same way the tombstone pins are, so
    // this measures assignability and not excess-property freshness — the two
    // tests are then each other's mirror image through one mechanism.
    const emitted: { header: string; accessorKey: string; wrap?: boolean } =
      { header: 'Notes', accessorKey: 'notes', wrap: true };
    const accepted: ObjectGridColumnDraft = emitted;
    expect(accepted.wrap).toBe(true);
  });

  /**
   * ⭐ THE RETIRED KEY (`options`). Nothing on either side of the seam reads a
   * column-level `options`: `data-table` has no such read, and this component's
   * own `renderCellEditor` rebuilds the field from the object schema. Retiring
   * it means the emit type must now REFUSE it — otherwise "retired" is just a
   * deleted line that the next edit can put back for free.
   *
   * ⚠️ THE MECHANISM MOVED, and the history is the warning. As first written,
   * this refusal rested on NON-MEMBERSHIP: `options` is not a `ListColumn`
   * key (so the derived tombstone could never cover it), and it belonged to
   * no part of the emit type, so excess-property freshness was "genuinely the
   * only reason a non-member is refused". objectui#6425's maintainer ruling
   * (2026-08-27) declared `options` on `TableColumn`, the key became a member
   * here, and that enforcement ended SILENTLY — this directive turned
   * TS2578-unused, which is luck, not design: a pin enforced by a key's
   * non-membership stops enforcing the moment the key becomes a member.
   * The refusal below is now caused by `ObjectGridRetiredOptionsTombstone`
   * (`ObjectGrid.tsx`), an explicit `?: never` that bites by ASSIGNABILITY —
   * one cause again, just a different one. #6004's verdict is unchanged.
   */
  it('the emit type refuses the retired `options` key', () => {
    // Routed through a non-fresh value like the other tombstone pins, so the
    // tombstone is the single cause — freshness cannot refuse a non-fresh
    // source, and before the tombstone existed this exact assignment was the
    // silent hole (a fresh literal still failed; the spread road was open).
    const emitted: { header: string; accessorKey: string; options?: unknown[] } =
      { header: 'S', accessorKey: 'stage', options: [] };
    // @ts-expect-error objectui#6004/#6425 — `options` retired from this producer's emit, refused by the explicit tombstone.
    const refused: ObjectGridColumnDraft = emitted;
    expect(refused.accessorKey).toBe('stage');
  });

  /**
   * The pre-fold / post-fold split (objectui#5853's fold is what separates
   * them). `ObjectGridColumnDraft.type` is the producer's raw inference vocabulary;
   * `ObjectGridColumn.type` is the narrow union `TableColumn` declares. If someone
   * collapses the two types into one, one of these goes red.
   */
  it('the draft carries the producer vocabulary and the folded column carries the declared union', () => {
    const draft: ObjectGridColumnDraft = { header: 'A', accessorKey: 'a', type: 'lookup' };
    expect(draft.type).toBe('lookup');

    // @ts-expect-error objectui#5853 — `lookup` is not a declared `TableColumn.type`.
    const folded: ObjectGridColumn = { header: 'A', accessorKey: 'a', type: 'lookup' };
    expect(folded.accessorKey).toBe('a');
  });
});

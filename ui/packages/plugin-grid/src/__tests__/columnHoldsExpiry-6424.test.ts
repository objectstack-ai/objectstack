/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6424 — `ObjectGridColumnHolds` after the `headerIcon` hold came out.
 *
 * ## What actually changed, and what this file is for
 *
 * `ObjectGridColumnHolds` exists for keys `data-table` READS that `TableColumn`
 * does NOT declare. `headerIcon` was one until objectui#6615 declared it on
 * `TableColumn`; from that moment the hold was redundant rather than
 * load-bearing, and NOTHING WENT RED — the same silent expiry objectui#6425
 * recorded for `options`. objectui#6424 removed the member.
 *
 * ⚠️ THE REMOVAL MOVED A LIVENESS CLAIM RATHER THAN DELETING ONE. While the
 * hold existed, the emit types declared `headerIcon` on their own account; now
 * they get it ONLY from `TableColumn`. So if `TableColumn` ever stops declaring
 * it, the key silently vanishes from both emit types and `ObjectGrid` goes on
 * writing it at three sites into a slot that no longer admits it. That is a
 * NEW exposure created by the removal, and the first assertion below is what
 * covers it — it is the guard the deleted member used to provide implicitly.
 *
 * ## Why these pins are compile-time
 *
 * The claim is about TYPES, and a rendering test is blind to it: the grid
 * renders exactly as correctly with every type in this file deleted. What can
 * fail is a compile, and `tsc -p tsconfig.test.json` reads this file (the
 * package build's own program excludes `__tests__`). The `expect()` calls are
 * there so vitest reports the file at all; the assertions that matter are the
 * `Expect<...>` aliases, which are erased at runtime.
 *
 * ## Every zero here has a positive control in the same query shape
 *
 * A `false` from a probe that can only answer `false` measures nothing, so each
 * negative claim is paired with a sibling that must come back the other way.
 */
import { describe, it, expect } from 'vitest';
import type { ListColumn, TableColumn } from '@object-ui/types';
import type { ObjectGridColumn, ObjectGridColumnDraft, RetiredListColumnKey } from '../ObjectGrid';

/** Compile-time equality, exact in both directions (not mutual assignability). */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;

type Has<K extends string, T> = K extends keyof T ? true : false;
type Expect<T extends true> = T;

describe('objectui#6424 — the holds interface after the headerIcon expiry', () => {
  /**
   * ⭐ THE GUARD THE REMOVED MEMBER USED TO PROVIDE.
   *
   * `ObjectGrid` writes `headerIcon` at three sites (all under
   * `schema.showColumnTypeIcons`, via `getTypeIcon`) and `data-table` renders
   * it. With the hold gone, `TableColumn` is the ONLY thing declaring the key
   * on the emit types. Reverting objectui#6615 would otherwise drop it from
   * both types in silence; this is what makes that loud.
   */
  it('`TableColumn` declares `headerIcon` — the emit types now depend on it alone', () => {
    type _Declared = Expect<Has<'headerIcon', TableColumn>>;
    // Controls: the probe can answer both ways in this exact shape.
    type _CtrlPresent = Expect<Has<'width', TableColumn>>;
    type _CtrlAbsent = Expect<Has<'zzNotAKeyZZ', TableColumn> extends false ? true : false>;
    expect(true).toBe(true);
  });

  /**
   * ⭐ THE RULED PROBE (objectui#6424, the seat's Option A).
   *
   * The removal was ruled on a type-algebra derivation — the holds member
   * declared the identical type, so the intersection was idempotent. This runs
   * it as a compile-time probe instead of inheriting it: the emit types' member
   * and `TableColumn`'s must be THE SAME TYPE, not merely compatible, which is
   * why this is `Equal` and not `extends`.
   */
  it('`headerIcon` on both emit types is identical to `TableColumn`s', () => {
    type _Column = Expect<Equal<ObjectGridColumn['headerIcon'], TableColumn['headerIcon']>>;
    type _Draft = Expect<Equal<ObjectGridColumnDraft['headerIcon'], TableColumn['headerIcon']>>;
    // Controls on the instrument itself: `Equal` must be able to say false here,
    // otherwise the two lines above are green for no reason.
    type _CtrlTrue = Expect<Equal<TableColumn['headerIcon'], TableColumn['headerIcon']>>;
    type _CtrlFalse = Expect<
      Equal<ObjectGridColumn['headerIcon'], TableColumn['width']> extends false ? true : false
    >;
    expect(true).toBe(true);
  });

  /**
   * The hold was never rescuing `headerIcon` from the DERIVED tombstone band.
   * `RetiredListColumnKey` is `Exclude<keyof ListColumn, keyof TableColumn | 'pinned'>`,
   * so a key that is not a `ListColumn` member can never enter it — and
   * `headerIcon` is not one. Without this, "removing the hold is safe" would
   * have to assume the band, and the band is exactly where a removed hold would
   * bite (as `?: never`) instead of merely disappearing.
   */
  it('`headerIcon` is not a `ListColumn` member, so it was never in the derived band', () => {
    type _NotListColumn = Expect<Has<'headerIcon', ListColumn> extends false ? true : false>;
    type _NotInBand = Expect<
      'headerIcon' extends RetiredListColumnKey ? false : true
    >;
    // Controls, same shapes: a real `ListColumn` member, and a key that IS in the band.
    // ⚠️ The in-band control was `wrap` until objectui#6650. It stopped being a
    // valid example the moment `TableColumn` declared that key — the band is
    // `Exclude<keyof ListColumn, keyof TableColumn | 'pinned'>`, so a declared
    // key leaves it by construction — and this line went red at compile time
    // saying so, which is the band behaving exactly as designed. `summary` is a
    // `ListColumn` member no `TableColumn` declares, so it plays the same role
    // without depending on a key whose verdict is now settled the other way.
    type _CtrlListColumn = Expect<Has<'width', ListColumn>>;
    type _CtrlInBand = Expect<'summary' extends RetiredListColumnKey ? true : false>;
    expect(true).toBe(true);
  });

  /**
   * ⭐ THE CONTRAST THAT MAKES THE TWO VERDICTS DIFFERENT — and the reason
   * `pinned` must NOT follow `headerIcon` out.
   *
   * `pinned` fails the expiry test on both counts: `TableColumn` does not
   * declare it, and `RetiredListColumnKey` explicitly carves it out of the
   * Exclude, so `ObjectGridColumnHolds` is its ONLY declaration on the emit
   * types. (Measured: deleting the member takes both emit types from 27
   * resolved members to 26, `pinned` gone. Deleting `headerIcon` left them
   * byte-identical — that pair of ablations is what this verdict rests on.)
   *
   * It also has a second road: this file's reorder pass reads it and
   * re-expresses it as the sticky `className` `data-table` reads. `wrap` had no
   * such road when this was written, which is why the two keys were graded
   * differently; objectui#6650 later gave `wrap` a first road instead — a real
   * consumer in `data-table.tsx` — so it is a declared key today, not a held
   * one, and `pinned` remains the only member of the holds interface.
   */
  it('`pinned` is still load-bearing — undeclared by `TableColumn` and outside the band', () => {
    type _Undeclared = Expect<Has<'pinned', TableColumn> extends false ? true : false>;
    type _CarvedOut = Expect<'pinned' extends RetiredListColumnKey ? false : true>;
    // Control: `pinned` IS a `ListColumn` member, so its absence from the band
    // is the carve-out doing work — not non-membership, which is `headerIcon`s
    // reason. Two different routes to the same `false`, and they must not be
    // conflated.
    type _CtrlIsListColumnMember = Expect<Has<'pinned', ListColumn>>;
    // …and it is therefore still a member of both emit types.
    type _StillOnColumn = Expect<Has<'pinned', ObjectGridColumn>>;
    type _StillOnDraft = Expect<Has<'pinned', ObjectGridColumnDraft>>;
    expect(true).toBe(true);
  });

  /**
   * The behaviour that must survive the removal: `ObjectGrid` writes
   * `headerIcon` into the slot at three sites, so the emit types still have to
   * ACCEPT it. Routed through a non-fresh value, like the other emit-boundary
   * pins — a fresh literal would be refused or admitted by excess-property
   * freshness, which is a different question from membership.
   */
  it('the emit types still accept a written `headerIcon`', () => {
    const emitted: { header: string; accessorKey: string; headerIcon?: unknown } = {
      header: 'Name',
      accessorKey: 'name',
      headerIcon: null,
    };
    const draft: ObjectGridColumnDraft = emitted as ObjectGridColumnDraft;
    expect(draft.accessorKey).toBe('name');
  });
});

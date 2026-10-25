/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9799 — `ObjectDataTableSchema.onRowClick`, the object-arm twin, now
 * declares the payload it is invoked with.
 *
 * ## What moved, and what deliberately did not
 *
 * `DataTableSchema.onRowClick` was widened to `(row: any, event?: any) => void`
 * by objectui#9462, together with the renderer hops that had been truncating the
 * call. The object-arm face did not move with it: `ObjectDataTable` forwards a
 * host's handler onto that very `data-table` node, so the second argument was
 * already arriving at a declaration that denied it. ⛔ Nothing about the runtime
 * call changed on this card — only the declaration, in the widening direction.
 *
 * ## Why an `extends` pin would be worthless here, stated before the pins
 *
 * `(row) => void` and `(row, event?) => void` satisfy each other in BOTH
 * directions: TypeScript accepts a function that ignores trailing parameters,
 * and an optional parameter cannot make a call illegal. So an assignability
 * check is green on the narrow tree AND on the wide one, and it is exactly the
 * pin a future reader would find reassuring and useless. The two directions are
 * asserted below anyway — as the SOURCE-COMPATIBILITY measurement this card owes
 * (no existing host handler is refused, in either direction) — and then the
 * discriminator is stated separately: exact identity of the parameter LIST,
 * which is what actually separates the two trees.
 *
 * ⚠️ The compile-time half of this file is erased at runtime. `tsc -p
 * tsconfig.test.json`, chained from this package's `type-check` script, is the
 * only thing that executes it; the `describe` below carries the runtime half
 * and says so rather than implying the `Expect<…>` lines ran under vitest.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectDataTableSchema } from '../objectql.js';
import type { ObjectDataTableSchema as PublishedFromBarrel } from '../index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* ------------------------------------------------------------------ *
 * COMPILE-TIME half — the enforcement.
 * ------------------------------------------------------------------ */

/** The member is read through the PUBLISHED name, not a local re-spelling. */
type Slot = NonNullable<ObjectDataTableSchema['onRowClick']>;
/** ...and the barrel's export is the same declaration, not a same-named twin. */
export type assertionBarrelIsTheSameDeclaration =
  Expect<Equal<PublishedFromBarrel['onRowClick'], ObjectDataTableSchema['onRowClick']>>;

/** A host handler that TAKES the payload. This is the shape the card is about. */
type TwoArgHandler = (row: any, event?: any) => void;
/** A host handler written before the payload existed. It must keep working. */
type OneArgHandler = (row: any) => void;

/**
 * SOURCE COMPATIBILITY, both directions — reported as a measurement, ⛔ not as
 * the discriminator. Green on the narrow tree too, which is the whole point of
 * saying so here instead of letting a reader mistake these for the pin.
 */
export type assertionTwoArgHandlerIsAccepted = Expect<TwoArgHandler extends Slot ? true : false>;
export type assertionOneArgHandlerStillAccepted = Expect<OneArgHandler extends Slot ? true : false>;
/** A handler that ignores the row entirely is still a legal host handler. */
export type assertionZeroArgHandlerStillAccepted = Expect<(() => void) extends Slot ? true : false>;
/** ...and the slot satisfies the old spelling, so a host's own alias still binds. */
export type assertionSlotSatisfiesOldSpelling = Expect<Slot extends OneArgHandler ? true : false>;

/**
 * THE DISCRIMINATOR. `Equal` is invariant, so this is the one line above that
 * reads differently on the narrow tree and on the wide one.
 */
export type assertionSlotIsTheWidenedSpelling = Expect<Equal<Slot, TwoArgHandler>>;
/** The same statement as an arity, which is the form the objectui#9357 ledger reads in bytes. */
export type assertionAritySpansOneOrTwo = Expect<Equal<Parameters<Slot>['length'], 1 | 2>>;
/**
 * The second parameter is spelled `any`, ⛔ not `HandleClickModifiers` — that
 * interface lives in `@object-ui/react`, which depends on THIS package, so
 * naming it here closes a dependency cycle (the objectui#9341 reading).
 * ⚠️ OPTIONALITY is carried by the arity pin above and by the zero- and
 * one-argument acceptance pins, ⛔ not by this line: an indexed access reads
 * `any` for a required `any` parameter too.
 */
export type assertionSecondParameterIsSpelledAny = Expect<Equal<Parameters<Slot>[1], any>>;

/**
 * CONTROLS — the helpers can fail, and the pin above is not green by accident.
 */
export type assertionEqualCanFail = Expect<Equal<Equal<TwoArgHandler, OneArgHandler>, false>>;
export type assertionNarrowSpellingIsNotTheSlot = Expect<Equal<Equal<Slot, OneArgHandler>, false>>;
/**
 * Written as an expected error so a THIRD parameter appearing would make the
 * directive unused and fail with TS2578 — the widening stops at two.
 */
// @ts-expect-error the widened slot declares no third parameter
export type assertionNoThirdParameter = Parameters<Slot>[2];

/* ------------------------------------------------------------------ *
 * RUNTIME half — what a host actually gets when the node is invoked.
 * ------------------------------------------------------------------ */

describe('ObjectDataTableSchema.onRowClick — the declaration a host reads (objectui#9799)', () => {
  it('delivers both arguments to a handler authored on the published key', () => {
    const seen: Array<[unknown, unknown]> = [];
    const node: ObjectDataTableSchema = {
      type: 'object-data-table',
      objectName: 'account',
      onRowClick: (row, event) => { seen.push([row, event]); },
    };
    // The call the `data-table` renderer makes, reproduced with no renderer in
    // the room: this package cannot import one, and the hop itself is pinned
    // where it lives (the objectui#9357 consumer ledger in `@object-ui/react`).
    node.onRowClick?.({ _id: 'r1' }, { metaKey: true, button: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toEqual({ _id: 'r1' });
    expect(seen[0][1]).toEqual({ metaKey: true, button: 0 });
  });

  it('still accepts a one-argument handler, which simply never sees the payload', () => {
    const rows: unknown[] = [];
    const legacy: OneArgHandler = (row) => { rows.push(row); };
    const node: ObjectDataTableSchema = { type: 'object-data-table', onRowClick: legacy };
    node.onRowClick?.({ _id: 'r2' }, { metaKey: true });
    expect(rows).toEqual([{ _id: 'r2' }]);
  });

  it('⚠️ says out loud that neither runtime leg above separates the two trees', () => {
    // Both legs pass verbatim on the pre-card declaration: JavaScript has no
    // arity enforcement, so a second argument reaches a one-parameter function
    // either way. They document the contract; the pin that FAILS on the narrow
    // tree is `assertionSlotIsTheWidenedSpelling`, and only `tsc` runs it.
    // Recorded here so nobody reads a green vitest run as having measured the
    // widening.
    const declared: (...args: any[]) => void = (row: any) => void row;
    expect(() => declared({ _id: 'r3' }, { metaKey: true })).not.toThrow();
  });
});
